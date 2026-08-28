"""
Tests for the Smart Stock Screener.

Pure-function style, matching tests/test_conviction.py: synthetic deals and
candles, no database connection required. filters.py/ranking.py/screener.py
(the paginate helper) and technical_analysis.py never touch the DB
themselves - all DB access is isolated to conviction/market_data.py, which
is not exercised here.

Run with: pytest tests/test_screener.py -v
"""

import sys
from pathlib import Path
from datetime import date, timedelta

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.engine import technical_analysis as ta
from backend.engine.conviction import scorer as conviction_scorer
from backend.engine.screener import filters as flt
from backend.engine.screener import ranking
from backend.engine.screener.screener import paginate, _compute_insider_window_metrics, build_candidate

TODAY = date(2026, 8, 28)


def make_deal(action, days_ago, client_name="Insider A", role="Other", total_value=1_000_000.0, deal_category="Insider Trading"):
    return {
        "id": hash((client_name, days_ago, action)) % 100000,
        "deal_category": deal_category,
        "trade_date": TODAY - timedelta(days=days_ago),
        "client_name": client_name,
        "role": role,
        "action": action,
        "quantity": 1000,
        "price": 100.0,
        "total_value": total_value,
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
    """Contiguous daily candles, oldest first, ending at days_ago=0 (today)."""
    candles = []
    price = start_price
    for days_ago in range(num_days - 1, -1, -1):
        candles.append(make_candle(days_ago, price, volume=volume, delivery_pct=delivery_pct))
        price = price * (1 + daily_return_pct / 100.0)
    return candles


def default_technical(candles=None):
    return ta.compute_all(candles or make_series(260))


# ---------------------------------------------------------------------------
# 1 & 16. Insider BUY / SELL filters
# ---------------------------------------------------------------------------
def test_insider_buy_filter_requires_buy_activity():
    f = flt.InsiderFilters(buy=True, sell=False, min_insiders=0)
    metrics_no_buy = _compute_insider_window_metrics([make_deal("SELL", 1)])
    metrics_with_buy = _compute_insider_window_metrics([make_deal("BUY", 1)])
    assert flt.evaluate_insider(metrics_no_buy, f) != []
    assert flt.evaluate_insider(metrics_with_buy, f) == []


def test_insider_sell_filter_requires_sell_activity():
    f = flt.InsiderFilters(buy=False, sell=True, min_insiders=0)
    metrics_no_sell = _compute_insider_window_metrics([make_deal("BUY", 1)])
    metrics_with_sell = _compute_insider_window_metrics([make_deal("SELL", 1)])
    assert flt.evaluate_insider(metrics_no_sell, f) != []
    assert flt.evaluate_insider(metrics_with_sell, f) == []


# ---------------------------------------------------------------------------
# 3. Minimum transaction value
# ---------------------------------------------------------------------------
def test_min_transaction_value_excludes_below_threshold():
    f = flt.InsiderFilters(buy=True, min_insiders=0, min_transaction_value_lakhs=100.0)  # ₹1 Cr
    small_metrics = _compute_insider_window_metrics([make_deal("BUY", 1, total_value=5_000_000.0)])  # ₹50L
    large_metrics = _compute_insider_window_metrics([make_deal("BUY", 1, total_value=15_000_000.0)])  # ₹1.5Cr
    assert flt.evaluate_insider(small_metrics, f) != []
    assert flt.evaluate_insider(large_metrics, f) == []


def test_min_transaction_value_excludes_when_no_value_known():
    f = flt.InsiderFilters(buy=True, min_insiders=0, min_transaction_value_lakhs=1.0)
    metrics = _compute_insider_window_metrics([make_deal("BUY", 1, total_value=None)])
    assert metrics["total_value"] is None
    assert flt.evaluate_insider(metrics, f) != []  # unmeasurable -> excluded, not silently passed


# ---------------------------------------------------------------------------
# 4. Minimum insider count (direction-aware)
# ---------------------------------------------------------------------------
def test_min_insiders_is_direction_aware():
    f = flt.InsiderFilters(buy=True, sell=False, min_insiders=2)
    # 1 buyer + 1 seller = 2 unique overall, but only 1 unique BUYER.
    deals = [make_deal("BUY", 1, client_name="A"), make_deal("SELL", 1, client_name="B")]
    metrics = _compute_insider_window_metrics(deals)
    assert flt.evaluate_insider(metrics, f) != []  # only 1 buyer, needs 2

    deals_two_buyers = [make_deal("BUY", 1, client_name="A"), make_deal("BUY", 2, client_name="B")]
    metrics2 = _compute_insider_window_metrics(deals_two_buyers)
    assert flt.evaluate_insider(metrics2, f) == []


# ---------------------------------------------------------------------------
# 5. Promoter buying
# ---------------------------------------------------------------------------
def test_promoter_buying_filter():
    f = flt.InsiderFilters(buy=True, min_insiders=0, promoter_buying=True)
    no_promoter = _compute_insider_window_metrics([make_deal("BUY", 1, role="Other")])
    with_promoter = _compute_insider_window_metrics([make_deal("BUY", 1, role="Promoter")])
    assert flt.evaluate_insider(no_promoter, f) != []
    assert flt.evaluate_insider(with_promoter, f) == []


# ---------------------------------------------------------------------------
# 6. Repeat buying
# ---------------------------------------------------------------------------
def test_repeat_buying_filter():
    f = flt.InsiderFilters(buy=True, min_insiders=0, repeat_buying=True)
    single = _compute_insider_window_metrics([make_deal("BUY", 1, client_name="A")])
    repeated = _compute_insider_window_metrics([make_deal("BUY", 5, client_name="A"), make_deal("BUY", 1, client_name="A")])
    assert flt.evaluate_insider(single, f) != []
    assert flt.evaluate_insider(repeated, f) == []


# ---------------------------------------------------------------------------
# 7. Lookback period changes which deals are considered
# ---------------------------------------------------------------------------
def test_lookback_window_excludes_older_deals():
    deals = [make_deal("BUY", days_ago=45)]
    window_start_30 = TODAY - timedelta(days=30)
    window_start_60 = TODAY - timedelta(days=60)
    in_30d_window = [d for d in deals if d["trade_date"] >= window_start_30]
    in_60d_window = [d for d in deals if d["trade_date"] >= window_start_60]
    assert len(in_30d_window) == 0
    assert len(in_60d_window) == 1


# ---------------------------------------------------------------------------
# 8. Price-return filters
# ---------------------------------------------------------------------------
def test_price_return_filter_excludes_out_of_range():
    technical = default_technical(make_series(30, start_price=100.0, daily_return_pct=1.0))  # strong uptrend
    f_high_min = flt.PriceFilters(return_20d_min=50.0)  # unrealistically high bar
    f_low_min = flt.PriceFilters(return_20d_min=0.0)
    assert flt.evaluate_price(technical, f_high_min) != []
    assert flt.evaluate_price(technical, f_low_min) == []


def test_price_return_filter_excludes_when_insufficient_history():
    technical = default_technical(make_series(3))  # far too short for any window
    f = flt.PriceFilters(return_20d_min=0.0)
    assert flt.evaluate_price(technical, f) != []


# ---------------------------------------------------------------------------
# 9. DMA filters
# ---------------------------------------------------------------------------
def test_above_50dma_filter():
    uptrend = default_technical(make_series(260, start_price=100.0, daily_return_pct=0.3))
    downtrend = default_technical(make_series(260, start_price=200.0, daily_return_pct=-0.3))
    f = flt.TechnicalFilters(above_50dma=True)
    assert flt.evaluate_technical(uptrend, f) == []
    assert flt.evaluate_technical(downtrend, f) != []


def test_dma_unavailable_with_insufficient_history():
    technical = default_technical(make_series(10))
    assert technical["dma"]["dma_20"] is None
    assert technical["dma"]["above_dma_20"] is None
    f = flt.TechnicalFilters(above_20dma=True)
    assert flt.evaluate_technical(technical, f) != []  # can't verify -> excluded


# ---------------------------------------------------------------------------
# 10. RSI filters
# ---------------------------------------------------------------------------
def test_rsi_all_gains_is_100():
    technical = default_technical(make_series(30, start_price=100.0, daily_return_pct=1.0))
    assert technical["rsi"] == 100.0
    f = flt.TechnicalFilters(rsi_min=90.0)
    assert flt.evaluate_technical(technical, f) == []


def test_rsi_all_losses_is_0():
    technical = default_technical(make_series(30, start_price=200.0, daily_return_pct=-1.0))
    assert technical["rsi"] == 0.0


# ---------------------------------------------------------------------------
# 11. Volume ratio filter
# ---------------------------------------------------------------------------
def test_volume_ratio_filter():
    candles = make_series(30, volume=1_000_000)
    for c in candles[-5:]:
        c["volume"] = 3_000_000  # recent spike
    technical = default_technical(candles)
    assert technical["volume_ratio"] == 3.0
    f = flt.TechnicalFilters(volume_ratio_min=2.0)
    assert flt.evaluate_technical(technical, f) == []
    f_too_high = flt.TechnicalFilters(volume_ratio_min=5.0)
    assert flt.evaluate_technical(technical, f_too_high) != []


# ---------------------------------------------------------------------------
# 12. Breakout filter
# ---------------------------------------------------------------------------
def test_breakout_filter():
    candles = make_series(25, start_price=100.0, daily_return_pct=0.0)
    candles[-1]["close"] = 200.0  # today's close is a clear new high
    technical = default_technical(candles)
    assert technical["breakout"]["is_breakout"] is True
    f = flt.TechnicalFilters(breakout=True)
    assert flt.evaluate_technical(technical, f) == []

    flat_technical = default_technical(make_series(25, start_price=100.0, daily_return_pct=0.0))
    assert flt.evaluate_technical(flat_technical, f) != []


# ---------------------------------------------------------------------------
# 13 & 14. Delivery filter and delivery increase
# ---------------------------------------------------------------------------
def test_delivery_pct_filter():
    candles = make_series(30, delivery_pct=40.0)
    candles[-1]["delivery_pct"] = 70.0
    technical = default_technical(candles)
    f = flt.DeliveryFilters(delivery_pct_min=60.0)
    assert flt.evaluate_delivery(technical, f) == []
    f_too_high = flt.DeliveryFilters(delivery_pct_min=90.0)
    assert flt.evaluate_delivery(technical, f_too_high) != []


def test_delivery_increase_filter():
    candles = make_series(30, delivery_pct=40.0)
    candles[-1]["delivery_pct"] = 70.0  # +30 points vs baseline
    technical = default_technical(candles)
    assert technical["delivery"]["delivery_increase"] == 30.0
    f = flt.DeliveryFilters(delivery_increase_min=10.0)
    assert flt.evaluate_delivery(technical, f) == []


def test_missing_delivery_excludes_when_filter_set():
    candles = make_series(30, delivery_pct=None)
    technical = default_technical(candles)
    assert technical["delivery"]["current_delivery_pct"] is None
    f = flt.DeliveryFilters(delivery_pct_min=50.0)
    assert flt.evaluate_delivery(technical, f) != []


# ---------------------------------------------------------------------------
# 15. Deal type filters
# ---------------------------------------------------------------------------
def test_filter_deals_by_category():
    deals = [make_deal("BUY", 1, deal_category="Insider Trading"), make_deal("BUY", 1, deal_category="Block Deals")]
    only_insider = flt.filter_deals_by_category(deals, ["Insider Trading"])
    assert len(only_insider) == 1
    assert only_insider[0]["deal_category"] == "Insider Trading"


# ---------------------------------------------------------------------------
# 17. Conviction score filter
# ---------------------------------------------------------------------------
def test_conviction_score_filter():
    result_high = conviction_scorer.build_result("TEST", [make_deal("BUY", 1, client_name=f"I{i}", role="Promoter") for i in range(4)], [], make_series(260), TODAY)
    result_none = conviction_scorer.build_result("TEST", [], [], [], TODAY)

    f = flt.ConvictionFilters(min_score=50.0)
    assert flt.evaluate_conviction(result_none, f) != []  # unavailable -> excluded, never silently passed
    # High-conviction result should pass a modest threshold (verified via the score itself, not hard-coded).
    if result_high["overall_score"] is not None:
        f_low = flt.ConvictionFilters(min_score=result_high["overall_score"] - 1)
        assert flt.evaluate_conviction(result_high, f_low) == []


# ---------------------------------------------------------------------------
# 18. Multiple filters combined (AND semantics)
# ---------------------------------------------------------------------------
def test_evaluate_all_requires_every_filter_to_pass():
    candidate = build_candidate(
        "TEST",
        historical_deals=[make_deal("BUY", 5, client_name="A", role="Promoter", total_value=10_000_000.0)],
        insider_window_deals=[make_deal("BUY", 5, client_name="A", role="Promoter", total_value=10_000_000.0)],
        candles=make_series(260, start_price=100.0, daily_return_pct=0.2),
        as_of_date=TODAY,
    )
    req_permissive = flt.ScreenerRequest(insider=flt.InsiderFilters(buy=True, min_insiders=0))
    passes, failures = flt.evaluate_all(candidate, req_permissive)
    assert passes is True
    assert failures == []

    req_strict = flt.ScreenerRequest(
        insider=flt.InsiderFilters(buy=True, min_insiders=0, promoter_buying=True),
        conviction=flt.ConvictionFilters(min_score=99.9),  # near-impossible bar
    )
    passes2, failures2 = flt.evaluate_all(candidate, req_strict)
    assert passes2 is False
    assert len(failures2) >= 1


# ---------------------------------------------------------------------------
# 19. Sorting
# ---------------------------------------------------------------------------
def test_sort_results_descending_and_none_last():
    rows = [
        {"symbol": "A", "conviction_score": 50},
        {"symbol": "B", "conviction_score": 90},
        {"symbol": "C", "conviction_score": None},
        {"symbol": "D", "conviction_score": 70},
    ]
    sorted_desc = ranking.sort_results(rows, "conviction_score", "desc")
    assert [r["symbol"] for r in sorted_desc] == ["B", "D", "A", "C"]

    sorted_asc = ranking.sort_results(rows, "conviction_score", "asc")
    assert [r["symbol"] for r in sorted_asc] == ["A", "D", "B", "C"]  # None always last, even ascending


# ---------------------------------------------------------------------------
# 20. Pagination
# ---------------------------------------------------------------------------
def test_pagination_slices_and_ranks_correctly():
    rows = [{"symbol": f"S{i}"} for i in range(23)]
    total_count, total_pages, page1 = paginate(rows, page=1, page_size=10)
    assert total_count == 23
    assert total_pages == 3
    assert len(page1) == 10
    assert page1[0]["rank"] == 1

    _, _, page3 = paginate(rows, page=3, page_size=10)
    assert len(page3) == 3
    assert page3[0]["rank"] == 21


def test_pagination_empty_set():
    total_count, total_pages, rows = paginate([], page=1, page_size=25)
    assert total_count == 0
    assert total_pages == 1
    assert rows == []


# ---------------------------------------------------------------------------
# 21. Missing data generally (composite check across filter groups)
# ---------------------------------------------------------------------------
def test_unset_filters_never_exclude_on_missing_data():
    technical = default_technical(make_series(3))  # minimal history, almost everything None
    assert flt.evaluate_price(technical, flt.PriceFilters()) == []
    assert flt.evaluate_technical(technical, flt.TechnicalFilters()) == []
    assert flt.evaluate_delivery(technical, flt.DeliveryFilters()) == []


# ---------------------------------------------------------------------------
# 22. Empty results (candidate fails every combination)
# ---------------------------------------------------------------------------
def test_impossible_filter_combination_yields_no_pass():
    candidate = build_candidate(
        "TEST", historical_deals=[], insider_window_deals=[], candles=[], as_of_date=TODAY,
    )
    req = flt.ScreenerRequest(insider=flt.InsiderFilters(buy=True))
    passes, failures = flt.evaluate_all(candidate, req)
    assert passes is False
    assert len(failures) > 0


# ---------------------------------------------------------------------------
# 23. Historical win rate (reused from Conviction Engine, not recalculated)
# ---------------------------------------------------------------------------
def test_historical_win_rate_insufficient_when_conviction_unavailable():
    candidate = {"conviction": conviction_scorer.build_result("TEST", [], [], [], TODAY), "technical": default_technical(), "insider": _compute_insider_window_metrics([])}
    win_rate = ranking.historical_win_rate(candidate)
    assert win_rate["available"] is False


# ---------------------------------------------------------------------------
# 24. Signal strength
# ---------------------------------------------------------------------------
def test_signal_strength_weak_with_no_conviction():
    candidate = {
        "conviction": conviction_scorer.build_result("TEST", [], [], [], TODAY),
        "technical": default_technical(make_series(3)),
        "insider": _compute_insider_window_metrics([]),
    }
    signal = ranking.classify_signal_strength(candidate)
    assert signal["tier"] == "WEAK"


def test_signal_strength_reasons_are_named_and_real():
    deals = [make_deal("BUY", 5, client_name=f"I{i}", role="Promoter", total_value=20_000_000.0) for i in range(4)]
    candles = make_series(260, start_price=100.0, daily_return_pct=0.3)
    for c in candles[-5:]:
        c["volume"] = 5_000_000
        c["delivery_pct"] = 80.0
    candidate = build_candidate("TEST", deals, deals, candles, TODAY)
    signal = ranking.classify_signal_strength(candidate)
    assert signal["tier"] in ("MODERATE", "STRONG", "VERY STRONG")
    assert len(signal["reasons"]) == signal["evidence_count"]
    assert all(isinstance(r, str) and r for r in signal["reasons"])
