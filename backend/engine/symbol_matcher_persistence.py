"""
Persistence layer for Symbol Matcher governance.

Two additive-only tables:
  - security_mappings: one row per distinct company (keyed by
    normalized_security_name), the authoritative resolution result reused
    on every subsequent lookup instead of re-running matching.
  - security_mapping_history: an append-only audit trail of every change
    to a mapping (created independently of security_mappings via
    ON DELETE SET NULL, so history survives even if a mapping row is
    later removed).

No existing table (deals, prices) is modified or duplicated.
"""

import json
import logging
from typing import Optional, Dict, Any, List

try:
    from backend.database import fetch_all, fetch_one, get_db_cursor
except ImportError:
    from ..database import fetch_all, fetch_one, get_db_cursor

logger = logging.getLogger(__name__)

SCHEMA_DDL = """
CREATE TABLE IF NOT EXISTS security_mappings (
    id SERIAL PRIMARY KEY,
    original_security_name VARCHAR(255) NOT NULL,
    normalized_security_name VARCHAR(255) NOT NULL,
    resolved_nse_symbol VARCHAR(50),
    match_method VARCHAR(30) NOT NULL,
    match_confidence NUMERIC(5, 4) NOT NULL,
    match_status VARCHAR(20) NOT NULL,
    is_manual_override BOOLEAN NOT NULL DEFAULT FALSE,
    candidates JSONB NOT NULL DEFAULT '[]',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(100)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_security_mappings_normalized ON security_mappings (normalized_security_name);
CREATE INDEX IF NOT EXISTS idx_security_mappings_symbol ON security_mappings (resolved_nse_symbol);
CREATE INDEX IF NOT EXISTS idx_security_mappings_status ON security_mappings (match_status);

CREATE TABLE IF NOT EXISTS security_mapping_history (
    id SERIAL PRIMARY KEY,
    mapping_id INTEGER REFERENCES security_mappings(id) ON DELETE SET NULL,
    normalized_security_name VARCHAR(255) NOT NULL,
    previous_symbol VARCHAR(50),
    new_symbol VARCHAR(50),
    previous_status VARCHAR(20),
    new_status VARCHAR(20),
    match_method VARCHAR(30),
    match_confidence NUMERIC(5, 4),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    changed_by VARCHAR(100),
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_security_mapping_history_mapping ON security_mapping_history (mapping_id);
"""


def ensure_schema():
    with get_db_cursor(commit=True) as cur:
        cur.execute(SCHEMA_DDL)


def _row_to_result(row: Dict[str, Any]) -> Dict[str, Any]:
    try:
        from backend.engine.symbol_matcher import RESOLVED_EXCHANGE
    except ImportError:
        from .symbol_matcher import RESOLVED_EXCHANGE
    return {
        "mapping_id": row["id"],
        "original_security_name": row["original_security_name"],
        "normalized_security_name": row["normalized_security_name"],
        "resolved_nse_symbol": row["resolved_nse_symbol"],
        "resolved_exchange": RESOLVED_EXCHANGE if row["resolved_nse_symbol"] else None,
        "match_method": row["match_method"],
        "match_confidence": float(row["match_confidence"]),
        "match_status": row["match_status"],
        "is_manual_override": row["is_manual_override"],
        "candidates": row["candidates"] if isinstance(row["candidates"], list) else json.loads(row["candidates"] or "[]"),
        "notes": row.get("notes"),
        "created_at": str(row["created_at"]) if row.get("created_at") else None,
        "updated_at": str(row["updated_at"]) if row.get("updated_at") else None,
        "updated_by": row.get("updated_by"),
    }


def get_mapping(normalized_security_name: str) -> Optional[Dict[str, Any]]:
    row = fetch_one("SELECT * FROM security_mappings WHERE normalized_security_name = %s;", (normalized_security_name,))
    return _row_to_result(row) if row else None


def get_mapping_by_id(mapping_id: int) -> Optional[Dict[str, Any]]:
    row = fetch_one("SELECT * FROM security_mappings WHERE id = %s;", (mapping_id,))
    return _row_to_result(row) if row else None


def save_automated_mapping(original_name: str, normalized_name: str, result: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Upserts an AUTOMATED resolution. The WHERE clause on the ON CONFLICT
    update guarantees a manual override is never clobbered by this path -
    if one exists, this UPDATE simply does not fire (RETURNING yields no
    row), and the existing manual override is fetched and returned instead.
    """
    with get_db_cursor(commit=True) as cur:
        cur.execute(
            """
            INSERT INTO security_mappings
                (original_security_name, normalized_security_name, resolved_nse_symbol,
                 match_method, match_confidence, match_status, candidates, is_manual_override)
            VALUES (%s, %s, %s, %s, %s, %s, %s, FALSE)
            ON CONFLICT (normalized_security_name) DO UPDATE SET
                resolved_nse_symbol = EXCLUDED.resolved_nse_symbol,
                match_method = EXCLUDED.match_method,
                match_confidence = EXCLUDED.match_confidence,
                match_status = EXCLUDED.match_status,
                candidates = EXCLUDED.candidates,
                updated_at = CURRENT_TIMESTAMP
            WHERE security_mappings.is_manual_override = FALSE
            RETURNING *;
            """,
            (
                original_name, normalized_name, result["resolved_nse_symbol"],
                result["match_method"], result["match_confidence"], result["match_status"],
                json.dumps(result["candidates"]),
            ),
        )
        row = cur.fetchone()

    if row:
        return _row_to_result(dict(row))
    # A manual override exists for this normalized name - the update above
    # was blocked by the WHERE clause. Return the (unmodified) override.
    return get_mapping(normalized_name)


def save_manual_override(
    original_name: str,
    normalized_name: str,
    resolved_symbol: str,
    updated_by: Optional[str] = None,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Always wins, regardless of any prior automated or manual state. Records
    the transition in security_mapping_history before applying it.
    """
    previous = get_mapping(normalized_name)

    with get_db_cursor(commit=True) as cur:
        cur.execute(
            """
            INSERT INTO security_mappings
                (original_security_name, normalized_security_name, resolved_nse_symbol,
                 match_method, match_confidence, match_status, candidates, is_manual_override, notes, updated_by)
            VALUES (%s, %s, %s, 'MANUAL_OVERRIDE', 1.0, 'MANUAL_OVERRIDE', '[]', TRUE, %s, %s)
            ON CONFLICT (normalized_security_name) DO UPDATE SET
                resolved_nse_symbol = EXCLUDED.resolved_nse_symbol,
                match_method = 'MANUAL_OVERRIDE',
                match_confidence = 1.0,
                match_status = 'MANUAL_OVERRIDE',
                is_manual_override = TRUE,
                notes = EXCLUDED.notes,
                updated_by = EXCLUDED.updated_by,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
            """,
            (original_name, normalized_name, resolved_symbol, notes, updated_by),
        )
        row = dict(cur.fetchone())

        cur.execute(
            """
            INSERT INTO security_mapping_history
                (mapping_id, normalized_security_name, previous_symbol, new_symbol,
                 previous_status, new_status, match_method, match_confidence, changed_by, reason)
            VALUES (%s, %s, %s, %s, %s, %s, 'MANUAL_OVERRIDE', 1.0, %s, %s);
            """,
            (
                row["id"], normalized_name,
                previous["resolved_nse_symbol"] if previous else None,
                resolved_symbol,
                previous["match_status"] if previous else None,
                "MANUAL_OVERRIDE",
                updated_by, notes,
            ),
        )

    return _row_to_result(row)


def remove_manual_override(mapping_id: int, changed_by: Optional[str] = None, reason: Optional[str] = None) -> bool:
    """
    Deletes the mapping entirely so the next resolution re-runs automated
    matching fresh - history survives (mapping_id set NULL, but
    normalized_security_name is denormalized onto the history row).
    """
    previous = get_mapping_by_id(mapping_id)
    if not previous:
        return False

    with get_db_cursor(commit=True) as cur:
        cur.execute(
            """
            INSERT INTO security_mapping_history
                (mapping_id, normalized_security_name, previous_symbol, new_symbol,
                 previous_status, new_status, match_method, match_confidence, changed_by, reason)
            VALUES (%s, %s, %s, NULL, %s, 'REMOVED', NULL, NULL, %s, %s);
            """,
            (mapping_id, previous["normalized_security_name"], previous["resolved_nse_symbol"], previous["match_status"], changed_by, reason),
        )
        cur.execute("DELETE FROM security_mappings WHERE id = %s;", (mapping_id,))
    return True


def get_history(mapping_id: Optional[int] = None, normalized_security_name: Optional[str] = None) -> List[Dict[str, Any]]:
    if mapping_id is not None:
        rows = fetch_all("SELECT * FROM security_mapping_history WHERE mapping_id = %s ORDER BY changed_at DESC;", (mapping_id,))
    elif normalized_security_name:
        rows = fetch_all("SELECT * FROM security_mapping_history WHERE normalized_security_name = %s ORDER BY changed_at DESC;", (normalized_security_name,))
    else:
        return []
    for r in rows:
        r["changed_at"] = str(r["changed_at"]) if r.get("changed_at") else None
        if r.get("match_confidence") is not None:
            r["match_confidence"] = float(r["match_confidence"])
    return rows


def list_by_status(status: str, search: Optional[str] = None, limit: int = 200) -> List[Dict[str, Any]]:
    query = "SELECT * FROM security_mappings WHERE match_status = %s"
    params: List[Any] = [status]
    if search:
        query += " AND (original_security_name ILIKE %s OR resolved_nse_symbol ILIKE %s)"
        params.extend([f"%{search}%", f"%{search}%"])
    query += " ORDER BY updated_at DESC LIMIT %s;"
    params.append(limit)
    rows = fetch_all(query, tuple(params))
    return [_row_to_result(r) for r in rows]


def list_all(search: Optional[str] = None, status: Optional[str] = None, limit: int = 500) -> List[Dict[str, Any]]:
    query = "SELECT * FROM security_mappings WHERE 1=1"
    params: List[Any] = []
    if status:
        query += " AND match_status = %s"
        params.append(status)
    if search:
        query += " AND (original_security_name ILIKE %s OR resolved_nse_symbol ILIKE %s)"
        params.extend([f"%{search}%", f"%{search}%"])
    query += " ORDER BY updated_at DESC LIMIT %s;"
    params.append(limit)
    rows = fetch_all(query, tuple(params))
    return [_row_to_result(r) for r in rows]


def count_by_status() -> Dict[str, int]:
    """Aggregate mapping counts per status - the real, DB-sourced numbers for the re-match summary report."""
    rows = fetch_all("SELECT match_status, count(*) as count FROM security_mappings GROUP BY match_status;")
    return {r["match_status"]: r["count"] for r in rows}


def clear_automatic_mappings() -> int:
    """
    Deletes every AUTOMATIC mapping (is_manual_override = FALSE), leaving
    manual overrides completely untouched. Automatic mappings are a pure,
    fully regenerable derived cache - the next resolve_symbol_detailed()
    call for each affected security recomputes and re-persists it fresh
    (against whatever candidate universe/filtering is active at that time).
    Returns the number of rows deleted.
    """
    with get_db_cursor(commit=True) as cur:
        cur.execute("DELETE FROM security_mappings WHERE is_manual_override = FALSE;")
        return cur.rowcount


def find_invalid_resolved_symbols(valid_symbols: List[str]) -> List[Dict[str, Any]]:
    """
    Returns every persisted mapping (manual or automatic) whose
    resolved_nse_symbol is NOT in the given current NSE reference universe
    - i.e. a symbol that would resolve to a foreign/stale/delisted symbol
    despite being labeled NSE. Being labeled "NSE" is not sufficient on its
    own (see backend/engine/symbol_matcher.py:is_symbol_currently_valid) -
    this is the actual database-backed hard-validation check.
    """
    rows = fetch_all(
        """
        SELECT * FROM security_mappings
        WHERE resolved_nse_symbol IS NOT NULL
          AND NOT (resolved_nse_symbol = ANY(%s));
        """,
        (list(valid_symbols),),
    )
    return [_row_to_result(r) for r in rows]
