"""
Data loaders for the Insider Conviction Engine.

Reuses the existing connection pool (backend/database.py) and symbol
resolution (backend/engine/symbol_matcher.py) rather than duplicating them.
Query shapes mirror backend/engine/backtester.py's load_deals/
load_price_history so the same LEFT JOIN pattern for security_slug is not
reinvented, extended here to also pull person_category (role) and, for
price data, delivery_pct (needed by the Volume/Delivery factor).
"""

import logging
from typing import List, Dict, Any, Optional
from datetime import date, datetime, timedelta
from collections import defaultdict

try:
    from backend.database import fetch_all
    from backend.engine.symbol_matcher import matcher, MatchStatus
except ImportError:
    from ...database import fetch_all
    from ..symbol_matcher import matcher, MatchStatus

from . import configuration as cfg

logger = logging.getLogger(__name__)


def safe_float(val: Any, default: float = 0.0) -> float:
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def to_date(val: Any) -> Optional[date]:
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    try:
        return datetime.strptime(str(val)[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def new_mapping_audit() -> Dict[str, int]:
    """Fresh, zeroed symbol-mapping audit counter (see load_symbol_deals/load_active_symbols)."""
    return {"total_transactions": 0, "matched": 0, "manual_override": 0, "excluded_low_confidence": 0, "excluded_unmatched": 0}


def _tally(audit: Optional[Dict[str, int]], status: str) -> None:
    if audit is None:
        return
    audit["total_transactions"] += 1
    if status == MatchStatus.MATCHED:
        audit["matched"] += 1
    elif status == MatchStatus.MANUAL_OVERRIDE:
        audit["manual_override"] += 1
    elif status == MatchStatus.LOW_CONFIDENCE:
        audit["excluded_low_confidence"] += 1
    elif status == MatchStatus.UNMATCHED:
        audit["excluded_unmatched"] += 1


def classify_role(person_category: Optional[str]) -> str:
    """
    Groups the raw StockEdge person_category string into one of the four
    broad classifications requested by the scoring spec. This uses only
    values that actually appear in the source data (verified live: 'Promoter',
    'Promoter Group', 'Promoter and Director', 'Director', 'KMP',
    'Designated Person', 'Employee', 'Trust', 'Immediate Relative', etc.)
    - it never invents a classification that isn't already implied by the
    source string.
    """
    if not person_category:
        return "Unavailable"
    p = person_category.strip().lower()
    if "promoter" in p:
        return "Promoter"
    if "director" in p:
        return "Director"
    if p == "kmp":
        return "KMP"
    return "Other"


def load_symbol_deals(
    symbol: str,
    lookback_days: int = cfg.CURRENT_LOOKBACK_DAYS,
    as_of_date: Optional[date] = None,
    audit: Optional[Dict[str, int]] = None,
) -> List[Dict[str, Any]]:
    """
    Loads conviction-relevant deals (BUY/SELL only, Pledge/Unpledge excluded)
    for a single resolved NSE symbol, within the lookback window ending at
    as_of_date (defaults to today). Joins back to the raw deal tables (same
    pattern as backtester.py:load_deals) to recover security_slug and, for
    Insider Trading / SAST rows, person_category.

    CRITICAL: only deals resolving to MATCHED or MANUAL_OVERRIDE are ever
    returned - LOW_CONFIDENCE and UNMATCHED deals (across the whole scanned
    window, not just this symbol) are excluded and, if an `audit` dict is
    passed in, tallied there so the exclusion is visible rather than silent.
    Each returned deal is annotated with match_status/match_method/
    match_confidence for downstream display (e.g. Stock Intelligence).
    """
    as_of_date = as_of_date or date.today()
    start_date = as_of_date - timedelta(days=lookback_days)

    query = """
    SELECT
        v.deal_category,
        v.id,
        v.trade_date,
        v.security_name,
        v.client_name,
        v.action,
        v.quantity,
        v.price,
        v.total_value,
        COALESCE(i.security_slug, s.security_slug, blk.security_slug, blk2.security_slug, '') as security_slug,
        COALESCE(i.person_category, s.person_category) as person_category
    FROM stockedge_all_deals_view v
    LEFT JOIN stockedge_insider_deals i ON v.id = i.id AND v.deal_category = 'Insider Trading'
    LEFT JOIN stockedge_sast_deals s ON v.id = s.id AND v.deal_category = 'SAST Deals'
    LEFT JOIN stockedge_block_deals blk ON v.id = blk.id AND v.deal_category = 'Block Deals'
    LEFT JOIN stockedge_bulk_deals blk2 ON v.id = blk2.id AND v.deal_category = 'Bulk Deals'
    WHERE v.action = ANY(%s)
      AND v.trade_date >= %s AND v.trade_date <= %s
    ORDER BY v.trade_date ASC, v.id ASC;
    """
    rows = fetch_all(query, (list(cfg.CONVICTION_ACTIONS), start_date, as_of_date))

    matcher.initialize()
    matched = []
    for r in rows:
        match = matcher.resolve_symbol_detailed(r["security_name"], r.get("security_slug"))
        _tally(audit, match["match_status"])
        if match["match_status"] in (MatchStatus.MATCHED, MatchStatus.MANUAL_OVERRIDE) and match["resolved_nse_symbol"] == symbol:
            r["trade_date"] = to_date(r["trade_date"])
            r["role"] = classify_role(r.get("person_category"))
            r["match_status"] = match["match_status"]
            r["match_method"] = match["match_method"]
            r["match_confidence"] = match["match_confidence"]
            matched.append(r)
    return matched


def load_active_symbols(
    lookback_days: int = cfg.CURRENT_LOOKBACK_DAYS,
    as_of_date: Optional[date] = None,
    audit: Optional[Dict[str, int]] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Batch equivalent of load_symbol_deals: loads all BUY/SELL conviction
    deals in the lookback window ONCE, resolves symbols ONCE (matcher is
    cached), and groups by resolved symbol. Used by the ranking endpoint so
    scoring many stocks costs one deals query + one price query total,
    instead of one pair per symbol (avoids N+1).

    CRITICAL: only MATCHED/MANUAL_OVERRIDE deals are grouped/returned; see
    load_symbol_deals for the same exclusion + audit-tallying rationale.
    """
    as_of_date = as_of_date or date.today()
    start_date = as_of_date - timedelta(days=lookback_days)

    query = """
    SELECT
        v.deal_category,
        v.id,
        v.trade_date,
        v.security_name,
        v.client_name,
        v.action,
        v.quantity,
        v.price,
        v.total_value,
        COALESCE(i.security_slug, s.security_slug, blk.security_slug, blk2.security_slug, '') as security_slug,
        COALESCE(i.person_category, s.person_category) as person_category
    FROM stockedge_all_deals_view v
    LEFT JOIN stockedge_insider_deals i ON v.id = i.id AND v.deal_category = 'Insider Trading'
    LEFT JOIN stockedge_sast_deals s ON v.id = s.id AND v.deal_category = 'SAST Deals'
    LEFT JOIN stockedge_block_deals blk ON v.id = blk.id AND v.deal_category = 'Block Deals'
    LEFT JOIN stockedge_bulk_deals blk2 ON v.id = blk2.id AND v.deal_category = 'Bulk Deals'
    WHERE v.action = ANY(%s)
      AND v.trade_date >= %s AND v.trade_date <= %s
    ORDER BY v.trade_date ASC, v.id ASC;
    """
    rows = fetch_all(query, (list(cfg.CONVICTION_ACTIONS), start_date, as_of_date))

    matcher.initialize()
    grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        match = matcher.resolve_symbol_detailed(r["security_name"], r.get("security_slug"))
        _tally(audit, match["match_status"])
        if match["match_status"] not in (MatchStatus.MATCHED, MatchStatus.MANUAL_OVERRIDE):
            continue
        r["trade_date"] = to_date(r["trade_date"])
        r["role"] = classify_role(r.get("person_category"))
        r["match_status"] = match["match_status"]
        r["match_method"] = match["match_method"]
        r["match_confidence"] = match["match_confidence"]
        grouped[match["resolved_nse_symbol"]].append(r)
    return grouped


def load_price_window(
    symbols: List[str],
    min_date: date,
    max_date: date,
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Loads OHLCV + delivery_pct candles for the given symbols within
    [min_date, max_date] (inclusive), sorted ascending per symbol. Only ever
    reads price data with trade_date <= max_date, so callers control the
    look-ahead boundary by choosing max_date (typically "as_of_date").
    """
    if not symbols:
        return {}

    rows = fetch_all(
        """
        SELECT symbol, trade_date, open, high, low, close, volume, delivery_pct
        FROM nse_equity_eod
        WHERE symbol = ANY(%s) AND trade_date >= %s AND trade_date <= %s
        ORDER BY symbol, trade_date ASC;
        """,
        (symbols, min_date, max_date),
    )

    price_map: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in rows:
        price_map[r["symbol"]].append({
            "trade_date": to_date(r["trade_date"]),
            "open": safe_float(r["open"]),
            "high": safe_float(r["high"]),
            "low": safe_float(r["low"]),
            "close": safe_float(r["close"]),
            "volume": int(r["volume"]) if r["volume"] is not None else None,
            "delivery_pct": float(r["delivery_pct"]) if r["delivery_pct"] is not None else None,
        })
    return price_map
