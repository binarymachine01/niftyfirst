import io
import csv
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field
import pandas as pd

try:
    from backend.engine.backtester import backtester
    from backend.engine import backtest_persistence
except ImportError:
    from ..engine.backtester import backtester
    from ..engine import backtest_persistence

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


# ==============================================================================
# FULL DEAL BACKTESTING BY DATE RANGE
# ==============================================================================

class DateRangeBacktestRequest(BaseModel):
    from_date: str = Field(..., description="From Date in YYYY-MM-DD format")
    to_date: str = Field(..., description="To Date in YYYY-MM-DD format")
    deal_types: Optional[List[str]] = Field(
        default=["Insider Trading", "SAST Deals", "Block Deals", "Bulk Deals"],
        description="Deal categories to include: Insider Trading, SAST Deals, Block Deals, Bulk Deals"
    )
    actions: Optional[List[str]] = Field(
        default=["BUY", "SELL"],
        description="Trade directions: BUY, SELL, or both"
    )
    exchange: str = Field(default="NSE", description="Target exchange (default: NSE)")
    min_value_lakhs: float = Field(default=0.0, ge=0.0, description="Minimum deal transaction value in ₹ Lakhs")


@router.get("/data-availability")
def get_data_availability():
    """Returns the available date range for EOD price candles and deal disclosures."""
    try:
        return backtester.get_data_availability()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check data availability: {str(e)}")


@router.post("/run-date-range")
def run_date_range_backtest(req: DateRangeBacktestRequest):
    """
    Executes a full historical deal signal backtest across a user-selected date range.
    Evaluates 1D, 5D, 10D, 20D, and 60D look-forward trading-day performance for all
    eligible deals, with full symbol governance and excluded record tracking.
    """
    try:
        run_result = backtester.run_date_range_backtest(
            from_date=req.from_date,
            to_date=req.to_date,
            deal_types=req.deal_types,
            actions=req.actions,
            exchange=req.exchange,
            min_value_lakhs=req.min_value_lakhs,
        )
        return {"status": "success", "data": run_result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Date range backtest failed: {str(e)}")


@router.get("/runs")
def list_backtest_runs(limit: int = Query(20, ge=1, le=100)):
    """Lists historical backtest executions."""
    try:
        runs = backtest_persistence.list_runs(limit=limit)
        return {"count": len(runs), "runs": runs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list backtest runs: {str(e)}")


@router.get("/runs/{run_id}")
def get_backtest_run_details(run_id: str):
    """Retrieves full backtest run data including deals and excluded records."""
    try:
        run_data = backtest_persistence.get_run(run_id=run_id, include_deals=True)
        if not run_data:
            raise HTTPException(status_code=404, detail=f"Backtest run '{run_id}' not found.")
        return {"status": "success", "data": run_data}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve run details: {str(e)}")


@router.get("/runs/{run_id}/export")
def export_backtest_run(
    run_id: str,
    export_type: str = Query("deals", pattern="^(deals|excluded)$"),
    format: str = Query("csv", pattern="^(csv|excel|xlsx)$"),
):
    """
    Exports deal-level results or excluded records to downloadable CSV or Excel (.xlsx).
    """
    run_data = backtest_persistence.get_run(run_id=run_id, include_deals=True)
    if not run_data:
        raise HTTPException(status_code=404, detail=f"Backtest run '{run_id}' not found.")

    if export_type == "deals":
        rows = run_data.get("deals", [])
        columns = [
            "deal_id", "deal_date", "deal_type", "action", "security_name", "nse_symbol",
            "company_name", "promoter_client", "quantity", "deal_price", "deal_value",
            "entry_date", "entry_price", "raw_return_1d", "raw_return_5d", "raw_return_10d",
            "raw_return_20d", "raw_return_60d", "signal_return_1d", "signal_return_5d",
            "signal_return_10d", "signal_return_20d", "signal_return_60d",
            "match_status", "match_confidence", "match_method"
        ]
        filename_prefix = f"backtest_deals_{run_id}"
    else:
        rows = run_data.get("excluded_records", [])
        columns = [
            "deal_id", "deal_date", "deal_type", "action", "security_name",
            "client_name", "deal_value", "reason", "match_status",
            "candidate_symbol", "match_confidence"
        ]
        filename_prefix = f"backtest_excluded_{run_id}"

    if rows:
        df = pd.DataFrame(rows)
        available_cols = [c for c in columns if c in df.columns]
        df = df[available_cols]
    else:
        df = pd.DataFrame(columns=columns)

    if format in ("excel", "xlsx"):
        buffer = io.BytesIO()
        with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Backtest")
        buffer.seek(0)
        return Response(
            content=buffer.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename_prefix}.xlsx"'},
        )
    else:
        csv_str = df.to_csv(index=False)
        return Response(
            content=csv_str,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename_prefix}.csv"'},
        )
