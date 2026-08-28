"""
Insider Conviction Scoring Orchestrator.

Loads data via market_data.py, runs the six factor calculators in
factors.py, renormalizes weights across whatever components are actually
available, computes a confidence tier, and assembles the final transparent
result object returned by the API.
"""

import logging
from datetime import date, timedelta
from typing import List, Dict, Any, Optional

from . import configuration as cfg
from . import factors
from . import market_data

logger = logging.getLogger(__name__)


def _serialize_deal(d: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": d.get("id"),
        "deal_category": d.get("deal_category"),
        "trade_date": str(d["trade_date"]) if d.get("trade_date") else None,
        "client_name": d.get("client_name"),
        "role": d.get("role"),
        "action": d.get("action"),
        "quantity": float(d["quantity"]) if d.get("quantity") is not None else None,
        "price": float(d["price"]) if d.get("price") is not None else None,
        "total_value": float(d["total_value"]) if d.get("total_value") is not None else None,
    }


def compute_confidence(
    components_available: int,
    components_total: int,
    txn_count: int,
    unique_insiders: int,
    historical_available: bool,
    market_data_available: bool,
    market_cap_available: bool,
) -> Dict[str, Any]:
    """
    Transparent point rubric -> HIGH/MEDIUM/LOW. Every point is named so a
    user can see exactly why a score carries the confidence it does.
    """
    points = 0
    reasons = []

    ratio = components_available / components_total if components_total else 0
    if ratio >= 5 / 6:
        points += 2
        reasons.append(f"{components_available}/{components_total} components available (+2)")
    elif ratio >= 3 / 6:
        points += 1
        reasons.append(f"{components_available}/{components_total} components available (+1)")
    else:
        reasons.append(f"Only {components_available}/{components_total} components available (+0)")

    if txn_count >= 5:
        points += 2
        reasons.append(f"{txn_count} qualifying transactions (+2)")
    elif txn_count >= 2:
        points += 1
        reasons.append(f"{txn_count} qualifying transactions (+1)")
    else:
        reasons.append(f"Only {txn_count} qualifying transaction(s) (+0)")

    if unique_insiders >= 2:
        points += 1
        reasons.append(f"{unique_insiders} unique insiders involved (+1)")

    if historical_available:
        points += 1
        reasons.append("Historical track record available (+1)")

    if market_data_available:
        points += 1
        reasons.append("Market price data available (+1)")

    if market_cap_available:
        points += 1
        reasons.append("Market capitalization data available (+1)")
    else:
        reasons.append("Market capitalization data unavailable (+0)")

    if points >= cfg.CONFIDENCE_HIGH_THRESHOLD:
        tier = "HIGH"
    elif points >= cfg.CONFIDENCE_MEDIUM_THRESHOLD:
        tier = "MEDIUM"
    else:
        tier = "LOW"

    return {"tier": tier, "points": points, "reasons": reasons}


def build_result(
    symbol: str,
    current_deals: List[Dict[str, Any]],
    historical_buys: List[Dict[str, Any]],
    candles: List[Dict[str, Any]],
    as_of_date: date,
) -> Dict[str, Any]:
    """
    Pure scoring core: takes already-loaded deals/candles (no DB access
    here) and assembles the transparent result. Shared by both the
    single-symbol and batch ranking paths so batch scoring never re-queries
    per symbol. Public (not prefixed with _) because backend/engine/screener
    also calls this directly with its own batch-loaded data, reusing the
    exact Phase 1 scoring logic instead of recomputing conviction itself.
    """
    market_data_available = len(candles) > 0
    current_buys = [d for d in current_deals if d["action"] == "BUY"]

    market_cap = None  # No market-cap data source exists anywhere in this deployment today.

    component_results = {
        "insider_activity": factors.compute_insider_activity(current_deals, as_of_date),
        "transaction_strength": factors.compute_transaction_strength(current_deals, market_cap=market_cap),
        "accumulation": factors.compute_accumulation(current_deals),
        "price_confirmation": factors.compute_price_confirmation(current_buys, candles, as_of_date),
        "volume_delivery": factors.compute_volume_delivery(current_buys, candles),
        "historical_success": factors.compute_historical_success(historical_buys, candles, as_of_date),
    }

    available_keys = [k for k, v in component_results.items() if v["available"]]
    components_available = len(available_keys)
    components_total = len(component_results)

    if components_available == 0:
        overall_score = None
        weight_sum = 0.0
    else:
        weight_sum = sum(cfg.COMPONENT_WEIGHTS[k] for k in available_keys)
        overall_score = sum(
            component_results[k]["score"] * (cfg.COMPONENT_WEIGHTS[k] / weight_sum)
            for k in available_keys
        )
        overall_score = cfg.score_bounds(overall_score)

    components_payload = {}
    for key, result in component_results.items():
        raw_weight = cfg.COMPONENT_WEIGHTS[key]
        normalized_weight = (raw_weight / weight_sum * 100.0) if (result["available"] and weight_sum > 0) else 0.0
        weighted_contribution = (
            round(result["score"] * (normalized_weight / 100.0), 2) if result["available"] else None
        )
        components_payload[key] = {
            "label": cfg.COMPONENT_LABELS[key],
            "available": result["available"],
            "score": result["score"],
            "configured_weight_pct": raw_weight,
            "normalized_weight_pct": round(normalized_weight, 2),
            "weighted_contribution": weighted_contribution,
            "contributions": result["contributions"],
            "metrics": result["metrics"],
            "unavailable_reason": result["unavailable_reason"],
        }

    unique_insiders = len({d["client_name"] for d in current_deals if d.get("client_name")})
    confidence = compute_confidence(
        components_available=components_available,
        components_total=components_total,
        txn_count=len(current_deals),
        unique_insiders=unique_insiders,
        historical_available=component_results["historical_success"]["available"],
        market_data_available=market_data_available,
        market_cap_available=market_cap is not None,
    )

    return {
        "symbol": symbol,
        "as_of_date": str(as_of_date),
        "overall_score": round(overall_score, 2) if overall_score is not None else None,
        "components_available": components_available,
        "components_total": components_total,
        "components": components_payload,
        "confidence": confidence,
        "model_version": cfg.MODEL_VERSION,
        "supporting_transactions": [_serialize_deal(d) for d in sorted(current_deals, key=lambda d: d["trade_date"], reverse=True)],
        "data_quality": {
            "market_cap_available": market_cap is not None,
            "market_data_available": market_data_available,
            "current_window_days": cfg.CURRENT_LOOKBACK_DAYS,
            "historical_window_days": cfg.HISTORICAL_LOOKBACK_DAYS,
        },
    }


def score_symbol(symbol: str, as_of_date: Optional[date] = None) -> Dict[str, Any]:
    """
    Computes the full Insider Conviction result for a single resolved NSE
    symbol. as_of_date defaults to today and bounds every price/volume
    lookup - this is the single mechanism that prevents look-ahead bias:
    nothing dated after as_of_date is ever read.
    """
    as_of_date = as_of_date or date.today()
    symbol = symbol.upper()

    # HISTORICAL_LOOKBACK_DAYS is always >= CURRENT_LOOKBACK_DAYS, so one
    # query at the larger window covers both - current_deals is derived by
    # filtering client-side rather than issuing a second query.
    historical_deals = market_data.load_symbol_deals(symbol, lookback_days=cfg.HISTORICAL_LOOKBACK_DAYS, as_of_date=as_of_date)
    current_start = as_of_date - timedelta(days=cfg.CURRENT_LOOKBACK_DAYS)
    current_deals = [d for d in historical_deals if d["trade_date"] >= current_start]
    historical_buys = [d for d in historical_deals if d["action"] == "BUY"]

    all_dates = [d["trade_date"] for d in historical_deals if d.get("trade_date")]
    min_date = (min(all_dates) - timedelta(days=cfg.VOLUME_BASELINE_LOOKBACK_DAYS + cfg.VOLUME_BASELINE_GAP_DAYS)) if all_dates else as_of_date
    price_map = market_data.load_price_window([symbol], min_date, as_of_date)
    candles = price_map.get(symbol, [])

    return build_result(symbol, current_deals, historical_buys, candles, as_of_date)


def score_active_symbols(as_of_date: Optional[date] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """
    Batch-scores every symbol with qualifying BUY/SELL activity in the
    current lookback window. Loads ALL deals for ALL symbols in exactly one
    query (at the wider historical window) and ALL price history in exactly
    one more query - never one query pair per symbol - matching
    backtester.py's batching pattern and satisfying the "avoid N+1"
    requirement even as the active-symbol universe grows.
    """
    as_of_date = as_of_date or date.today()

    # One query at the wider historical window; the "current" grouping is
    # derived by filtering client-side (same optimization as score_symbol).
    historical_grouped = market_data.load_active_symbols(lookback_days=cfg.HISTORICAL_LOOKBACK_DAYS, as_of_date=as_of_date)
    current_start = as_of_date - timedelta(days=cfg.CURRENT_LOOKBACK_DAYS)
    current_grouped = {
        symbol: [d for d in deals if d["trade_date"] >= current_start]
        for symbol, deals in historical_grouped.items()
    }
    current_grouped = {symbol: deals for symbol, deals in current_grouped.items() if deals}

    symbols = list(current_grouped.keys())
    if not symbols:
        return []

    all_dates = [d["trade_date"] for deals in historical_grouped.values() for d in deals if d.get("trade_date")]
    min_date = (min(all_dates) - timedelta(days=cfg.VOLUME_BASELINE_LOOKBACK_DAYS + cfg.VOLUME_BASELINE_GAP_DAYS)) if all_dates else as_of_date
    price_map = market_data.load_price_window(symbols, min_date, as_of_date)

    results = []
    for symbol in symbols:
        try:
            current_deals = current_grouped.get(symbol, [])
            historical_buys = [d for d in historical_grouped.get(symbol, []) if d["action"] == "BUY"]
            candles = price_map.get(symbol, [])
            result = build_result(symbol, current_deals, historical_buys, candles, as_of_date)
            if result["overall_score"] is not None:
                results.append(result)
        except Exception as e:
            logger.warning(f"Failed to score symbol {symbol}: {e}")

    results.sort(key=lambda r: r["overall_score"], reverse=True)
    return results[:limit]
