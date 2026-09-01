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


def _unwrap(val, default):
    if val is None:
        return default
    if hasattr(val, "default"):
        return val.default
    return val


@router.get("")
def get_deals(
    category: Optional[str] = Query(None, description="Filter by deal category"),
    action: Optional[str] = Query(None, description="Filter by action (BUY, SELL)"),
    exchange: Optional[str] = Query(None, description="Filter by exchange (e.g. NSE)"),
    search: Optional[str] = Query(None, description="Search security name or client name"),
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    net_buy_only: bool = Query(False, description="Filter securities with positive net buying only"),
    sort_by: str = Query("date", description="Sort field: 'date', 'value', 'net_buy_value'"),
    sort_order: str = Query("desc", description="Sort order: 'asc', 'desc'"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Returns paginated and filterable list of deals from consolidated view."""
    page = int(_unwrap(page, 1))
    page_size = int(_unwrap(page_size, 50))
    net_buy_only = bool(_unwrap(net_buy_only, False))
    sort_by = str(_unwrap(sort_by, "date"))
    sort_order = str(_unwrap(sort_order, "desc"))
    category = _unwrap(category, None)
    action = _unwrap(action, None)
    exchange = _unwrap(exchange, None)
    search = _unwrap(search, None)
    start_date = _unwrap(start_date, None)
    end_date = _unwrap(end_date, None)

    offset = (page - 1) * page_size

    # Common security key for grouping by primary resolved NSE symbol / normalized name
    sec_key_expr = """COALESCE(
        NULLIF(v.symbol, ''),
        CASE WHEN sm.match_status IN ('MATCHED', 'MANUAL_OVERRIDE') THEN sm.resolved_nse_symbol END,
        regexp_replace(upper(regexp_replace(v.security_name, '\\m(LTD|LIMITED|INDIA|CORP|CORPORATION|INC|CO)\\M', '', 'gi')), '[^A-Z0-9]', '', 'g')
    )"""

    # Base filters (applied both for deals and net buy aggregation)
    base_where = ["1=1"]
    base_params = []

    if category and isinstance(category, str) and category != "all":
        base_where.append("v.deal_category = %s")
        base_params.append(category)

    if exchange and isinstance(exchange, str) and exchange != "all":
        base_where.append("UPPER(v.exchange_name) = %s")
        base_params.append(exchange.upper())

    if search and isinstance(search, str) and search.strip():
        term = f"%{search.strip()}%"
        base_where.append("(v.symbol ILIKE %s OR v.security_name ILIKE %s OR v.client_name ILIKE %s)")
        base_params.extend([term, term, term])

    if start_date and isinstance(start_date, str) and start_date.strip():
        base_where.append("v.trade_date >= %s")
        base_params.append(start_date.strip())

    if end_date and isinstance(end_date, str) and end_date.strip():
        base_where.append("v.trade_date <= %s")
        base_params.append(end_date.strip())

    cte_clause = ""
    join_clause = ""
    params = []

    if net_buy_only:
        # CTE aggregating total BUY - total SELL per security across the filtered scope
        cte_clause = f"""
        WITH sec_net_buy AS (
            SELECT
                {sec_key_expr} AS sec_key,
                (SUM(CASE WHEN v.action = 'BUY' THEN v.total_value ELSE 0 END) -
                 SUM(CASE WHEN v.action = 'SELL' THEN v.total_value ELSE 0 END)) AS net_buy_value
            FROM stockedge_all_deals_view v
            LEFT JOIN security_mappings sm ON sm.normalized_security_name = regexp_replace(upper(regexp_replace(v.security_name, '\\m(LTD|LIMITED|INDIA|CORP|CORPORATION|INC|CO)\\M', '', 'gi')), '[^A-Z0-9]', '', 'g')
            WHERE {' AND '.join(base_where)}
            GROUP BY sec_key
            HAVING (SUM(CASE WHEN v.action = 'BUY' THEN v.total_value ELSE 0 END) -
                    SUM(CASE WHEN v.action = 'SELL' THEN v.total_value ELSE 0 END)) > 0
        )
        """
        join_clause = f"JOIN sec_net_buy nb ON nb.sec_key = {sec_key_expr}"
        params.extend(base_params)

    # Main deal query where conditions
    deal_where = list(base_where)
    deal_params = list(base_params)

    if action and isinstance(action, str) and action != "all":
        deal_where.append("v.action = %s")
        deal_params.append(action.upper())

    select_net_buy = "nb.net_buy_value," if net_buy_only else "NULL AS net_buy_value,"

    query = f"""
    {cte_clause}
    SELECT
        v.deal_category,
        v.id,
        COALESCE(
            NULLIF(v.symbol, ''),
            CASE WHEN sm.match_status IN ('MATCHED', 'MANUAL_OVERRIDE') THEN sm.resolved_nse_symbol END
        ) AS symbol,
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
        {select_net_buy}
        COALESCE(i.security_slug, s.security_slug, blk.security_slug, blk2.security_slug, '') as security_slug
    FROM stockedge_all_deals_view v
    LEFT JOIN security_mappings sm ON sm.normalized_security_name = regexp_replace(upper(regexp_replace(v.security_name, '\\m(LTD|LIMITED|INDIA|CORP|CORPORATION|INC|CO)\\M', '', 'gi')), '[^A-Z0-9]', '', 'g')
    LEFT JOIN stockedge_insider_deals i ON v.id = i.id AND v.deal_category = 'Insider Trading'
    LEFT JOIN stockedge_sast_deals s ON v.id = s.id AND v.deal_category = 'SAST Deals'
    LEFT JOIN stockedge_block_deals blk ON v.id = blk.id AND v.deal_category = 'Block Deals'
    LEFT JOIN stockedge_bulk_deals blk2 ON v.id = blk2.id AND v.deal_category = 'Bulk Deals'
    {join_clause}
    WHERE {' AND '.join(deal_where)}
    """
    params.extend(deal_params)

    # Count total records matching filter
    count_query = f"SELECT count(*) as count FROM ({query}) sub;"
    total_row = fetch_one(count_query, tuple(params))
    total_count = total_row["count"] if total_row else 0

    # Sorting
    order_dir = "ASC" if str(sort_order).lower() == "asc" else "DESC"
    if sort_by in ("value", "total_value"):
        order_clause = f"ORDER BY v.total_value {order_dir} NULLS LAST, v.trade_date DESC, v.id DESC"
    elif sort_by == "net_buy_value" and net_buy_only:
        order_clause = f"ORDER BY nb.net_buy_value {order_dir} NULLS LAST, v.trade_date DESC, v.id DESC"
    else:
        order_clause = f"ORDER BY v.trade_date {order_dir}, v.id {order_dir}"

    query += f" {order_clause} LIMIT %s OFFSET %s;"
    params.extend([page_size, offset])

    rows = fetch_all(query, tuple(params))

    # Format dates and numeric values
    for r in rows:
        if r.get("trade_date"):
            r["trade_date"] = str(r["trade_date"])
        if r.get("created_at"):
            r["created_at"] = str(r["created_at"])
        if r.get("net_buy_value") is not None:
            r["net_buy_value"] = float(r["net_buy_value"])

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
def get_deals_summary(
    category: Optional[str] = Query(None, description="Filter by deal category"),
    action: Optional[str] = Query(None, description="Filter by action (BUY, SELL)"),
    exchange: Optional[str] = Query(None, description="Filter by exchange (e.g. NSE)"),
    search: Optional[str] = Query(None, description="Search security name or client name"),
    start_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    net_buy_only: bool = Query(False, description="Filter securities with positive net buying only"),
):
    """Returns aggregate summary statistics matching active filters."""
    category = _unwrap(category, None)
    action = _unwrap(action, None)
    exchange = _unwrap(exchange, None)
    search = _unwrap(search, None)
    start_date = _unwrap(start_date, None)
    end_date = _unwrap(end_date, None)
    net_buy_only = bool(_unwrap(net_buy_only, False))

    sec_key_expr = """COALESCE(
        NULLIF(v.symbol, ''),
        CASE WHEN sm.match_status IN ('MATCHED', 'MANUAL_OVERRIDE') THEN sm.resolved_nse_symbol END,
        regexp_replace(upper(regexp_replace(v.security_name, '\\m(LTD|LIMITED|INDIA|CORP|CORPORATION|INC|CO)\\M', '', 'gi')), '[^A-Z0-9]', '', 'g')
    )"""

    base_where = ["1=1"]
    base_params = []

    if category and isinstance(category, str) and category != "all":
        base_where.append("v.deal_category = %s")
        base_params.append(category)

    if exchange and isinstance(exchange, str) and exchange != "all":
        base_where.append("UPPER(v.exchange_name) = %s")
        base_params.append(exchange.upper())

    if search and isinstance(search, str) and search.strip():
        term = f"%{search.strip()}%"
        base_where.append("(v.symbol ILIKE %s OR v.security_name ILIKE %s OR v.client_name ILIKE %s)")
        base_params.extend([term, term, term])

    if start_date and isinstance(start_date, str) and start_date.strip():
        base_where.append("v.trade_date >= %s")
        base_params.append(start_date.strip())

    if end_date and isinstance(end_date, str) and end_date.strip():
        base_where.append("v.trade_date <= %s")
        base_params.append(end_date.strip())

    cte_clause = ""
    join_clause = ""
    summary_params = []

    if net_buy_only:
        cte_clause = f"""
        WITH sec_net_buy AS (
            SELECT
                {sec_key_expr} AS sec_key,
                (SUM(CASE WHEN v.action = 'BUY' THEN v.total_value ELSE 0 END) -
                 SUM(CASE WHEN v.action = 'SELL' THEN v.total_value ELSE 0 END)) AS net_buy_value
            FROM stockedge_all_deals_view v
            LEFT JOIN security_mappings sm ON sm.normalized_security_name = regexp_replace(upper(regexp_replace(v.security_name, '\\m(LTD|LIMITED|INDIA|CORP|CORPORATION|INC|CO)\\M', '', 'gi')), '[^A-Z0-9]', '', 'g')
            WHERE {' AND '.join(base_where)}
            GROUP BY sec_key
            HAVING (SUM(CASE WHEN v.action = 'BUY' THEN v.total_value ELSE 0 END) -
                    SUM(CASE WHEN v.action = 'SELL' THEN v.total_value ELSE 0 END)) > 0
        )
        """
        join_clause = f"JOIN sec_net_buy nb ON nb.sec_key = {sec_key_expr}"
        summary_params.extend(base_params)

    deal_where = list(base_where)
    deal_params = list(base_params)

    if action and isinstance(action, str) and action != "all":
        deal_where.append("v.action = %s")
        deal_params.append(action.upper())

    summary_params.extend(deal_params)

    summary_query = f"""
    {cte_clause}
    SELECT
        v.deal_category,
        count(*) as count,
        SUM(CASE WHEN v.action = 'BUY' THEN 1 ELSE 0 END) as buy_count,
        SUM(CASE WHEN v.action = 'SELL' THEN 1 ELSE 0 END) as sell_count,
        COALESCE(SUM(v.total_value), 0) as total_turnover
    FROM stockedge_all_deals_view v
    LEFT JOIN security_mappings sm ON sm.normalized_security_name = regexp_replace(upper(regexp_replace(v.security_name, '\\m(LTD|LIMITED|INDIA|CORP|CORPORATION|INC|CO)\\M', '', 'gi')), '[^A-Z0-9]', '', 'g')
    {join_clause}
    WHERE {' AND '.join(deal_where)}
    GROUP BY v.deal_category;
    """
    category_stats = fetch_all(summary_query, tuple(summary_params))

    # Guarantee all 4 standard categories exist in results for consistent card display
    standard_cats = ["Insider Trading", "SAST Deals", "Block Deals", "Bulk Deals"]
    cat_map = {c["deal_category"]: c for c in category_stats}
    normalized_category_stats = []
    for cat_name in standard_cats:
        if cat_name in cat_map:
            stat = cat_map[cat_name]
            normalized_category_stats.append({
                "deal_category": cat_name,
                "count": int(stat["count"]),
                "buy_count": int(stat["buy_count"]),
                "sell_count": int(stat["sell_count"]),
                "total_turnover": float(stat["total_turnover"]),
            })
        else:
            normalized_category_stats.append({
                "deal_category": cat_name,
                "count": 0,
                "buy_count": 0,
                "sell_count": 0,
                "total_turnover": 0.0,
            })

    top_securities_query = f"""
    {cte_clause}
    SELECT
        v.security_name,
        count(*) as deal_count,
        SUM(CASE WHEN v.action = 'BUY' THEN 1 ELSE 0 END) as buy_count,
        SUM(CASE WHEN v.action = 'SELL' THEN 1 ELSE 0 END) as sell_count,
        COALESCE(SUM(v.total_value), 0) as total_turnover
    FROM stockedge_all_deals_view v
    LEFT JOIN security_mappings sm ON sm.normalized_security_name = regexp_replace(upper(regexp_replace(v.security_name, '\\m(LTD|LIMITED|INDIA|CORP|CORPORATION|INC|CO)\\M', '', 'gi')), '[^A-Z0-9]', '', 'g')
    {join_clause}
    WHERE {' AND '.join(deal_where)}
    GROUP BY v.security_name
    ORDER BY deal_count DESC
    LIMIT 10;
    """
    top_securities = fetch_all(top_securities_query, tuple(summary_params))

    return {
        "by_category": normalized_category_stats,
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
