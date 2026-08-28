"""
API Router for the Insider Conviction Engine.
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

try:
    from backend.database import fetch_one
    from backend.engine.conviction import scorer, explanations, persistence, configuration as conviction_cfg
except ImportError:
    from ..database import fetch_one
    from ..engine.conviction import scorer, explanations, persistence, configuration as conviction_cfg

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/conviction", tags=["Insider Conviction"])


def _validate_symbol(symbol: str) -> str:
    symbol = symbol.upper().strip()
    row = fetch_one("SELECT 1 FROM nse_equity_eod WHERE symbol = %s LIMIT 1;", (symbol,))
    if not row:
        raise HTTPException(status_code=404, detail=f"Unknown NSE symbol '{symbol}'")
    return symbol


@router.get("")
def get_ranking(
    limit: int = Query(50, ge=1, le=200),
    min_confidence: Optional[str] = Query(None, description="Filter to HIGH, MEDIUM, or LOW confidence and above"),
):
    """Returns a ranked list of Insider Conviction scores across all currently active symbols."""
    confidence_order = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
    try:
        results = scorer.score_active_symbols(limit=limit * 3 if min_confidence else limit)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute conviction ranking: {str(e)}")

    if min_confidence:
        threshold = confidence_order.get(min_confidence.upper())
        if threshold is None:
            raise HTTPException(status_code=400, detail="min_confidence must be HIGH, MEDIUM, or LOW")
        results = [r for r in results if confidence_order.get(r["confidence"]["tier"], 0) >= threshold]

    results = results[:limit]

    for r in results:
        persistence.save_snapshot(r)

    def _net_buying_value(r):
        ts = r["components"].get("transaction_strength", {})
        return ts["metrics"].get("net_value") if ts.get("available") else None

    ranking = [
        {
            "rank": idx + 1,
            "symbol": r["symbol"],
            "overall_score": r["overall_score"],
            "confidence": r["confidence"]["tier"],
            "components_available": r["components_available"],
            "components_total": r["components_total"],
            "net_buying_value": _net_buying_value(r),
        }
        for idx, r in enumerate(results)
    ]

    return {"model_version": conviction_cfg.MODEL_VERSION, "count": len(ranking), "ranking": ranking}


@router.get("/{symbol}")
def get_conviction_score(symbol: str):
    """Returns the full transparent Insider Conviction result for a single symbol."""
    symbol = _validate_symbol(symbol)
    try:
        result = scorer.score_symbol(symbol)
    except Exception as e:
        logger.error(f"Conviction scoring failed for {symbol}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to compute conviction score: {str(e)}")

    persistence.save_snapshot(result)
    return result


@router.get("/{symbol}/explanation")
def get_conviction_explanation(symbol: str):
    """Returns just the human-readable explanation for a symbol's Insider Conviction Score."""
    symbol = _validate_symbol(symbol)
    try:
        result = scorer.score_symbol(symbol)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to compute conviction score: {str(e)}")
    return explanations.generate_explanation(result)


@router.get("/{symbol}/history")
def get_conviction_history(symbol: str, limit: int = Query(30, ge=1, le=200)):
    """Returns previously stored Insider Conviction snapshots for a symbol, most recent first."""
    symbol = _validate_symbol(symbol)
    history = persistence.get_history(symbol, limit=limit)
    return {"symbol": symbol, "count": len(history), "history": history}
