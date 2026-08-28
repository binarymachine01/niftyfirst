"""
Smart Stock Screener orchestration.

Data flow (mirrors the batching pattern established in
backend/engine/conviction/scorer.py:score_active_symbols):
  1. One deals query for the whole active-symbol universe.
  2. One price-history query for the whole universe.
  3. Per-symbol: build the Conviction result via the EXISTING
     conviction_scorer.build_result() (Phase 1, reused as-is - no
     duplicate scoring), compute technical/insider-window metrics from the
     same already-loaded data, evaluate filters, then sort/paginate the
     already-computed in-memory result set.

No look-ahead bias: every price/deal query is bounded by as_of_date (same
mechanism as the Conviction Engine), and this module never reads or
computes anything the Conviction Engine itself doesn't already guarantee
is bounded that way.
"""

import logging
from datetime import date, timedelta
from typing import List, Dict, Any, Optional

try:
    from backend.engine.conviction import market_data as conviction_market_data
    from backend.engine.conviction import scorer as conviction_scorer
    from backend.engine.conviction import configuration as conviction_cfg
    from backend.engine import technical_analysis as ta
except ImportError:
    from ..conviction import market_data as conviction_market_data
    from ..conviction import scorer as conviction_scorer
    from ..conviction import configuration as conviction_cfg
    from .. import technical_analysis as ta

from . import configuration as cfg
from . import filters as flt
from . import ranking

logger = logging.getLogger(__name__)


def _compute_insider_window_metrics(deals_in_window: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Aggregates over the USER'S chosen insider lookback window - a separate
    concern from the Conviction Score's own fixed 180-day methodology.
    Deals lacking a known total_value simply don't contribute to the value
    sums (never treated as ₹0); total_value/net_value are None only when
    NO deal in the window has a known value at all.
    """
    buys = [d for d in deals_in_window if d["action"] == "BUY"]
    sells = [d for d in deals_in_window if d["action"] == "SELL"]
    unique_buyers = {d["client_name"] for d in buys if d.get("client_name")}
    unique_sellers = {d["client_name"] for d in sells if d.get("client_name")}

    buy_values = [float(d["total_value"]) for d in buys if d.get("total_value") is not None]
    sell_values = [float(d["total_value"]) for d in sells if d.get("total_value") is not None]
    has_any_value = bool(buy_values or sell_values)

    buyer_counts: Dict[str, int] = {}
    for d in buys:
        if d.get("client_name"):
            buyer_counts[d["client_name"]] = buyer_counts.get(d["client_name"], 0) + 1

    return {
        "buy_count": len(buys),
        "sell_count": len(sells),
        "unique_buyers": unique_buyers,
        "unique_sellers": unique_sellers,
        # Simple total for display (the results table's plain "Insider Count"
        # column) - direction-specific counting for the min_insiders FILTER
        # happens separately in filters.evaluate_insider, since a filter
        # combined with the BUY/SELL toggles should count insiders matching
        # those active direction(s), not an unqualified union.
        "unique_insiders": len(unique_buyers | unique_sellers),
        # buy_value/sell_value expose the two sides separately (e.g. Stock
        # Intelligence's "Buying: X / Selling: Y / Net: Z" display);
        # total_value/net_value are kept for backward-compatible screener use.
        "buy_value": sum(buy_values) if buy_values else None,
        "sell_value": sum(sell_values) if sell_values else None,
        "total_value": (sum(buy_values) + sum(sell_values)) if has_any_value else None,
        "net_value": (sum(buy_values) - sum(sell_values)) if has_any_value else None,
        "promoter_buying": any(d.get("role") == "Promoter" for d in buys),
        "repeat_buying": any(c > 1 for c in buyer_counts.values()),
        "buyer_counts": buyer_counts,
    }


def build_candidate(
    symbol: str,
    historical_deals: List[Dict[str, Any]],
    insider_window_deals: List[Dict[str, Any]],
    candles: List[Dict[str, Any]],
    as_of_date: date,
    symbol_mapping_audit: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """One symbol's full computed picture: Conviction (reused), insider-window metrics, technicals."""
    conviction_current_start = as_of_date - timedelta(days=conviction_cfg.CURRENT_LOOKBACK_DAYS)
    conviction_current_deals = [d for d in historical_deals if d["trade_date"] >= conviction_current_start]
    conviction_historical_buys = [d for d in historical_deals if d["action"] == "BUY"]

    conviction_result = conviction_scorer.build_result(
        symbol, conviction_current_deals, conviction_historical_buys, candles, as_of_date,
        symbol_mapping_audit=symbol_mapping_audit,
    )

    return {
        "symbol": symbol,
        "conviction": conviction_result,
        "insider": _compute_insider_window_metrics(insider_window_deals),
        "technical": ta.compute_all(candles),
    }


def _row_for_candidate(candidate: Dict[str, Any]) -> Dict[str, Any]:
    conviction = candidate["conviction"]
    technical = candidate["technical"]
    insider = candidate["insider"]
    signal = ranking.classify_signal_strength(candidate)
    win_rate = ranking.historical_win_rate(candidate)

    return {
        "symbol": candidate["symbol"],
        "conviction_score": conviction["overall_score"] if conviction else None,
        "conviction_confidence": conviction["confidence"]["tier"] if conviction else None,
        "insider_value": insider["net_value"],
        "insider_count": insider["unique_insiders"],
        "return_1d": technical["returns"]["1d"],
        "return_5d": technical["returns"]["5d"],
        "return_20d": technical["returns"]["20d"],
        "return_3m": technical["returns"]["3m"],
        "return_6m": technical["returns"]["6m"],
        "week_52_position": technical["week_52_position"],
        "rsi": technical["rsi"],
        "volume_ratio": technical["volume_ratio"],
        "delivery_pct": technical["delivery"]["current_delivery_pct"],
        "delivery_increase": technical["delivery"]["delivery_increase"],
        "historical_win_rate": win_rate["pct_positive"],
        "historical_win_rate_sample": win_rate["sample_size"],
        "historical_win_rate_available": win_rate["available"],
        "signal_strength": signal["tier"],
        "signal_strength_rank": signal["rank"],
        "signal_reasons": signal["reasons"],
        # Price Momentum is presented as the 20-trading-day return, the same
        # primary window the Conviction Engine's Price Confirmation factor
        # highlights - no separate composite metric is invented.
        "price_momentum": technical["returns"]["20d"],
        "latest_close": technical["latest_close"],
        "above_20dma": technical["dma"]["above_dma_20"],
        "above_50dma": technical["dma"]["above_dma_50"],
        "above_200dma": technical["dma"]["above_dma_200"],
        "breakout": technical["breakout"]["is_breakout"],
    }


def paginate(rows: List[Dict[str, Any]], page: int, page_size: int):
    """Pure pagination helper: returns (total_count, total_pages, page_rows) with rank stamped onto each row."""
    total_count = len(rows)
    total_pages = max(1, (total_count + page_size - 1) // page_size)
    start = (page - 1) * page_size
    page_rows = rows[start:start + page_size]
    for idx, row in enumerate(page_rows):
        row["rank"] = start + idx + 1
    return total_count, total_pages, page_rows


def run_screener(req: flt.ScreenerRequest, as_of_date: Optional[date] = None) -> Dict[str, Any]:
    as_of_date = as_of_date or date.today()

    widest_lookback = cfg.universe_lookback_days(req.insider.lookback_days)
    mapping_audit = conviction_market_data.new_mapping_audit()
    grouped_deals = conviction_market_data.load_active_symbols(lookback_days=widest_lookback, as_of_date=as_of_date, audit=mapping_audit)

    grouped_deals = {
        symbol: flt.filter_deals_by_category(deals, req.deals.categories)
        for symbol, deals in grouped_deals.items()
    }
    grouped_deals = {symbol: deals for symbol, deals in grouped_deals.items() if deals}

    insider_window_start = as_of_date - timedelta(days=req.insider.lookback_days)
    universe_symbols = [
        symbol for symbol, deals in grouped_deals.items()
        if any(d["trade_date"] >= insider_window_start for d in deals)
    ]

    if not universe_symbols:
        return {
            "results": [], "total_count": 0, "page": req.page, "page_size": req.page_size,
            "total_pages": 1, "universe_size": 0, "as_of_date": str(as_of_date),
            "top_exclusion_reasons": [], "symbol_mapping_audit": mapping_audit,
        }

    min_price_date = as_of_date - timedelta(days=cfg.PRICE_HISTORY_CALENDAR_DAYS)
    price_map = conviction_market_data.load_price_window(universe_symbols, min_price_date, as_of_date)

    candidates = []
    for symbol in universe_symbols:
        try:
            historical_deals = grouped_deals[symbol]
            insider_window_deals = [d for d in historical_deals if d["trade_date"] >= insider_window_start]
            candles = price_map.get(symbol, [])
            candidates.append(build_candidate(symbol, historical_deals, insider_window_deals, candles, as_of_date, symbol_mapping_audit=mapping_audit))
        except Exception as e:
            logger.warning(f"Screener failed to build candidate for {symbol}: {e}")

    passing_rows = []
    failure_tally: Dict[str, int] = {}
    for candidate in candidates:
        passes, failures = flt.evaluate_all(candidate, req)
        if passes:
            passing_rows.append(_row_for_candidate(candidate))
        else:
            for f in failures:
                failure_tally[f] = failure_tally.get(f, 0) + 1

    sorted_rows = ranking.sort_results(passing_rows, req.sort.field, req.sort.direction)
    total_count, total_pages, page_rows = paginate(sorted_rows, req.page, req.page_size)

    # Most-common exclusion reasons across the whole candidate set, so the UI
    # can tell the user which filter is most restrictive when results are
    # empty or sparse (spec: "show which filters are most restrictive").
    top_exclusion_reasons = sorted(failure_tally.items(), key=lambda kv: kv[1], reverse=True)[:5]

    return {
        "results": page_rows,
        "total_count": total_count,
        "page": req.page,
        "page_size": req.page_size,
        "total_pages": total_pages,
        "universe_size": len(universe_symbols),
        "as_of_date": str(as_of_date),
        "top_exclusion_reasons": [{"reason": r, "excluded_count": c} for r, c in top_exclusion_reasons],
        "symbol_mapping_audit": mapping_audit,
    }
