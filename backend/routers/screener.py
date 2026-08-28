"""
API Router for the Smart Stock Screener.
"""

import logging
from fastapi import APIRouter, HTTPException

try:
    from backend.engine.screener.filters import ScreenerRequest, DEAL_CATEGORIES
    from backend.engine.screener.screener import run_screener
    from backend.engine.screener import configuration as screener_cfg
except ImportError:
    from ..engine.screener.filters import ScreenerRequest, DEAL_CATEGORIES
    from ..engine.screener.screener import run_screener
    from ..engine.screener import configuration as screener_cfg

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/screener", tags=["Smart Screener"])


@router.post("/search")
def search(req: ScreenerRequest):
    """Runs the Smart Screener against the current insider/price/technical/delivery/conviction filters."""
    if req.sort.field not in screener_cfg.SORT_FIELDS:
        raise HTTPException(status_code=400, detail=f"Unknown sort field '{req.sort.field}'. Valid fields: {', '.join(screener_cfg.SORT_FIELDS)}")
    if req.sort.direction not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="sort.direction must be 'asc' or 'desc'")

    try:
        return run_screener(req)
    except Exception as e:
        logger.error(f"Screener search failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Screener search failed: {str(e)}")


@router.get("/options")
def get_options():
    """Returns static filter metadata (lookback options, sortable fields, deal categories) for the frontend."""
    return {
        "lookback_options_days": screener_cfg.LOOKBACK_OPTIONS_DAYS,
        "default_insider_lookback_days": screener_cfg.DEFAULT_INSIDER_LOOKBACK_DAYS,
        "sort_fields": screener_cfg.SORT_FIELDS,
        "deal_categories": DEAL_CATEGORIES,
        "default_page_size": screener_cfg.DEFAULT_PAGE_SIZE,
        "max_page_size": screener_cfg.MAX_PAGE_SIZE,
    }
