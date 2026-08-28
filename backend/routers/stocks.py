"""
API Router for Stock Price History and Deal Overlays.
"""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query
try:
    from backend.database import fetch_all
    from backend.engine.symbol_matcher import matcher
    from backend.engine.reaction import annotate_price_reactions
except ImportError:
    from ..database import fetch_all
    from ..engine.symbol_matcher import matcher
    from ..engine.reaction import annotate_price_reactions

router = APIRouter(prefix="/api/stocks", tags=["Stocks"])


@router.get("/list")
def get_available_stocks(search: Optional[str] = None, limit: int = 50):
    """Returns list of distinct traded symbols in nse_equity_eod."""
    query = "SELECT DISTINCT symbol FROM nse_equity_eod"
    params = []
    if search:
        query += " WHERE symbol ILIKE %s"
        params.append(f"%{search}%")
    query += " ORDER BY symbol ASC LIMIT %s;"
    params.append(limit)

    rows = fetch_all(query, tuple(params))
    return {"symbols": [r["symbol"] for r in rows]}


@router.get("/{symbol}/history")
def get_stock_history(
    symbol: str,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    """Returns daily OHLCV candles for charting."""
    query = """
    SELECT
        trade_date,
        open,
        high,
        low,
        close,
        volume,
        delivery_qty,
        delivery_pct
    FROM nse_equity_eod
    WHERE symbol = %s
    """
    params = [symbol.upper()]

    if start_date:
        query += " AND trade_date >= %s"
        params.append(start_date)
    if end_date:
        query += " AND trade_date <= %s"
        params.append(end_date)

    query += " ORDER BY trade_date ASC;"

    candles = fetch_all(query, tuple(params))
    if not candles:
        raise HTTPException(status_code=404, detail=f"No price history found for symbol '{symbol}'")

    for c in candles:
        c["trade_date"] = str(c["trade_date"])
        c["open"] = float(c["open"]) if c["open"] is not None else 0.0
        c["high"] = float(c["high"]) if c["high"] is not None else 0.0
        c["low"] = float(c["low"]) if c["low"] is not None else 0.0
        c["close"] = float(c["close"]) if c["close"] is not None else 0.0

    return {"symbol": symbol.upper(), "count": len(candles), "candles": candles}


@router.get("/{symbol}/deals")
def get_stock_deals(symbol: str):
    """Returns all insider and large deals associated with this stock."""
    # Find matching deals
    query = """
    SELECT
        deal_category,
        id,
        trade_date,
        exchange_name,
        security_name,
        client_name,
        action,
        quantity,
        price,
        total_value,
        mode_description
    FROM stockedge_all_deals_view
    WHERE security_name ILIKE %s OR security_name ILIKE %s
    ORDER BY trade_date DESC;
    """
    rows = fetch_all(query, (f"%{symbol}%", f"{symbol}%"))
    for r in rows:
        r["trade_date"] = str(r["trade_date"])

    annotate_price_reactions(rows, symbol_override=symbol.upper())

    return {"symbol": symbol.upper(), "deals": rows}
