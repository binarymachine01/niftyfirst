"""
Persistence layer for Date-Range Backtesting runs and audit results.
Stores execution parameters, aggregate performance summaries, deal-level records,
and excluded record audits in PostgreSQL.
"""

import json
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

try:
    from backend.database import fetch_all, fetch_one, get_db_cursor
except ImportError:
    from ..database import fetch_all, fetch_one, get_db_cursor

logger = logging.getLogger(__name__)

SCHEMA_DDL = """
CREATE TABLE IF NOT EXISTS backtest_runs (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(50) UNIQUE NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    deal_types TEXT[] NOT NULL,
    actions TEXT[] NOT NULL,
    exchange VARCHAR(20) DEFAULT 'NSE',
    min_value_lakhs NUMERIC(14, 2) DEFAULT 0.0,
    total_signals INTEGER DEFAULT 0,
    eligible_signals INTEGER DEFAULT 0,
    excluded_signals INTEGER DEFAULT 0,
    summary JSONB DEFAULT '{}',
    deal_type_performance JSONB DEFAULT '{}',
    action_performance JSONB DEFAULT '{}',
    deals JSONB DEFAULT '[]',
    excluded_records JSONB DEFAULT '[]',
    execution_time_ms INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'COMPLETED',
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_run_id ON backtest_runs (run_id);
CREATE INDEX IF NOT EXISTS idx_backtest_runs_created_at ON backtest_runs (created_at DESC);
"""


def ensure_schema():
    """Ensures the backtest_runs table and indexes exist."""
    try:
        with get_db_cursor(commit=True) as cur:
            cur.execute(SCHEMA_DDL)
    except Exception as e:
        logger.warning(f"Could not initialize backtest_runs schema: {e}")


def _serialize_json(val: Any) -> str:
    def _default_encoder(obj):
        if hasattr(obj, "isoformat"):
            return obj.isoformat()
        if hasattr(obj, "__str__"):
            return str(obj)
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")
    return json.dumps(val, default=_default_encoder)


def save_run(run_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Saves or updates a backtest run in the database.
    """
    ensure_schema()
    with get_db_cursor(commit=True) as cur:
        cur.execute(
            """
            INSERT INTO backtest_runs (
                run_id, from_date, to_date, deal_types, actions, exchange,
                min_value_lakhs, total_signals, eligible_signals, excluded_signals,
                summary, deal_type_performance, action_performance,
                deals, excluded_records, execution_time_ms, status, error_message, updated_at
            ) VALUES (
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, %s, %s, CURRENT_TIMESTAMP
            )
            ON CONFLICT (run_id) DO UPDATE SET
                total_signals = EXCLUDED.total_signals,
                eligible_signals = EXCLUDED.eligible_signals,
                excluded_signals = EXCLUDED.excluded_signals,
                summary = EXCLUDED.summary,
                deal_type_performance = EXCLUDED.deal_type_performance,
                action_performance = EXCLUDED.action_performance,
                deals = EXCLUDED.deals,
                excluded_records = EXCLUDED.excluded_records,
                execution_time_ms = EXCLUDED.execution_time_ms,
                status = EXCLUDED.status,
                error_message = EXCLUDED.error_message,
                updated_at = CURRENT_TIMESTAMP
            RETURNING id, run_id, from_date, to_date, deal_types, actions, exchange,
                      total_signals, eligible_signals, excluded_signals, status, created_at;
            """,
            (
                run_data["run_id"],
                run_data["from_date"],
                run_data["to_date"],
                run_data.get("deal_types", []),
                run_data.get("actions", []),
                run_data.get("exchange", "NSE"),
                run_data.get("min_value_lakhs", 0.0),
                run_data.get("total_signals", 0),
                run_data.get("eligible_signals", 0),
                run_data.get("excluded_signals", 0),
                _serialize_json(run_data.get("summary", {})),
                _serialize_json(run_data.get("deal_type_performance", {})),
                _serialize_json(run_data.get("action_performance", {})),
                _serialize_json(run_data.get("deals", [])),
                _serialize_json(run_data.get("excluded_records", [])),
                run_data.get("execution_time_ms", 0),
                run_data.get("status", "COMPLETED"),
                run_data.get("error_message"),
            ),
        )
        row = cur.fetchone()
        return dict(row) if row else {}


def get_run(run_id: str, include_deals: bool = True) -> Optional[Dict[str, Any]]:
    """
    Retrieves a backtest run by its run_id.
    """
    ensure_schema()
    cols = "id, run_id, from_date, to_date, deal_types, actions, exchange, min_value_lakhs, total_signals, eligible_signals, excluded_signals, summary, deal_type_performance, action_performance, execution_time_ms, status, error_message, created_at"
    if include_deals:
        cols += ", deals, excluded_records"
    
    query = f"SELECT {cols} FROM backtest_runs WHERE run_id = %s;"
    row = fetch_one(query, (run_id,))
    if not row:
        return None

    res = dict(row)
    res["from_date"] = str(res["from_date"]) if res.get("from_date") else None
    res["to_date"] = str(res["to_date"]) if res.get("to_date") else None
    res["created_at"] = str(res["created_at"]) if res.get("created_at") else None
    if isinstance(res.get("summary"), str):
        res["summary"] = json.loads(res["summary"])
    if isinstance(res.get("deal_type_performance"), str):
        res["deal_type_performance"] = json.loads(res["deal_type_performance"])
    if isinstance(res.get("action_performance"), str):
        res["action_performance"] = json.loads(res["action_performance"])
    if include_deals:
        if isinstance(res.get("deals"), str):
            res["deals"] = json.loads(res["deals"])
        if isinstance(res.get("excluded_records"), str):
            res["excluded_records"] = json.loads(res["excluded_records"])
    return res


def list_runs(limit: int = 20) -> List[Dict[str, Any]]:
    """
    Lists recent backtest runs without the heavy deals payload.
    """
    ensure_schema()
    query = """
    SELECT id, run_id, from_date, to_date, deal_types, actions, exchange,
           total_signals, eligible_signals, excluded_signals, summary,
           execution_time_ms, status, created_at
    FROM backtest_runs
    ORDER BY created_at DESC
    LIMIT %s;
    """
    rows = fetch_all(query, (limit,))
    results = []
    for r in rows:
        item = dict(r)
        item["from_date"] = str(item["from_date"]) if item.get("from_date") else None
        item["to_date"] = str(item["to_date"]) if item.get("to_date") else None
        item["created_at"] = str(item["created_at"]) if item.get("created_at") else None
        if isinstance(item.get("summary"), str):
            item["summary"] = json.loads(item["summary"])
        results.append(item)
    return results
