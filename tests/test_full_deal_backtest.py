import io
import sys
from pathlib import Path
import pytest
from datetime import datetime, date
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.engine.backtester import backtester, BacktestEngine
from backend.engine import backtest_persistence
from backend.routers.backtest import (
    get_data_availability,
    run_date_range_backtest,
    list_backtest_runs,
    get_backtest_run_details,
    export_backtest_run,
    DateRangeBacktestRequest,
)


def test_data_availability():
    """Verifies that EOD and Deals availability bounds are detected and structured."""
    avail = backtester.get_data_availability()
    assert "eod" in avail
    assert "deals" in avail
    assert avail["eod"]["min_date"] is not None
    assert avail["eod"]["max_date"] is not None
    assert avail["eod"]["trading_days"] > 0
    assert "->" in avail["eod"]["display"]


def test_date_range_validation_from_greater_than_to():
    """Verifies that selecting from_date > to_date raises a clear ValueError."""
    with pytest.raises(ValueError, match="cannot be after To Date"):
        backtester.run_date_range_backtest(from_date="2026-05-01", to_date="2026-01-01")


def test_date_range_validation_invalid_format():
    """Verifies that malformed date strings raise a ValueError."""
    with pytest.raises(ValueError, match="Invalid date format"):
        backtester.run_date_range_backtest(from_date="invalid-date", to_date="2026-05-01")


def test_date_range_validation_preceding_eod_data():
    """Verifies that requesting dates before any EOD price data is rejected."""
    with pytest.raises(ValueError, match="precedes available EOD data"):
        backtester.run_date_range_backtest(from_date="2020-01-01", to_date="2020-06-01")


def test_full_deal_backtest_execution():
    """
    Executes backtest for a verified historical window (e.g. Q1 2026).
    Verifies that every eligible deal is processed without silent truncation.
    """
    result = backtester.run_date_range_backtest(
        from_date="2026-01-01",
        to_date="2026-03-31",
        deal_types=["Insider Trading", "SAST Deals", "Block Deals", "Bulk Deals"],
        actions=["BUY", "SELL"],
        exchange="NSE",
    )

    assert result["run_id"].startswith("btr_")
    assert result["total_signals"] == result["eligible_signals"]
    assert result["underlying_transactions"] >= result["total_signals"]
    assert "summary" in result
    assert "horizon_performance" in result["summary"]
    assert "1D" in result["summary"]["horizon_performance"]
    assert "20D" in result["summary"]["horizon_performance"]
    assert "60D" in result["summary"]["horizon_performance"]

    # Verify deal-level records
    deals = result["deals"]
    assert len(deals) == result["eligible_signals"]
    for d in deals:
        assert "deal_id" in d
        assert "deal_date" in d
        assert "deal_type" in d
        assert "action" in d
        assert d["action"] in ("BUY", "SELL", "MIXED")
        assert d["match_status"] in ("MATCHED", "MANUAL_OVERRIDE")
        assert d["entry_price"] > 0
        assert "raw_return_1d" in d
        assert "signal_return_1d" in d
        assert "raw_return_20d" in d
        assert "signal_return_20d" in d


def test_buy_vs_sell_signal_returns():
    """
    Verifies the signal return formula:
    For BUY: Signal Return = Raw Return
    For SELL: Signal Return = -Raw Return
    """
    result = backtester.run_date_range_backtest(
        from_date="2026-06-01",
        to_date="2026-06-15",
        deal_types=["Insider Trading", "SAST Deals", "Block Deals", "Bulk Deals"],
        actions=["BUY", "SELL"],
        exchange="NSE",
    )

    for d in result["deals"]:
        for h in [1, 5, 10, 20]:
            raw = d.get(f"raw_return_{h}d")
            sig = d.get(f"signal_return_{h}d")
            if raw is not None:
                if d["action"] == "BUY":
                    assert sig == raw
                elif d["action"] == "SELL":
                    assert sig == -raw


def test_symbol_governance_exclusion():
    """
    Verifies that LOW_CONFIDENCE and UNMATCHED deals are never allowed
    into eligible deals, and are audited in excluded_records with reasons.
    """
    result = backtester.run_date_range_backtest(
        from_date="2026-01-01",
        to_date="2026-03-31",
    )

    excluded = result["excluded_records"]
    assert len(excluded) == result["excluded_signals"]

    # Check that any excluded record has a recognized reason
    valid_reasons = {
        "LOW_CONFIDENCE_SYMBOL", "UNMATCHED_SYMBOL", "MISSING_NSE_SYMBOL",
        "MISSING_ENTRY_PRICE", "INSUFFICIENT_EOD_HISTORY"
    }
    for ex in excluded:
        assert ex["reason"] in valid_reasons
        assert "deal_id" in ex
        assert "security_name" in ex
        assert "match_status" in ex


def test_deal_type_and_action_breakdowns():
    """
    Verifies that breakdowns by deal type and action are computed with win rates.
    """
    result = backtester.run_date_range_backtest(
        from_date="2026-06-01",
        to_date="2026-06-30",
    )

    deal_type_perf = result["deal_type_performance"]
    action_perf = result["action_performance"]

    assert "Insider Trading" in deal_type_perf
    assert "SAST Deals" in deal_type_perf
    assert "Block Deals" in deal_type_perf
    assert "Bulk Deals" in deal_type_perf

    assert "BUY" in action_perf
    assert "SELL" in action_perf

    total_breakdown_signals = sum(v["signal_count"] for v in action_perf.values())
    assert total_breakdown_signals == result["eligible_signals"]


def test_backtest_persistence_and_retrieval():
    """
    Verifies saving and retrieving a backtest run via backtest_persistence.
    """
    result = backtester.run_date_range_backtest(
        from_date="2026-01-01",
        to_date="2026-01-31",
    )
    run_id = result["run_id"]

    saved = backtest_persistence.get_run(run_id, include_deals=True)
    assert saved is not None
    assert saved["run_id"] == run_id
    assert saved["total_signals"] == result["total_signals"]
    assert saved["eligible_signals"] == result["eligible_signals"]
    assert len(saved["deals"]) == len(result["deals"])
    assert len(saved["excluded_records"]) == len(result["excluded_records"])

    # Test listing runs
    runs_list = backtest_persistence.list_runs(10)
    assert any(r["run_id"] == run_id for r in runs_list)


def test_backtest_export_csv_and_excel():
    """
    Verifies exporting deal-level results and excluded records to CSV and Excel.
    """
    result = backtester.run_date_range_backtest(
        from_date="2026-01-01",
        to_date="2026-01-31",
    )
    run_id = result["run_id"]

    # 1. Export Deals CSV
    res_csv = export_backtest_run(run_id=run_id, export_type="deals", format="csv")
    assert res_csv.media_type == "text/csv"
    assert len(res_csv.body) > 0
    df_csv = pd.read_csv(io.StringIO(res_csv.body.decode("utf-8")))
    assert "deal_id" in df_csv.columns
    assert "nse_symbol" in df_csv.columns

    # 2. Export Deals Excel
    res_xlsx = export_backtest_run(run_id=run_id, export_type="deals", format="xlsx")
    assert "openxmlformats" in res_xlsx.media_type
    assert len(res_xlsx.body) > 0
    df_excel = pd.read_excel(io.BytesIO(res_xlsx.body))
    assert "deal_id" in df_excel.columns

    # 3. Export Excluded CSV
    res_ex_csv = export_backtest_run(run_id=run_id, export_type="excluded", format="csv")
    assert res_ex_csv.media_type == "text/csv"
    df_ex = pd.read_csv(io.StringIO(res_ex_csv.body.decode("utf-8")))
    assert "reason" in df_ex.columns
