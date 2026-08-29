"""
API Router for StockEdge Deals & Insider Trading exploration.
"""

from typing import Optional
from fastapi import APIRouter, Query, HTTPException
try:
    from backend.database import fetch_all, fetch_one
    from backend.engine.reaction import annotate_price_reactions
except ImportError:
    from ..database import fetch_all, fetch_one
    from ..engine.reaction import annotate_price_reactions

# scripts.common is always resolved as a top-level package relative to the
# project root (inserted into sys.path by backend/main.py), regardless of
# how backend itself was imported - no try/except fallback needed here.
from scripts.common import ENABLED_EXCHANGES, DEFAULT_EXCHANGE, SUPPORTED_EXCHANGES, DEFAULT_EXCHANGES

router = APIRouter(prefix="/api/deals", tags=["Deals"])


@router.get("")
def get_deals(
    category: Optional[str] = Query(None, description="Filter by deal category"),
    action: Optional[str] = Query(None, description="Filter by action (BUY, SELL)"),
    exchange: Optional[str] = Query(None, description="Filter by exchange (e.g. NSE)"),
    search: Optional[str] = Query(None, description="Search security name or client name"),
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Returns paginated and filterable list of deals from consolidated view."""
    offset = (page - 1) * page_size
    query = """
    SELECT
        v.deal_category,
        v.id,
        v.symbol,
        v.trade_date,
        v.exchange_name,
        v.security_name,
        v.client_name,
        v.action,
        v.quantity,
        v.price,
        v.total_value,
        v.mode_description,
        v.created_at,
        COALESCE(i.security_slug, s.security_slug, blk.security_slug, blk2.security_slug, '') as security_slug
    FROM stockedge_all_deals_view v
    LEFT JOIN stockedge_insider_deals i ON v.id = i.id AND v.deal_category = 'Insider Trading'
    LEFT JOIN stockedge_sast_deals s ON v.id = s.id AND v.deal_category = 'SAST Deals'
    LEFT JOIN stockedge_block_deals blk ON v.id = blk.id AND v.deal_category = 'Block Deals'
    LEFT JOIN stockedge_bulk_deals blk2 ON v.id = blk2.id AND v.deal_category = 'Bulk Deals'
    WHERE 1=1
    """
    params = []

    if category and isinstance(category, str) and category != "all":
        query += " AND v.deal_category = %s"
        params.append(category)

    if action and isinstance(action, str) and action != "all":
        query += " AND v.action = %s"
        params.append(action.upper())

    if exchange and isinstance(exchange, str) and exchange != "all":
        query += " AND UPPER(v.exchange_name) = %s"
        params.append(exchange.upper())

    if search and isinstance(search, str):
        query += " AND (v.symbol ILIKE %s OR v.security_name ILIKE %s OR v.client_name ILIKE %s)"
        params.extend([f"%{search}%", f"%{search}%", f"%{search}%"])

    if start_date and isinstance(start_date, str):
        query += " AND v.trade_date >= %s"
        params.append(start_date)

    if end_date and isinstance(end_date, str):
        query += " AND v.trade_date <= %s"
        params.append(end_date)

    # Count total
    count_query = f"SELECT count(*) as count FROM ({query}) sub;"
    total_row = fetch_one(count_query, tuple(params))
    total_count = total_row["count"] if total_row else 0

    query += " ORDER BY v.trade_date DESC, v.id DESC LIMIT %s OFFSET %s;"
    params.extend([page_size, offset])

    rows = fetch_all(query, tuple(params))

    # Format dates
    for r in rows:
        if r.get("trade_date"):
            r["trade_date"] = str(r["trade_date"])
        if r.get("created_at"):
            r["created_at"] = str(r["created_at"])

    annotate_price_reactions(rows)
    for r in rows:
        r.pop("security_slug", None)

    return {
        "page": page,
        "page_size": page_size,
        "total_count": total_count,
        "total_pages": (total_count + page_size - 1) // page_size if total_count > 0 else 1,
        "deals": rows,
    }


@router.get("/summary")
def get_deals_summary():
    """Returns aggregate summary statistics for all deal categories."""
    summary_query = """
    SELECT
        deal_category,
        count(*) as count,
        SUM(CASE WHEN action = 'BUY' THEN 1 ELSE 0 END) as buy_count,
        SUM(CASE WHEN action = 'SELL' THEN 1 ELSE 0 END) as sell_count,
        COALESCE(SUM(total_value), 0) as total_turnover
    FROM stockedge_all_deals_view
    GROUP BY deal_category;
    """
    category_stats = fetch_all(summary_query)

    top_securities_query = """
    SELECT
        security_name,
        count(*) as deal_count,
        SUM(CASE WHEN action = 'BUY' THEN 1 ELSE 0 END) as buy_count,
        SUM(CASE WHEN action = 'SELL' THEN 1 ELSE 0 END) as sell_count,
        COALESCE(SUM(total_value), 0) as total_turnover
    FROM stockedge_all_deals_view
    GROUP BY security_name
    ORDER BY deal_count DESC
    LIMIT 10;
    """
    top_securities = fetch_all(top_securities_query)

    return {
        "by_category": category_stats,
        "top_securities": top_securities,
    }


@router.get("/exchanges")
def get_deal_exchanges():
    """
    Returns the exchange configuration alongside whatever exchanges
    actually appear in stored deals.
    """
    rows = fetch_all("SELECT DISTINCT exchange_name FROM stockedge_all_deals_view WHERE exchange_name IS NOT NULL ORDER BY exchange_name;")
    available = [r["exchange_name"] for r in rows if r["exchange_name"]]
    return {
        "supported_exchanges": SUPPORTED_EXCHANGES,
        "enabled_exchanges": ENABLED_EXCHANGES,
        "default_exchange": DEFAULT_EXCHANGE,
        "default_exchanges": DEFAULT_EXCHANGES,
        "available_exchanges": available,
    }


@router.get("/clients/{client_name}")
def get_client_drilldown(client_name: str):
    """Returns full deal history and aggregate stats for a single client/promoter."""
    summary_query = """
    SELECT
        count(*) as total_deals,
        SUM(CASE WHEN action = 'BUY' THEN 1 ELSE 0 END) as buy_count,
        SUM(CASE WHEN action = 'SELL' THEN 1 ELSE 0 END) as sell_count,
        COALESCE(SUM(CASE WHEN action = 'BUY' THEN total_value ELSE 0 END), 0) as total_buy_value,
        COALESCE(SUM(CASE WHEN action = 'SELL' THEN total_value ELSE 0 END), 0) as total_sell_value,
        count(DISTINCT security_name) as distinct_securities
    FROM stockedge_all_deals_view
    WHERE LOWER(client_name) = LOWER(%s);
    """
    summary = fetch_one(summary_query, (client_name,))
    if not summary or not summary.get("total_deals"):
        raise HTTPException(status_code=404, detail=f"No deals found for client '{client_name}'")

    total_buy_value = float(summary["total_buy_value"] or 0)
    total_sell_value = float(summary["total_sell_value"] or 0)
    summary["net_value"] = round(total_buy_value - total_sell_value, 2)
    summary["total_buy_value"] = round(total_buy_value, 2)
    summary["total_sell_value"] = round(total_sell_value, 2)

    by_category_query = """
    SELECT
        deal_category,
        count(*) as count,
        SUM(CASE WHEN action = 'BUY' THEN 1 ELSE 0 END) as buy_count,
        SUM(CASE WHEN action = 'SELL' THEN 1 ELSE 0 END) as sell_count,
        COALESCE(SUM(total_value), 0) as total_turnover
    FROM stockedge_all_deals_view
    WHERE LOWER(client_name) = LOWER(%s)
    GROUP BY deal_category;
    """
    by_category = fetch_all(by_category_query, (client_name,))

    by_security_query = """
    SELECT
        security_name,
        count(*) as deal_count,
        COALESCE(SUM(CASE WHEN action = 'BUY' THEN quantity ELSE 0 END), 0) as buy_qty,
        COALESCE(SUM(CASE WHEN action = 'SELL' THEN quantity ELSE 0 END), 0) as sell_qty,
        COALESCE(SUM(CASE WHEN action = 'BUY' THEN total_value ELSE 0 END), 0) as buy_value,
        COALESCE(SUM(CASE WHEN action = 'SELL' THEN total_value ELSE 0 END), 0) as sell_value,
        MAX(trade_date) as last_deal_date
    FROM stockedge_all_deals_view
    WHERE LOWER(client_name) = LOWER(%s)
    GROUP BY security_name
    ORDER BY deal_count DESC;
    """
    by_security = fetch_all(by_security_query, (client_name,))
    for s in by_security:
        s["net_qty"] = float(s["buy_qty"] or 0) - float(s["sell_qty"] or 0)
        s["net_value"] = round(float(s["buy_value"] or 0) - float(s["sell_value"] or 0), 2)
        if s.get("last_deal_date"):
            s["last_deal_date"] = str(s["last_deal_date"])

    deals_query = """
    SELECT
        deal_category,
        id,
        symbol,
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
    WHERE LOWER(client_name) = LOWER(%s)
    ORDER BY trade_date DESC, id DESC;
    """
    deals = fetch_all(deals_query, (client_name,))
    for d in deals:
        if d.get("trade_date"):
            d["trade_date"] = str(d["trade_date"])

    return {
        "client_name": client_name,
        "summary": summary,
        "by_category": by_category,
        "by_security": by_security,
        "deals": deals,
    }
