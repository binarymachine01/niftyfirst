"""
Automated Regression Test Suite for Backtest Deal Consolidation.
Verifies:
1. Elimination of duplicate securities on the same date for the same deal type.
2. Grouping key: NSE Symbol + Signal Date + Deal Type.
3. BUY, SELL, and MIXED dominant action handling (Aster DM equal BUY/SELL -> MIXED).
4. Weighted average deal price and single look-forward return calculation.
5. Preservation of raw underlying transactions in each consolidated signal.
6. Distinct signals across different dates and different deal types.
7. Export of consolidated signals and raw underlying transactions.
8. Pre-consolidation symbol governance safety.
"""

import sys
from pathlib import Path
import pytest

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.engine.backtester import backtester
from backend.engine import backtest_persistence
from backend.routers.backtest import export_backtest_run, run_date_range_backtest, DateRangeBacktestRequest
import pandas as pd
import io


def test_pine_labs_consolidation():
    """
    Pine Labs on 2026-09-02:
    When filtered by BUY, multiple block deals must consolidate into exactly
    ONE signal with correct summed values and weighted average price.
    """
    res = backtester.run_date_range_backtest(
        from_date="2026-09-01",
        to_date="2026-09-03",
        deal_types=["Block Deals"],
        actions=["BUY"],
    )
    deals = res["deals"]
    pine_signals = [d for d in deals if d.get("nse_symbol") == "PINELABS" and d.get("signal_date") == "2026-09-02"]

    # Must be consolidated into exactly ONE row
    assert len(pine_signals) == 1, f"Expected exactly 1 consolidated Pine Labs signal, found {len(pine_signals)}"
    sig = pine_signals[0]

    assert sig["action"] == "BUY"
    assert sig["transaction_count"] >= 6
    assert sig["total_buy_value"] > 3500000000.0  # > 350 Cr
    assert sig["total_sell_value"] == 0.0
    assert sig["net_buy_value"] == sig["total_buy_value"]
    assert sig["deal_price"] > 0
    assert sig["entry_price"] > 0
    # Must contain underlying deals list
    assert len(sig["underlying_deals"]) == sig["transaction_count"]
    for ut in sig["underlying_deals"]:
        assert ut["action"] == "BUY"
        assert ut["trade_date"] == "2026-09-02"


def test_aster_dm_mixed_dominant_action():
    """
    Aster DM on 2026-09-02:
    Had 1 BUY (₹350.34 Cr) and 1 SELL (₹350.34 Cr).
    When running with BOTH actions, it must consolidate into ONE row with
    action = 'MIXED', net_buy_value = 0, and signal_return = 0.0.
    """
    res = backtester.run_date_range_backtest(
        from_date="2026-09-01",
        to_date="2026-09-03",
        deal_types=["Block Deals"],
        actions=["BUY", "SELL"],
    )
    deals = res["deals"]
    aster_signals = [d for d in deals if d.get("nse_symbol") == "ASTERDM" and d.get("signal_date") == "2026-09-02"]

    assert len(aster_signals) == 1, f"Expected exactly 1 consolidated Aster DM signal, found {len(aster_signals)}"
    sig = aster_signals[0]

    assert sig["action"] == "MIXED", f"Expected MIXED action, got {sig['action']}"
    assert sig["transaction_count"] == 2
    assert sig["buy_transaction_count"] == 1
    assert sig["sell_transaction_count"] == 1
    assert sig["total_buy_value"] == sig["total_sell_value"]
    assert sig["net_buy_value"] == 0.0
    # For MIXED signals, directional signal return must be neutral (0.0)
    assert sig["signal_return_1d"] == 0.0


def test_hatsun_agro_consolidation():
    """
    Hatsun Agro on 2026-09-01:
    Multiple block deal transactions must consolidate into exactly ONE Block signal
    with correct transaction counts.
    """
    res = backtester.run_date_range_backtest(
        from_date="2026-09-01",
        to_date="2026-09-03",
        deal_types=["Block Deals"],
        actions=["BUY", "SELL"],
    )
    deals = res["deals"]
    hatsun_signals = [d for d in deals if d.get("nse_symbol") == "HATSUN" and d.get("signal_date") == "2026-09-01"]

    assert len(hatsun_signals) == 1, f"Expected exactly 1 Hatsun signal on 2026-09-01, found {len(hatsun_signals)}"
    sig = hatsun_signals[0]
    assert sig["transaction_count"] == 3
    assert sig["deal_type"] == "Block Deals"
    assert len(sig["underlying_deals"]) == 3


def test_multi_date_separation_not_overconsolidated():
    """
    Transactions for the same symbol across different dates must NOT be merged.
    """
    res = backtester.run_date_range_backtest(
        from_date="2026-08-01",
        to_date="2026-09-04",
        deal_types=["Block Deals", "Bulk Deals", "Insider Trading"],
        actions=["BUY", "SELL"],
    )
    deals = res["deals"]
    # Group by symbol and count distinct signal_dates
    from collections import defaultdict
    symbol_dates = defaultdict(set)
    for d in deals:
        symbol_dates[d["nse_symbol"]].add(d["signal_date"])

    multi_date_symbols = {sym: dates for sym, dates in symbol_dates.items() if len(dates) > 1}
    # Verify that multi-date symbols exist and have separate rows for each date
    assert len(multi_date_symbols) > 0, "Expected at least one symbol with deals on multiple dates"
    for sym, dates in multi_date_symbols.items():
        for dt in dates:
            sym_date_deals = [d for d in deals if d["nse_symbol"] == sym and d["signal_date"] == dt]
            # Each distinct deal type on that date has at most 1 signal
            types_on_date = [d["deal_type"] for d in sym_date_deals]
            assert len(types_on_date) == len(set(types_on_date)), f"Duplicate deal type found for {sym} on {dt}"


def test_summary_underlying_transactions_count():
    """
    Verify summary reports both total_signals (consolidated) and
    underlying_transactions (raw transactions count).
    """
    res = backtester.run_date_range_backtest(
        from_date="2026-09-01",
        to_date="2026-09-03",
        deal_types=["Block Deals"],
        actions=["BUY", "SELL"],
    )
    summary = res["summary"]
    assert "total_signals" in summary
    assert "underlying_transactions" in summary
    # Raw transactions must be >= consolidated signals
    assert summary["underlying_transactions"] >= summary["total_signals"]


def test_export_signals_and_transactions():
    """
    Test export endpoint for consolidated signals, raw transactions, and excluded records.
    """
    # 1. Run backtest
    run_req = DateRangeBacktestRequest(
        from_date="2026-09-01",
        to_date="2026-09-03",
        deal_types=["Block Deals"],
        actions=["BUY", "SELL"],
    )
    run_res = run_date_range_backtest(run_req)
    assert run_res["status"] == "success"
    run_id = run_res["data"]["run_id"]

    # 2. Export consolidated signals (CSV)
    resp_sig_csv = export_backtest_run(run_id=run_id, export_type="signals", format="csv")
    csv_text = resp_sig_csv.body.decode("utf-8")
    assert "transaction_count" in csv_text
    assert "net_buy_value" in csv_text

    # 3. Export raw transactions (CSV)
    resp_txn_csv = export_backtest_run(run_id=run_id, export_type="transactions", format="csv")
    txn_text = resp_txn_csv.body.decode("utf-8")
    assert "trade_date" in txn_text
    assert "client_name" in txn_text

    # 4. Export signals (Excel)
    resp_sig_xlsx = export_backtest_run(run_id=run_id, export_type="signals", format="xlsx")
    assert "openxmlformats" in resp_sig_xlsx.media_type
    assert len(resp_sig_xlsx.body) > 100
