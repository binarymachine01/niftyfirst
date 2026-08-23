"""
API Router for Quantitative Backtesting Engine.
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
try:
    from backend.engine.backtester import backtester
except ImportError:
    from ..engine.backtester import backtester

router = APIRouter(prefix="/api/backtest", tags=["Backtesting"])


class BacktestRequest(BaseModel):
    holding_days: int = Field(default=20, ge=1, le=250, description="Holding period in trading days")
    categories: List[str] = Field(
        default=["Insider Trading", "SAST Deals", "Block Deals", "Bulk Deals"],
        description="Deal categories to include in simulation"
    )
    action: str = Field(default="BUY", description="Trade action: BUY, SELL, or ALL")
    min_value_lakhs: float = Field(default=0.0, ge=0.0, description="Minimum deal value in Lakhs (INR)")
    stop_loss_pct: Optional[float] = Field(default=None, ge=0.0, le=100.0, description="Stop-loss percentage")
    take_profit_pct: Optional[float] = Field(default=None, ge=0.0, le=500.0, description="Take-profit percentage")
    initial_capital: float = Field(default=1000000.0, gt=0, description="Initial portfolio capital in INR")
    position_size_pct: float = Field(default=10.0, gt=0, le=100.0, description="Capital allocation percentage per trade")
    start_date: Optional[str] = Field(default=None, description="Start date YYYY-MM-DD")
    end_date: Optional[str] = Field(default=None, description="End date YYYY-MM-DD")


@router.post("/run")
def run_backtest(req: BacktestRequest):
    """
    Runs a quantitative backtesting simulation over historical market data.
    """
    try:
        results = backtester.run_backtest(
            holding_days=req.holding_days,
            categories=req.categories,
            action=req.action,
            min_value_lakhs=req.min_value_lakhs,
            stop_loss_pct=req.stop_loss_pct,
            take_profit_pct=req.take_profit_pct,
            initial_capital=req.initial_capital,
            position_size_pct=req.position_size_pct,
            start_date=req.start_date,
            end_date=req.end_date,
        )
        return {"status": "success", "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backtest simulation failed: {str(e)}")


@router.get("/preset-strategies")
def get_preset_strategies():
    """Returns a list of pre-configured profitable strategy templates."""
    return {
        "presets": [
            {
                "id": "insider_conviction_buy",
                "name": "Promoter & Insider High-Conviction Long",
                "description": "Buys on Promoter/Insider Buying with min ₹50L deal value and 30-day holding.",
                "config": {
                    "holding_days": 30,
                    "categories": ["Insider Trading"],
                    "action": "BUY",
                    "min_value_lakhs": 50.0,
                    "stop_loss_pct": 7.0,
                    "take_profit_pct": 25.0,
                    "position_size_pct": 10.0,
                }
            },
            {
                "id": "institutional_block_deal",
                "name": "Institutional Block Deal Follower",
                "description": "Follows institutional Block Deals with 15-day momentum window.",
                "config": {
                    "holding_days": 15,
                    "categories": ["Block Deals"],
                    "action": "BUY",
                    "min_value_lakhs": 500.0,
                    "stop_loss_pct": 5.0,
                    "take_profit_pct": 15.0,
                    "position_size_pct": 10.0,
                }
            },
            {
                "id": "sast_acquisition_swing",
                "name": "SAST Substantial Acquisition Swing",
                "description": "Trades strategic SAST acquisitions with a 45-day medium term horizon.",
                "config": {
                    "holding_days": 45,
                    "categories": ["SAST Deals"],
                    "action": "BUY",
                    "min_value_lakhs": 0.0,
                    "stop_loss_pct": 10.0,
                    "take_profit_pct": 30.0,
                    "position_size_pct": 10.0,
                }
            },
            {
                "id": "all_deals_momentum",
                "name": "All Deals Combined Momentum",
                "description": "Blended insider + block + bulk deals momentum with 20-day holding.",
                "config": {
                    "holding_days": 20,
                    "categories": ["Insider Trading", "SAST Deals", "Block Deals", "Bulk Deals"],
                    "action": "BUY",
                    "min_value_lakhs": 25.0,
                    "stop_loss_pct": 6.0,
                    "take_profit_pct": 20.0,
                    "position_size_pct": 10.0,
                }
            }
        ]
    }
