"""
Price Reaction Signal Engine.
Computes how a stock's price moved N trading days after a disclosed deal,
independent of the backtesting engine's P&L simulation.
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, date, timedelta
from collections import defaultdict

try:
    from backend.database import fetch_all
    from backend.engine.symbol_matcher import matcher
except ImportError:
    from ..database import fetch_all
    from .symbol_matcher import matcher

logger = logging.getLogger(__name__)

DEFAULT_HORIZONS: Tuple[int, ...] = (1, 5, 20)


def _to_date(val: Any) -> Optional[date]:
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


def annotate_price_reactions(
    deals: List[Dict[str, Any]],
    horizons: Tuple[int, ...] = DEFAULT_HORIZONS,
    symbol_override: Optional[str] = None,
) -> None:
    """
    Mutates each deal dict in place, adding a 'price_reaction' key describing
    the raw price move (%) at each horizon (trading days) after the deal date.
    """
    if not deals:
        return

    # 1. Resolve symbol per deal
    resolved: Dict[int, Optional[str]] = {}
    deal_dates: Dict[int, date] = {}
    for idx, d in enumerate(deals):
        dt = _to_date(d.get("trade_date"))
        deal_dates[idx] = dt
        if symbol_override:
            resolved[idx] = symbol_override
        else:
            resolved[idx] = matcher.resolve_symbol(d.get("security_name"), d.get("security_slug"))

    valid_dates = [dt for dt in deal_dates.values() if dt is not None]
    if not valid_dates:
        for d in deals:
            d["price_reaction"] = {"symbol": None, "matched": False}
        return

    unique_symbols = {sym for sym in resolved.values() if sym}
    min_date = min(valid_dates)
    max_date = max(valid_dates) + timedelta(days=40)

    price_history: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    if unique_symbols:
        rows = fetch_all(
            """
            SELECT symbol, trade_date, open, close
            FROM nse_equity_eod
            WHERE symbol = ANY(%s) AND trade_date >= %s AND trade_date <= %s
            ORDER BY symbol, trade_date ASC;
            """,
            (list(unique_symbols), min_date, max_date),
        )
        for r in rows:
            price_history[r["symbol"]].append({
                "trade_date": r["trade_date"],
                "open": float(r["open"]) if r["open"] is not None else 0.0,
                "close": float(r["close"]) if r["close"] is not None else 0.0,
            })

    # 2. Compute reaction per deal
    for idx, d in enumerate(deals):
        symbol = resolved[idx]
        deal_date = deal_dates[idx]
        reaction: Dict[str, Any] = {"symbol": symbol, "matched": bool(symbol)}

        for h in horizons:
            reaction[f"{h}d"] = None

        if symbol and deal_date and symbol in price_history:
            candles = [c for c in price_history[symbol] if c["trade_date"] >= deal_date]
            if candles:
                entry_price = candles[0]["open"] if candles[0]["open"] > 0 else candles[0]["close"]
                future_candles = candles[1:]
                if entry_price and entry_price > 0:
                    for h in horizons:
                        if len(future_candles) >= h:
                            exit_price = future_candles[h - 1]["close"]
                            if exit_price and exit_price > 0:
                                reaction[f"{h}d"] = round(((exit_price - entry_price) / entry_price) * 100.0, 2)

        d["price_reaction"] = reaction
