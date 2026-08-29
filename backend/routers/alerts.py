"""
API Router for Saved Deal Filters & Match Alerts.
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from backend.database import fetch_all, get_db_cursor
except ImportError:
    from ..database import fetch_all, get_db_cursor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])

SCHEMA_DDL = """
CREATE TABLE IF NOT EXISTS saved_deal_filters (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50),
    action VARCHAR(10),
    min_value_lakhs NUMERIC(18, 2) DEFAULT 0,
    keyword VARCHAR(255),
    last_checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
"""


def ensure_schema():
    """Creates the saved_deal_filters table if it does not already exist."""
    with get_db_cursor(commit=True) as cur:
        cur.execute(SCHEMA_DDL)


class SavedFilterRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: Optional[str] = Field(default=None, description="Deal category, or null for all")
    action: Optional[str] = Field(default=None, description="BUY, SELL, or null for all")
    min_value_lakhs: float = Field(default=0.0, ge=0.0)
    keyword: Optional[str] = Field(default=None, description="Matched against security/client name")


@router.get("/filters")
def list_filters():
    """Returns all saved deal filters."""
    rows = fetch_all("SELECT * FROM saved_deal_filters ORDER BY created_at DESC;")
    for r in rows:
        r["last_checked_at"] = str(r["last_checked_at"])
        r["created_at"] = str(r["created_at"])
    return {"filters": rows}


@router.post("/filters")
def create_filter(req: SavedFilterRequest):
    """Creates a new saved deal filter."""
    with get_db_cursor(commit=True) as cur:
        cur.execute(
            """
            INSERT INTO saved_deal_filters (name, category, action, min_value_lakhs, keyword)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING *;
            """,
            (req.name, req.category, req.action.upper() if req.action else None, req.min_value_lakhs, req.keyword),
        )
        row = dict(cur.fetchone())
    row["last_checked_at"] = str(row["last_checked_at"])
    row["created_at"] = str(row["created_at"])
    return {"status": "success", "filter": row}


@router.delete("/filters/{filter_id}")
def delete_filter(filter_id: int):
    """Deletes a saved deal filter."""
    with get_db_cursor(commit=True) as cur:
        cur.execute("DELETE FROM saved_deal_filters WHERE id = %s RETURNING id;", (filter_id,))
        deleted = cur.fetchone()
    if not deleted:
        raise HTTPException(status_code=404, detail="Filter not found")
    return {"status": "success", "message": f"Filter {filter_id} deleted."}


@router.post("/filters/{filter_id}/acknowledge")
def acknowledge_filter(filter_id: int):
    """Marks all current matches for a filter as seen by resetting last_checked_at."""
    with get_db_cursor(commit=True) as cur:
        cur.execute(
            "UPDATE saved_deal_filters SET last_checked_at = CURRENT_TIMESTAMP WHERE id = %s RETURNING id;",
            (filter_id,),
        )
        updated = cur.fetchone()
    if not updated:
        raise HTTPException(status_code=404, detail="Filter not found")
    return {"status": "success"}


def _build_match_query(f: dict):
    query = """
    SELECT deal_category, id, trade_date, exchange_name, security_name, client_name,
           action, quantity, price, total_value, mode_description, created_at
    FROM stockedge_all_deals_view
    WHERE 1=1
    """
    params = []

    if f.get("category"):
        query += " AND deal_category = %s"
        params.append(f["category"])

    if f.get("action"):
        query += " AND action = %s"
        params.append(f["action"])

    min_value_lakhs = float(f.get("min_value_lakhs") or 0)
    if min_value_lakhs > 0:
        query += " AND (total_value >= %s OR total_value IS NULL)"
        params.append(min_value_lakhs * 100000)

    if f.get("keyword"):
        query += " AND (security_name ILIKE %s OR client_name ILIKE %s)"
        params.extend([f"%{f['keyword']}%", f"%{f['keyword']}%"])

    query += " ORDER BY created_at DESC LIMIT 50;"
    return query, params


@router.get("/matches")
def get_matches():
    """Evaluates every saved filter against the deals repository and returns matches."""
    filters = fetch_all("SELECT * FROM saved_deal_filters ORDER BY created_at DESC;")
    results = []

    for f in filters:
        query, params = _build_match_query(f)
        rows = fetch_all(query, tuple(params))

        last_checked_at = f["last_checked_at"]
        new_count = 0
        for r in rows:
            is_new = r["created_at"] > last_checked_at
            r["is_new"] = is_new
            if is_new:
                new_count += 1
            r["trade_date"] = str(r["trade_date"])
            r["created_at"] = str(r["created_at"])

        f["last_checked_at"] = str(f["last_checked_at"])
        f["created_at"] = str(f["created_at"])

        results.append({
            "filter": f,
            "total_matching": len(rows),
            "new_since_last_check": new_count,
            "matches": rows,
        })

    return {
        "total_new_alerts": sum(r["new_since_last_check"] for r in results),
        "results": results,
    }
