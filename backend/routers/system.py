"""
API Router for System Status, Database Counts, and Pipeline Triggering.
"""

import logging
from typing import Dict, List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from backend.database import fetch_one, get_db_cursor
    from backend.engine.task_manager import task_manager
except ImportError:
    from ..database import fetch_one, get_db_cursor
    from ..engine.task_manager import task_manager

try:
    from backend.engine.conviction import persistence as conviction_persistence
except ImportError:
    from ..engine.conviction import persistence as conviction_persistence

from scripts.common import DEFAULT_EXCHANGES, is_exchange_enabled
from scripts.common.runner import resolve_script_key

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system", tags=["System"])


class RunScriptRequest(BaseModel):
    script_key: str = Field(..., description="Script key: nse_eod, insider_data_extractor, all")
    args: Optional[List[str]] = Field(default=[], description="CLI arguments to pass to the script")
    exchanges: Optional[List[str]] = Field(
        default=None,
        description=(
            "Exchange(s) to run the Insider & Deal Data Pipeline against. Every entry must be one "
            "of the centrally configured ENABLED_EXCHANGES; defaults to DEFAULT_EXCHANGES when "
            "omitted entirely. An explicitly empty list is rejected (at least one exchange is "
            "required). Ignored for scripts other than insider_data_extractor."
        ),
    )


class ClearInsiderDataRequest(BaseModel):
    confirmation: str = Field(..., description='Must be exactly "CLEAR" to confirm this destructive operation.')


@router.get("/status")
def get_system_status():
    """Returns database connection health, table row counts, and date bounds."""
    try:
        eod_stats = fetch_one("""
            SELECT
                count(*) as row_count,
                count(distinct symbol) as symbol_count,
                min(trade_date)::text as min_date,
                max(trade_date)::text as max_date
            FROM nse_equity_eod;
        """)

        insider_count = fetch_one("SELECT count(*) as count FROM stockedge_insider_deals;")
        sast_count = fetch_one("SELECT count(*) as count FROM stockedge_sast_deals;")
        block_count = fetch_one("SELECT count(*) as count FROM stockedge_block_deals;")
        bulk_count = fetch_one("SELECT count(*) as count FROM stockedge_bulk_deals;")

        return {
            "status": "healthy",
            "database": {
                "eod_rows": eod_stats["row_count"] if eod_stats else 0,
                "symbols_count": eod_stats["symbol_count"] if eod_stats else 0,
                "min_eod_date": eod_stats["min_date"] if eod_stats else None,
                "max_eod_date": eod_stats["max_date"] if eod_stats else None,
                "insider_deals": insider_count["count"] if insider_count else 0,
                "sast_deals": sast_count["count"] if sast_count else 0,
                "block_deals": block_count["count"] if block_count else 0,
                "bulk_deals": bulk_count["count"] if bulk_count else 0,
            }
        }
    except Exception as e:
        return {"status": "degraded", "error": str(e)}


@router.get("/scripts")
def get_available_scripts():
    """Returns list of registered pipelines that can be executed from the UI."""
    return {"scripts": task_manager.list_available_scripts()}


def _normalize_exchange_list(raw: List[str]) -> List[str]:
    """Uppercases, strips, and de-duplicates while preserving order (e.g. ["NSE", "nse"] -> ["NSE"])."""
    seen: List[str] = []
    for e in raw:
        e = (e or "").strip().upper()
        if e and e not in seen:
            seen.append(e)
    return seen


@router.post("/run-script")
def run_script(req: RunScriptRequest):
    """
    Launches a data pipeline script in the background and returns a task_id for tracking.

    For the Insider & Deal Data Pipeline (script_key resolving to
    insider_data_extractor), every selected exchange is validated against the
    centrally configured ENABLED_EXCHANGES (never silently dropping a
    disabled one and processing the rest) and passed through the SAME
    existing script-execution mechanism as plain --exchange CLI arguments -
    no second execution path is introduced.
    """
    args = list(req.args or [])
    canonical_key = resolve_script_key(req.script_key)
    exchanges = None

    if canonical_key == "insider_data_extractor":
        exchanges = _normalize_exchange_list(req.exchanges if req.exchanges is not None else DEFAULT_EXCHANGES)
        if not exchanges:
            raise HTTPException(status_code=400, detail="Please select at least one exchange.")

        disabled = [e for e in exchanges if not is_exchange_enabled(e)]
        if disabled:
            noun = "Exchange" if len(disabled) == 1 else "Exchanges"
            verb = "is" if len(disabled) == 1 else "are"
            raise HTTPException(status_code=400, detail=f"{noun} {', '.join(disabled)} {verb} not currently enabled.")

        args = args + ["--exchange", *exchanges]

    try:
        task = task_manager.start_script(req.script_key, args, exchanges=exchanges)
        return {"status": "success", "task": task}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to launch script: {str(e)}")


@router.get("/tasks")
def list_tasks():
    """Returns list of recent execution tasks."""
    return {"tasks": task_manager.list_recent_tasks()}


@router.get("/tasks/{task_id}")
def get_task_status(task_id: str):
    """Returns live logs and status of an execution task."""
    task = task_manager.get_task_status(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"task": task}


@router.post("/tasks/{task_id}/stop")
def stop_task(task_id: str):
    """Terminates an ongoing background script execution."""
    success = task_manager.stop_task(task_id)
    if not success:
        raise HTTPException(status_code=400, detail="Task could not be stopped or is already completed.")
    return {"status": "success", "message": f"Task {task_id} stopped."}


@router.post("/insider-data/clear")
def clear_insider_data(req: ClearInsiderDataRequest):
    """
    Permanently deletes ALL Insider & Deal Data Pipeline records and nothing
    else - the single destructive endpoint for this action (no duplicate
    variant exists). Requires the exact confirmation string "CLEAR"; the
    frontend sends this fixed operation request, never SQL or table names.

    Deletes (raw pipeline data + its directly-derived Conviction snapshots,
    all in one transaction so a failure never leaves the database partially
    cleared):
      - stockedge_insider_deals, stockedge_sast_deals, stockedge_block_deals,
        stockedge_bulk_deals (stockedge_all_deals_view is a VIEW over these
        four tables, so it empties automatically - nothing to delete there)
      - insider_conviction_scores (Insider Conviction Engine snapshots -
        derived entirely from the tables above, so cleared alongside them
        rather than left showing stale scores for data that no longer exists)

    Explicitly NEVER touched: nse_equity_eod (NSE EOD market data),
    security_mappings / security_mapping_history (SymbolMatcher manual and
    automated mappings - governance/config data, not raw deal data), or any
    other application table. No FK relationship exists between the tables
    deleted here and anything preserved, so no CASCADE or special ordering
    is needed.
    """
    if req.confirmation != "CLEAR":
        raise HTTPException(status_code=400, detail='Confirmation text must be exactly "CLEAR".')

    # Ensure the derived-data table exists before trying to clear it, so a
    # fresh/never-scored database can't turn a missing-table error into a
    # rollback of the raw-data deletes below.
    try:
        conviction_persistence.ensure_schema()
    except Exception as e:
        logger.error(f"Could not verify insider_conviction_scores schema before clear: {e}", exc_info=True)

    tables = [
        ("insider_transactions", "stockedge_insider_deals"),
        ("sast_deals", "stockedge_sast_deals"),
        ("bulk_deals", "stockedge_bulk_deals"),
        ("block_deals", "stockedge_block_deals"),
    ]
    deleted: Dict[str, int] = {}

    try:
        with get_db_cursor(commit=True) as cur:
            for label, table in tables:
                cur.execute(f"DELETE FROM {table};")
                deleted[label] = cur.rowcount
            cur.execute("DELETE FROM insider_conviction_scores;")
            deleted["insider_conviction_scores"] = cur.rowcount
    except Exception as e:
        logger.error(f"Failed to clear insider & deal data: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Unable to clear insider & deal data.")

    logger.warning(f"[AUDIT] Insider & Deal data clear executed. Deleted counts: {deleted}")

    return {
        "status": "success",
        "message": "Insider and deal data cleared successfully.",
        "deleted": deleted,
    }
