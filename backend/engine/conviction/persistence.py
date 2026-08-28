"""
Persistence layer for the Insider Conviction Engine.

Stores an append-only snapshot of each computed score in a new,
additive-only table (insider_conviction_scores). No existing production
table is modified. Kept separate from scorer.py so the scoring functions
stay pure (no DB writes), which also makes them straightforward to unit
test without a database.
"""

import json
import logging
from typing import List, Dict, Any

try:
    from backend.database import fetch_all, get_db_cursor
except ImportError:
    from ...database import fetch_all, get_db_cursor

logger = logging.getLogger(__name__)

SCHEMA_DDL = """
CREATE TABLE IF NOT EXISTS insider_conviction_scores (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    overall_score NUMERIC(5, 2),
    confidence VARCHAR(10) NOT NULL,
    components_available INTEGER NOT NULL,
    components_total INTEGER NOT NULL,
    component_scores JSONB NOT NULL,
    model_version VARCHAR(50) NOT NULL DEFAULT 'INSIDER_CONVICTION_V1',
    as_of_date DATE NOT NULL,
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_insider_conviction_symbol ON insider_conviction_scores (symbol, calculated_at DESC);
"""


def ensure_schema():
    """Creates the insider_conviction_scores table if it does not already exist."""
    with get_db_cursor(commit=True) as cur:
        cur.execute(SCHEMA_DDL)


def save_snapshot(result: Dict[str, Any]) -> None:
    """Persists an append-only snapshot of a computed conviction result."""
    component_scores = {
        key: {"score": c["score"], "available": c["available"], "weighted_contribution": c["weighted_contribution"]}
        for key, c in result["components"].items()
    }
    try:
        with get_db_cursor(commit=True) as cur:
            cur.execute(
                """
                INSERT INTO insider_conviction_scores
                    (symbol, overall_score, confidence, components_available, components_total,
                     component_scores, model_version, as_of_date)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
                """,
                (
                    result["symbol"],
                    result["overall_score"],
                    result["confidence"]["tier"],
                    result["components_available"],
                    result["components_total"],
                    json.dumps(component_scores),
                    result["model_version"],
                    result["as_of_date"],
                ),
            )
    except Exception as e:
        # Snapshot persistence is best-effort audit history - never let a
        # storage failure break the live score response.
        logger.warning(f"Failed to persist conviction snapshot for {result['symbol']}: {e}")


def get_history(symbol: str, limit: int = 30) -> List[Dict[str, Any]]:
    """Returns past stored conviction snapshots for a symbol, most recent first."""
    rows = fetch_all(
        """
        SELECT symbol, overall_score, confidence, components_available, components_total,
               component_scores, model_version, as_of_date, calculated_at
        FROM insider_conviction_scores
        WHERE symbol = %s
        ORDER BY calculated_at DESC
        LIMIT %s;
        """,
        (symbol.upper(), limit),
    )
    for r in rows:
        r["as_of_date"] = str(r["as_of_date"])
        r["calculated_at"] = str(r["calculated_at"])
        r["overall_score"] = float(r["overall_score"]) if r["overall_score"] is not None else None
    return rows
