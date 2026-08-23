"""
API Router for System Status, Database Counts, and Pipeline Triggering.
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from backend.database import fetch_one
    from backend.engine.task_manager import task_manager
except ImportError:
    from ..database import fetch_one
    from ..engine.task_manager import task_manager

router = APIRouter(prefix="/api/system", tags=["System"])


class RunScriptRequest(BaseModel):
    script_key: str = Field(..., description="Script key: nse_eod, insider_data_extractor, all")
    args: Optional[List[str]] = Field(default=[], description="CLI arguments to pass to the script")


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


@router.post("/run-script")
def run_script(req: RunScriptRequest):
    """Launches a data pipeline script in the background and returns a task_id for tracking."""
    try:
        task = task_manager.start_script(req.script_key, req.args)
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
