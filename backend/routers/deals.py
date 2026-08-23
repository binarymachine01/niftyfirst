"""
API Router for StockEdge Deals & Insider Trading exploration.
"""

from typing import Optional
from fastapi import APIRouter, Query, HTTPException
try:
    from backend.database import fetch_all, fetch_one
except ImportError:
    from ..database import fetch_all, fetch_one

router = APIRouter(prefix="/api/deals", tags=["Deals"])


@router.get("")
def get_deals(
    category: Optional[str] = Query(None, description="Filter by deal category"),
    action: Optional[str] = Query(None, description="Filter by action (BUY, SELL)"),
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
        mode_description,
        created_at
    FROM stockedge_all_deals_view
    WHERE 1=1
    """
    params = []

    if category and category != "all":
        query += " AND deal_category = %s"
        params.append(category)

    if action and action != "all":
        query += " AND action = %s"
        params.append(action.upper())

    if search:
        query += " AND (security_name ILIKE %s OR client_name ILIKE %s)"
        params.extend([f"%{search}%", f"%{search}%"])

    if start_date:
        query += " AND trade_date >= %s"
        params.append(start_date)

    if end_date:
        query += " AND trade_date <= %s"
        params.append(end_date)

    # Count total
    count_query = f"SELECT count(*) as count FROM ({query}) sub;"
    total_row = fetch_one(count_query, tuple(params))
    total_count = total_row["count"] if total_row else 0

    query += " ORDER BY trade_date DESC, id DESC LIMIT %s OFFSET %s;"
    params.extend([page_size, offset])

    rows = fetch_all(query, tuple(params))

    # Format dates
    for r in rows:
        if r.get("trade_date"):
            r["trade_date"] = str(r["trade_date"])
        if r.get("created_at"):
            r["created_at"] = str(r["created_at"])

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
