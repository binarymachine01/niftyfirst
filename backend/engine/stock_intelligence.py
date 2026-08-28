"""
Stock Intelligence Orchestrator (Phase 4).

Assembles the consolidated research view for a single stock by REUSING,
never recalculating:
  - backend/engine/conviction/market_data.py  -> deals + price loaders (the
    same look-ahead-safe, batched loaders Phase 1/2 already use)
  - backend/engine/screener/screener.py:build_candidate -> Conviction Score
    (Phase 1, unmodified formula), technicals (Phase 2), insider-window
    metrics (Phase 2) - computed exactly once
  - backend/engine/screener/ranking.py -> Signal Strength + Historical Win
    Rate reader (Phase 2, unmodified)
  - backend/engine/conviction/explanations.py -> the base "why this score"
    bullets (Phase 1, unmodified)

This module only retrieves already-loaded data and assembles a response -
it contains no scoring, ranking, or historical-signal math of its own.
"""

import logging
from datetime import date, timedelta
from typing import Dict, Any, List, Optional

try:
    from backend.database import fetch_one
    from backend.engine.conviction import market_data as conviction_market_data
    from backend.engine.conviction import configuration as conviction_cfg
    from backend.engine.conviction import explanations as conviction_explanations
    from backend.engine.conviction.scorer import serialize_deal
    from backend.engine.screener.screener import build_candidate
    from backend.engine.screener import ranking as screener_ranking
    from backend.engine.screener import configuration as screener_cfg
except ImportError:
    from ..database import fetch_one
    from .conviction import market_data as conviction_market_data
    from .conviction import configuration as conviction_cfg
    from .conviction import explanations as conviction_explanations
    from .conviction.scorer import serialize_deal
    from .screener.screener import build_candidate
    from .screener import ranking as screener_ranking
    from .screener import configuration as screener_cfg

logger = logging.getLogger(__name__)

# Windows shown in the Historical Signal Performance section (spec: 1D/5D/10D/20D/60D).
# Read from factors.compute_historical_success's own by_window breakdown - not recomputed here.
DISPLAY_HISTORICAL_WINDOWS = (1, 5, 10, 20, 60)


def resolve_and_validate_symbol(symbol: str) -> Optional[str]:
    symbol = symbol.upper().strip()
    row = fetch_one("SELECT 1 FROM nse_equity_eod WHERE symbol = %s LIMIT 1;", (symbol,))
    return symbol if row else None


def _build_header(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Latest price/change and 52-week high/low, read directly from already-loaded candles."""
    if not candles:
        return {
            "latest_price": None, "prev_close": None, "change": None, "change_pct": None,
            "week_52_high": None, "week_52_low": None, "latest_trade_date": None,
        }

    sorted_candles = sorted(candles, key=lambda c: c["trade_date"])
    latest = sorted_candles[-1]
    prev = sorted_candles[-2] if len(sorted_candles) > 1 else None
    change = (latest["close"] - prev["close"]) if prev else None
    change_pct = (change / prev["close"] * 100.0) if (prev and prev["close"]) else None

    window = sorted_candles[-252:]  # ~52 trading weeks, whatever history exists up to that cap
    highs = [c["high"] for c in window if c.get("high") is not None]
    lows = [c["low"] for c in window if c.get("low") is not None]

    return {
        "latest_price": round(latest["close"], 2),
        "prev_close": round(prev["close"], 2) if prev else None,
        "change": round(change, 2) if change is not None else None,
        "change_pct": round(change_pct, 2) if change_pct is not None else None,
        "week_52_high": round(max(highs), 2) if highs else None,
        "week_52_low": round(min(lows), 2) if lows else None,
        "latest_trade_date": str(latest["trade_date"]),
    }


def _build_repeat_buyers(buyer_counts: Dict[str, int]) -> List[Dict[str, Any]]:
    return [
        {"client_name": name, "purchase_count": count}
        for name, count in sorted(buyer_counts.items(), key=lambda kv: kv[1], reverse=True)
        if count > 1
    ]


def _build_deal_activity(deals: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Breakdown by deal_category (Insider Trading/SAST/Block/Bulk) - reuses the existing classification, no new taxonomy."""
    breakdown: Dict[str, Dict[str, Any]] = {}
    for d in deals:
        cat = d.get("deal_category", "Unknown")
        b = breakdown.setdefault(cat, {"buy_count": 0, "sell_count": 0, "buy_value": 0.0, "sell_value": 0.0, "has_value": False})
        value = float(d["total_value"]) if d.get("total_value") is not None else None
        if d["action"] == "BUY":
            b["buy_count"] += 1
            if value is not None:
                b["buy_value"] += value
                b["has_value"] = True
        elif d["action"] == "SELL":
            b["sell_count"] += 1
            if value is not None:
                b["sell_value"] += value
                b["has_value"] = True

    return {
        cat: {
            "buy_count": b["buy_count"],
            "sell_count": b["sell_count"],
            "buy_value": round(b["buy_value"], 2) if b["has_value"] else None,
            "sell_value": round(b["sell_value"], 2) if b["has_value"] else None,
        }
        for cat, b in breakdown.items()
    }


def _build_historical_signal_windows(conviction_result: Dict[str, Any]) -> Dict[str, Any]:
    """Reads the by_window breakdown factors.compute_historical_success already computes (Phase 1) - no recalculation."""
    hs = conviction_result["components"]["historical_success"]
    by_window = hs["metrics"].get("by_window", {})
    out = {}
    for w in DISPLAY_HISTORICAL_WINDOWS:
        entry = by_window.get(str(w))
        if entry and entry["available"]:
            out[f"{w}d"] = entry
        else:
            out[f"{w}d"] = {
                "available": False,
                "sample_size": entry["sample_size"] if entry else 0,
                "positive_count": None, "pct_positive": None, "avg_return": None, "median_return": None,
            }
    return out


def _build_explanation(candidate: Dict[str, Any]) -> Dict[str, Any]:
    """Layers Phase 2's Signal Strength reasons onto Phase 1's own explanation bullets - no new explanation engine."""
    base = conviction_explanations.generate_explanation(candidate["conviction"])
    signal = screener_ranking.classify_signal_strength(candidate)

    positive = list(base["positive"])
    for reason in signal["reasons"]:
        bullet = f"{reason} (contributes to Signal Strength)"
        if bullet not in positive:
            positive.append(bullet)

    return {
        "headline": base["headline"],
        "components_summary": base["components_summary"],
        "confidence_summary": base["confidence_summary"],
        "positive": positive,
        "negative": base["negative"],
        "disclaimer": base["disclaimer"],
        "signal_strength": signal["tier"],
        "signal_reasons": signal["reasons"],
    }


def get_stock_intelligence(symbol: str, as_of_date: Optional[date] = None) -> Optional[Dict[str, Any]]:
    """
    Returns the full consolidated Stock Intelligence payload, or None if the
    symbol is unknown. as_of_date defaults to today and bounds every query,
    inherited from the same conviction_market_data loaders Phase 1 already
    uses - no separate look-ahead-bias mechanism is introduced here.
    """
    as_of_date = as_of_date or date.today()
    resolved_symbol = resolve_and_validate_symbol(symbol)
    if not resolved_symbol:
        return None

    mapping_audit = conviction_market_data.new_mapping_audit()
    historical_deals = conviction_market_data.load_symbol_deals(
        resolved_symbol, lookback_days=conviction_cfg.HISTORICAL_LOOKBACK_DAYS, as_of_date=as_of_date, audit=mapping_audit
    )
    insider_window_start = as_of_date - timedelta(days=conviction_cfg.CURRENT_LOOKBACK_DAYS)
    insider_window_deals = [d for d in historical_deals if d["trade_date"] >= insider_window_start]

    all_deal_dates = [d["trade_date"] for d in historical_deals if d.get("trade_date")]
    deal_based_min_date = (
        min(all_deal_dates) - timedelta(days=conviction_cfg.VOLUME_BASELINE_LOOKBACK_DAYS + conviction_cfg.VOLUME_BASELINE_GAP_DAYS)
    ) if all_deal_dates else as_of_date
    # Always load at least enough price history for the 200-day DMA / 52-week
    # window regardless of deal history depth (a stock with no deals at all
    # should still show a full price chart and technicals).
    technical_min_date = as_of_date - timedelta(days=screener_cfg.PRICE_HISTORY_CALENDAR_DAYS)
    min_date = min(deal_based_min_date, technical_min_date)

    price_map = conviction_market_data.load_price_window([resolved_symbol], min_date, as_of_date)
    candles = price_map.get(resolved_symbol, [])

    candidate = build_candidate(resolved_symbol, historical_deals, insider_window_deals, candles, as_of_date, symbol_mapping_audit=mapping_audit)
    win_rate = screener_ranking.historical_win_rate(candidate)
    signal = screener_ranking.classify_signal_strength(candidate)

    sorted_recent_deals = sorted(historical_deals, key=lambda d: d["trade_date"], reverse=True)
    # No company-name table exists anywhere in this deployment (confirmed in
    # Phase 1 inspection) - sourced from the most recent real deal record
    # instead of fabricated. None if the symbol has no deal history at all.
    company_name = sorted_recent_deals[0].get("security_name") if sorted_recent_deals else None

    header = _build_header(candles)
    header["company_name"] = company_name

    return {
        "symbol": resolved_symbol,
        "as_of_date": str(as_of_date),
        "header": header,
        "conviction": candidate["conviction"],
        "signal": {"tier": signal["tier"], "reasons": signal["reasons"], "evidence_count": signal["evidence_count"]},
        "technical": candidate["technical"],
        "insider_activity": {
            "buy_value": candidate["insider"]["buy_value"],
            "sell_value": candidate["insider"]["sell_value"],
            "net_value": candidate["insider"]["net_value"],
            "unique_insiders": candidate["insider"]["unique_insiders"],
            "promoter_buying": candidate["insider"]["promoter_buying"],
            "repeat_buying": candidate["insider"]["repeat_buying"],
            "repeat_buyers": _build_repeat_buyers(candidate["insider"]["buyer_counts"]),
            "window_days": conviction_cfg.CURRENT_LOOKBACK_DAYS,
        },
        "transactions": [serialize_deal(d) for d in sorted_recent_deals],
        "deal_activity": _build_deal_activity(historical_deals),
        "historical_signal_performance": {
            "windows": _build_historical_signal_windows(candidate["conviction"]),
            "primary_20d": win_rate,
        },
        "explanation": _build_explanation(candidate),
        "data_quality": candidate["conviction"]["data_quality"],
    }
