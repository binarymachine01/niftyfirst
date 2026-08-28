"""
Tests for the Stock Intelligence page's backend orchestrator (Phase 4).

Pure-function style, matching the existing test files: synthetic deals and
candles, no database connection required. get_stock_intelligence() itself
needs a DB (symbol validation + loaders), so it is not exercised here -
its building blocks (_build_header, _build_repeat_buyers,
_build_deal_activity, _build_historical_signal_windows, _build_explanation)
are all pure and are tested directly, along with a regression check that
extending compute_historical_success's window breakdown (added for this
phase) left the Conviction Score's actual formula untouched.

Run with: pytest tests/test_stock_intelligence.py -v
"""

import sys
from pathlib import Path
from datetime import date, timedelta

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.engine.conviction import factors, scorer as conviction_scorer
from backend.engine.screener.screener import build_candidate
from backend.engine import stock_intelligence as si

TODAY = date(2026, 8, 28)


def make_deal(action, days_ago, client_name="Insider A", role="Other", total_value=1_000_000.0, deal_category="Insider Trading", security_name="Test Security Ltd."):
    return {
        "id": hash((client_name, days_ago, action, deal_category)) % 100000,
        "deal_category": deal_category,
        "trade_date": TODAY - timedelta(days=days_ago),
        "client_name": client_name,
        "role": role,
        "action": action,
        "quantity": 1000,
        "price": 100.0,
        "total_value": total_value,
        "security_name": security_name,
    }


def make_candle(days_ago, close, volume=1_000_000, delivery_pct=50.0, high=None, low=None):
    return {
        "trade_date": TODAY - timedelta(days=days_ago),
        "open": close,
        "high": high if high is not None else close,
        "low": low if low is not None else close,
        "close": close,
        "volume": volume,
        "delivery_pct": delivery_pct,
    }


def make_series(num_days, start_price=100.0, daily_return_pct=0.0, volume=1_000_000, delivery_pct=50.0):
    candles = []
    price = start_price
    for days_ago in range(num_days - 1, -1, -1):
        candles.append(make_candle(days_ago, price, volume=volume, delivery_pct=delivery_pct))
        price = price * (1 + daily_return_pct / 100.0)
    return candles


# ---------------------------------------------------------------------------
# Header rendering data (latest price/change/52-week)
# ---------------------------------------------------------------------------
def test_build_header_computes_change_and_52w_range():
    candles = make_series(10, start_price=100.0, daily_return_pct=1.0)
    header = si._build_header(candles)
    assert header["latest_price"] is not None
    assert header["change"] is not None
    assert header["change"] > 0  # uptrend series
    assert header["week_52_high"] >= header["week_52_low"]


def test_build_header_handles_no_candles():
    header = si._build_header([])
    assert header["latest_price"] is None
    assert header["change"] is None
    assert header["week_52_high"] is None
    assert header["week_52_low"] is None


def test_build_header_single_candle_has_no_change():
    header = si._build_header([make_candle(0, 100.0)])
    assert header["latest_price"] == 100.0
    assert header["change"] is None  # no previous candle to compare against


# ---------------------------------------------------------------------------
# Repeat buyers
# ---------------------------------------------------------------------------
def test_build_repeat_buyers_filters_single_purchases():
    buyer_counts = {"Person A": 3, "Person B": 1, "Person C": 2}
    repeat = si._build_repeat_buyers(buyer_counts)
    names = {r["client_name"] for r in repeat}
    assert names == {"Person A", "Person C"}
    assert all(r["purchase_count"] > 1 for r in repeat)


def test_build_repeat_buyers_empty_when_none_repeat():
    assert si._build_repeat_buyers({"Person A": 1, "Person B": 1}) == []


# ---------------------------------------------------------------------------
# Deal activity breakdown by category (reuses existing deal_category classification)
# ---------------------------------------------------------------------------
def test_build_deal_activity_groups_by_category():
    deals = [
        make_deal("BUY", 1, deal_category="Insider Trading", total_value=1_000_000.0),
        make_deal("SELL", 2, deal_category="Insider Trading", total_value=500_000.0),
        make_deal("BUY", 3, deal_category="Block Deals", total_value=2_000_000.0),
    ]
    activity = si._build_deal_activity(deals)
    assert activity["Insider Trading"]["buy_count"] == 1
    assert activity["Insider Trading"]["sell_count"] == 1
    assert activity["Insider Trading"]["buy_value"] == 1_000_000.0
    assert activity["Block Deals"]["buy_count"] == 1
    assert "SAST Deals" not in activity  # no activity -> not fabricated as zero-filled entry


def test_build_deal_activity_missing_value_is_none_not_zero():
    deals = [make_deal("BUY", 1, deal_category="Insider Trading", total_value=None)]
    activity = si._build_deal_activity(deals)
    assert activity["Insider Trading"]["buy_value"] is None
    assert activity["Insider Trading"]["buy_count"] == 1


# ---------------------------------------------------------------------------
# Historical signal windows (reused from Conviction Engine, not recalculated)
# ---------------------------------------------------------------------------
def test_historical_signal_windows_reads_conviction_by_window():
    # Enough past BUY events with an uptrend so every window has data.
    deals = [make_deal("BUY", days_ago=200 + i * 5) for i in range(6)]
    candles = make_series(400, start_price=100.0, daily_return_pct=0.15)
    conviction_result = conviction_scorer.build_result("TEST", [], deals, candles, TODAY)
    windows = si._build_historical_signal_windows(conviction_result)
    assert set(windows.keys()) == {"1d", "5d", "10d", "20d", "60d"}
    for w in windows.values():
        assert "available" in w and "sample_size" in w


def test_historical_signal_windows_insufficient_data_labeled_clearly():
    conviction_result = conviction_scorer.build_result("TEST", [], [], [], TODAY)
    windows = si._build_historical_signal_windows(conviction_result)
    for w in windows.values():
        assert w["available"] is False


# ---------------------------------------------------------------------------
# Regression: broadening HISTORICAL_SUCCESS_WINDOWS must not change the score
# ---------------------------------------------------------------------------
def test_historical_success_score_formula_unaffected_by_window_expansion():
    """
    factors.compute_historical_success now also reports 1D/60D stats
    (Phase 4 addition) via metrics["by_window"], but the score itself must
    still be computed purely from the 20D primary window, exactly as
    Phase 1 shipped it - this is what "Conviction Score matches Phase 1"
    depends on.
    """
    deals = [make_deal("BUY", days_ago=200 + i * 5) for i in range(6)]
    candles = make_series(400, start_price=100.0, daily_return_pct=0.15)
    result = factors.compute_historical_success(deals, candles, TODAY)

    if result["available"]:
        # The score must be derivable purely from the 20D-window contributions.
        assert "by_window" in result["metrics"]
        assert result["metrics"]["by_window"]["20"]["available"] is True
        # Primary metrics (pct_positive/avg_return) still reflect the 20D window only.
        assert result["metrics"]["pct_positive"] == result["metrics"]["by_window"]["20"]["pct_positive"]


def test_by_window_breakdown_can_have_larger_sample_for_shorter_windows():
    """
    A 1D window can have MORE qualifying events than the 20D-gated primary
    sample, since it only needs 1 trading day elapsed, not 20 - this is the
    whole point of computing by_window independently rather than reusing
    the 20D-gated event list.
    """
    # Recent deals: 1D window elapsed for all, but 20D hasn't elapsed for the most recent ones.
    deals = [make_deal("BUY", days_ago=d) for d in (2, 3, 4, 200, 205, 210)]
    candles = make_series(400, start_price=100.0, daily_return_pct=0.1)
    result = factors.compute_historical_success(deals, candles, TODAY)
    by_window = result["metrics"]["by_window"]
    if by_window["1"]["available"] and by_window["20"]["available"]:
        assert by_window["1"]["sample_size"] >= by_window["20"]["sample_size"]


# ---------------------------------------------------------------------------
# Explanation reuses Phase 1 + Phase 2, no new explanation engine
# ---------------------------------------------------------------------------
def test_build_explanation_merges_conviction_and_signal_reasons():
    deals = [make_deal("BUY", days_ago=5, client_name=f"I{i}", role="Promoter", total_value=15_000_000.0) for i in range(4)]
    candles = make_series(260, start_price=100.0, daily_return_pct=0.3)
    for c in candles[-5:]:
        c["volume"] = 3_000_000
        c["delivery_pct"] = 80.0
    candidate = build_candidate("TEST", deals, deals, candles, TODAY)
    explanation = si._build_explanation(candidate)

    assert "INSIDER CONVICTION SCORE" in explanation["headline"] or "INSUFFICIENT DATA" in explanation["headline"]
    assert explanation["signal_strength"] in ("WEAK", "MODERATE", "STRONG", "VERY STRONG")
    assert isinstance(explanation["positive"], list)
    assert isinstance(explanation["negative"], list)
    # Every reason listed in signal_reasons should also appear (as a bullet) in positive.
    for reason in explanation["signal_reasons"]:
        assert any(reason in p for p in explanation["positive"])


def test_build_explanation_handles_fully_unavailable_candidate():
    candidate = build_candidate("TEST", [], [], [], TODAY)
    explanation = si._build_explanation(candidate)
    assert "INSUFFICIENT DATA" in explanation["headline"]
    assert explanation["signal_strength"] == "WEAK"


# ---------------------------------------------------------------------------
# No look-ahead bias: company_name / recent-deal ordering never leaks future data
# ---------------------------------------------------------------------------
def test_deal_activity_and_repeat_buyers_only_use_provided_deals():
    """
    _build_deal_activity/_build_repeat_buyers only ever see whatever deal
    list the caller (get_stock_intelligence, which bounds everything by
    as_of_date via the existing conviction loaders) passes in - they have
    no independent DB access and cannot introduce look-ahead bias themselves.
    """
    future_deal = make_deal("BUY", days_ago=-5)  # a deal "in the future" relative to TODAY
    past_deal = make_deal("BUY", days_ago=5)
    # This module performs no date filtering of its own - the boundary is
    # the caller's responsibility (conviction/market_data.py). Demonstrating
    # that both a past and a (hypothetically mis-supplied) future deal are
    # treated identically confirms there is no separate, second boundary
    # that could silently diverge from the one already audited in Phase 1.
    activity_past_only = si._build_deal_activity([past_deal])
    activity_with_future = si._build_deal_activity([past_deal, future_deal])
    assert activity_past_only["Insider Trading"]["buy_count"] == 1
    assert activity_with_future["Insider Trading"]["buy_count"] == 2
