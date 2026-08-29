"""
API Router for Symbol Matcher Governance: review queues, manual mapping,
candidates, and audit history.
"""

import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

try:
    from backend.database import fetch_all
    from backend.engine.symbol_matcher import matcher, MatchStatus, normalize_name
    from backend.engine import symbol_matcher_persistence as persistence
except ImportError:
    from ..database import fetch_all
    from ..engine.symbol_matcher import matcher, MatchStatus, normalize_name
    from ..engine import symbol_matcher_persistence as persistence

from scripts.common import ENABLED_EXCHANGES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/symbol-matcher", tags=["Symbol Matcher"])


def _deal_stats_by_normalized_name() -> Dict[str, Dict[str, Any]]:
    """
    Groups deal activity (count, latest date, categories, total value) by
    the SAME normalize_name() function the matcher itself uses - guarantees
    the grouping key matches exactly how resolution groups companies,
    rather than risking a mismatched SQL-side normalization. Reuses the
    existing stockedge_all_deals_view - no deal data is duplicated.
    """
    # Exchange filtering happens BEFORE these stats are computed: a deal on
    # a disabled exchange must never inflate a security's deal_count/value
    # in the review queues, nor keep a BSE-only company (which can never
    # have a valid NSE match) showing up as if it still needed review.
    rows = fetch_all(
        "SELECT deal_category, security_name, trade_date, total_value FROM stockedge_all_deals_view WHERE UPPER(exchange_name) = ANY(%s);",
        (ENABLED_EXCHANGES,),
    )
    stats: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        key = normalize_name(r["security_name"])
        if not key:
            continue
        entry = stats.setdefault(key, {"deal_count": 0, "latest_deal_date": None, "deal_categories": set(), "total_value": 0.0, "has_value": False})
        entry["deal_count"] += 1
        entry["deal_categories"].add(r["deal_category"])
        if r.get("trade_date") and (entry["latest_deal_date"] is None or r["trade_date"] > entry["latest_deal_date"]):
            entry["latest_deal_date"] = r["trade_date"]
        if r.get("total_value") is not None:
            entry["total_value"] += float(r["total_value"])
            entry["has_value"] = True
    return stats


def _enrich(mapping: Dict[str, Any], deal_stats: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    stat = deal_stats.get(mapping["normalized_security_name"], {})
    return {
        **mapping,
        "deal_count": stat.get("deal_count", 0),
        "latest_deal_date": str(stat["latest_deal_date"]) if stat.get("latest_deal_date") else None,
        "deal_categories": sorted(stat.get("deal_categories", set())),
        "total_transaction_value": round(stat["total_value"], 2) if stat.get("has_value") else None,
        "is_backtest_eligible": mapping["match_status"] in (MatchStatus.MATCHED, MatchStatus.MANUAL_OVERRIDE),
    }


@router.get("/unmatched")
def list_unmatched(search: Optional[str] = None, limit: int = Query(200, ge=1, le=1000)):
    """Securities the matcher could not confidently resolve to any NSE symbol."""
    mappings = persistence.list_by_status(MatchStatus.UNMATCHED, search=search, limit=limit)
    deal_stats = _deal_stats_by_normalized_name()
    return {"count": len(mappings), "unmatched": [_enrich(m, deal_stats) for m in mappings]}


@router.get("/low-confidence")
def list_low_confidence(search: Optional[str] = None, limit: int = Query(200, ge=1, le=1000)):
    """Securities with a candidate symbol whose confidence fell short of the automatic-acceptance threshold."""
    mappings = persistence.list_by_status(MatchStatus.LOW_CONFIDENCE, search=search, limit=limit)
    deal_stats = _deal_stats_by_normalized_name()
    return {"count": len(mappings), "low_confidence": [_enrich(m, deal_stats) for m in mappings]}


@router.get("/mappings")
def list_mappings(
    search: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(200, ge=1, le=1000),
):
    """All persisted mappings, optionally filtered - powers the general Symbol Matching admin page."""
    if status and status not in (MatchStatus.MATCHED, MatchStatus.LOW_CONFIDENCE, MatchStatus.UNMATCHED, MatchStatus.MANUAL_OVERRIDE):
        raise HTTPException(status_code=400, detail=f"Invalid status '{status}'")
    mappings = persistence.list_all(search=search, status=status, limit=limit)
    deal_stats = _deal_stats_by_normalized_name()
    return {"count": len(mappings), "mappings": [_enrich(m, deal_stats) for m in mappings]}


@router.get("/candidates/{security_name}")
def get_candidates(security_name: str):
    """Runs (or reuses the persisted) resolution for a security name and returns its full evidence + candidates."""
    result = matcher.resolve_symbol_detailed(security_name)
    result = dict(result)
    result["is_backtest_eligible"] = result["match_status"] in (MatchStatus.MATCHED, MatchStatus.MANUAL_OVERRIDE)
    return result


class CreateMappingRequest(BaseModel):
    original_security_name: str = Field(..., min_length=1)
    resolved_nse_symbol: str = Field(..., min_length=1)
    notes: Optional[str] = None
    updated_by: Optional[str] = None


@router.post("/mapping")
def create_mapping(req: CreateMappingRequest):
    """
    Creates or replaces a MANUAL_OVERRIDE for a security. Always wins over
    any existing automated (or prior manual) mapping, and validates the
    symbol against the existing NSE reference data before accepting it.
    """
    symbol = req.resolved_nse_symbol.upper().strip()
    if not matcher.is_valid_nse_symbol(symbol):
        raise HTTPException(status_code=400, detail=f"'{symbol}' is not a known NSE symbol in nse_equity_eod.")

    normalized = normalize_name(req.original_security_name)
    if not normalized:
        raise HTTPException(status_code=400, detail="original_security_name normalizes to an empty string.")

    result = persistence.save_manual_override(
        req.original_security_name, normalized, symbol, updated_by=req.updated_by, notes=req.notes,
    )
    matcher.refresh_cached_result(normalized, result)
    return result


@router.put("/mapping/{mapping_id}")
def update_mapping(mapping_id: int, req: CreateMappingRequest):
    """Updates an existing mapping's manual override (same semantics as POST, targeting a known row)."""
    existing = persistence.get_mapping_by_id(mapping_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Mapping {mapping_id} not found.")

    symbol = req.resolved_nse_symbol.upper().strip()
    if not matcher.is_valid_nse_symbol(symbol):
        raise HTTPException(status_code=400, detail=f"'{symbol}' is not a known NSE symbol in nse_equity_eod.")

    result = persistence.save_manual_override(
        req.original_security_name or existing["original_security_name"],
        existing["normalized_security_name"], symbol, updated_by=req.updated_by, notes=req.notes,
    )
    matcher.refresh_cached_result(existing["normalized_security_name"], result)
    return result


class RemoveMappingRequest(BaseModel):
    changed_by: Optional[str] = None
    reason: Optional[str] = None


@router.delete("/mapping/{mapping_id}")
def delete_mapping(mapping_id: int, req: Optional[RemoveMappingRequest] = None):
    """
    Removes a manual override (the security reverts to automated matching
    on its next resolution). The change is recorded in the audit history
    even though the mapping row itself is deleted.
    """
    existing = persistence.get_mapping_by_id(mapping_id)
    if not existing:
        raise HTTPException(status_code=404, detail=f"Mapping {mapping_id} not found.")

    removed = persistence.remove_manual_override(
        mapping_id,
        changed_by=req.changed_by if req else None,
        reason=req.reason if req else None,
    )
    matcher.invalidate_cached_result(existing["normalized_security_name"])
    if not removed:
        raise HTTPException(status_code=500, detail="Failed to remove mapping.")
    return {"status": "success", "message": f"Mapping {mapping_id} removed; will be re-matched automatically on next resolution."}


@router.get("/history/{mapping_id}")
def get_mapping_history(mapping_id: int):
    """Full audit trail of changes to a mapping."""
    history = persistence.get_history(mapping_id=mapping_id)
    return {"mapping_id": mapping_id, "count": len(history), "history": history}


class RematchRequest(BaseModel):
    confirmation: str = Field(..., description='Must be exactly "CLEAR" to confirm this destructive operation.')


@router.post("/rematch")
def rematch_symbols(req: RematchRequest):
    """
    Clear & Re-Match NSE Symbols.

    Deletes every AUTOMATIC mapping (is_manual_override = FALSE - manual
    overrides are NEVER touched by this endpoint) and re-runs matching for
    every distinct security appearing in an ENABLED_EXCHANGES deal, against
    the current NSE reference universe (nse_equity_eod). This is the
    "clear stale automatic matches, then rerun" operation: exchange
    filtering is applied on the INPUT side (which deals are even considered)
    via the same WHERE UPPER(exchange_name) = ANY(%s) filter now used by
    every other symbol-resolution query in the app - a company whose deals
    are all on a disabled exchange is never fed into the matcher at all,
    rather than being matched and filtered out afterward.
    """
    if req.confirmation != "CLEAR":
        raise HTTPException(status_code=400, detail='Confirmation text must be exactly "CLEAR".')

    matcher.initialize()
    cleared = persistence.clear_automatic_mappings()
    matcher.clear_cache()

    rows = fetch_all(
        """
        SELECT DISTINCT
            v.security_name,
            COALESCE(i.security_slug, s.security_slug, blk.security_slug, blk2.security_slug, '') as security_slug
        FROM stockedge_all_deals_view v
        LEFT JOIN stockedge_insider_deals i ON v.id = i.id AND v.deal_category = 'Insider Trading'
        LEFT JOIN stockedge_sast_deals s ON v.id = s.id AND v.deal_category = 'SAST Deals'
        LEFT JOIN stockedge_block_deals blk ON v.id = blk.id AND v.deal_category = 'Block Deals'
        LEFT JOIN stockedge_bulk_deals blk2 ON v.id = blk2.id AND v.deal_category = 'Bulk Deals'
        WHERE UPPER(v.exchange_name) = ANY(%s);
        """,
        (ENABLED_EXCHANGES,),
    )

    for r in rows:
        matcher.resolve_symbol_detailed(r["security_name"], r.get("security_slug"))

    status_counts = persistence.count_by_status()
    valid_symbols = matcher.get_valid_nse_symbols()
    invalid = persistence.find_invalid_resolved_symbols(list(valid_symbols))

    logger.warning(
        f"[AUDIT] Symbol re-match executed. Cleared {cleared} automatic mapping(s); "
        f"reprocessed {len(rows)} distinct securities from {ENABLED_EXCHANGES}. "
        f"Resulting status counts: {status_counts}. Invalid resolved symbols remaining: {len(invalid)}."
    )

    return {
        "status": "success",
        "cleared_automatic_mappings": cleared,
        "total_securities_processed": len(rows),
        "status_counts": status_counts,
        "invalid_resolved_symbol_count": len(invalid),
    }


@router.get("/validate")
def validate_symbol_mappings():
    """
    Hard validation (not merely trusting a stored status): counts any
    persisted mapping - manual or automatic - whose resolved_nse_symbol is
    NOT in the CURRENT NSE reference universe (nse_equity_eod). Being
    labeled "NSE" is not sufficient on its own; this must be 0 for the
    NSE-only matching migration to be considered complete. Invalid manual
    overrides are surfaced for human review here but are NEVER
    automatically modified or deleted by this endpoint.
    """
    matcher.initialize()
    valid_symbols = matcher.get_valid_nse_symbols()
    invalid = persistence.find_invalid_resolved_symbols(list(valid_symbols))
    invalid_manual = [m for m in invalid if m["is_manual_override"]]
    invalid_automatic = [m for m in invalid if not m["is_manual_override"]]

    return {
        "valid": len(invalid) == 0,
        "invalid_resolved_symbol_count": len(invalid),
        "invalid_manual_override_count": len(invalid_manual),
        "invalid_automatic_count": len(invalid_automatic),
        "invalid_manual_overrides": invalid_manual,
    }
