"""
Tests for the Insider Conviction Engine.

These exercise the pure scoring functions in backend/engine/conviction/
directly, with synthetic deal/candle data - no database connection is
required, since factors.py, scorer.build_result, and explanations.py take
plain data structures as input and never touch the DB themselves (all DB
access is isolated to market_data.py / persistence.py).

Run with: pytest tests/test_conviction.py -v
"""

import sys
from pathlib import Path
from datetime import date, timedelta

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import pytest

from backend.engine.conviction import factors, scorer, explanations, configuration as cfg


TODAY = date(2026, 8, 28)


def make_deal(action, days_ago, client_name="Insider A", role="Other", total_value=1_000_000.0, quantity=1000, price=100.0, deal_category="Insider Trading"):
    return {
        "id": hash((client_name, days_ago, action)) % 100000,
        "deal_category": deal_category,
        "trade_date": TODAY - timedelta(days=days_ago),
        "client_name": client_name,
        "role": role,
        "action": action,
        "quantity": quantity,
        "price": price,
        "total_value": total_value,
    }


def make_candle(days_ago, close, open_=None, high=None, low=None, volume=1_000_000, delivery_pct=50.0):
    d = TODAY - timedelta(days=days_ago)
    o = open_ if open_ is not None else close
    return {
        "trade_date": d,
        "open": o,
        "high": high if high is not None else close,
        "low": low if low is not None else close,
        "close": close,
        "volume": volume,
        "delivery_pct": delivery_pct,
    }


def make_price_series(start_days_ago, num_days, start_price=100.0, daily_return_pct=0.0, volume=1_000_000, delivery_pct=50.0):
    """Generates a contiguous daily candle series counting DOWN from start_days_ago to 0."""
    candles = []
    price = start_price
    for i in range(num_days):
        days_ago = start_days_ago - i
        if days_ago < 0:
            break
        candles.append(make_candle(days_ago, price, volume=volume, delivery_pct=delivery_pct))
        price = price * (1 + daily_return_pct / 100.0)
    return candles


# ---------------------------------------------------------------------------
# 1. Strong insider buying
# ---------------------------------------------------------------------------
def test_strong_insider_buying_scores_above_neutral():
    deals = [make_deal("BUY", days_ago=5, client_name=f"Insider {i}", role="Promoter") for i in range(4)]
    result = factors.compute_insider_activity(deals, TODAY)
    assert result["available"] is True
    assert result["score"] > 50.0


# ---------------------------------------------------------------------------
# 2. Strong insider selling
# ---------------------------------------------------------------------------
def test_strong_insider_selling_scores_below_neutral():
    deals = [make_deal("SELL", days_ago=5, client_name=f"Insider {i}") for i in range(4)]
    result = factors.compute_insider_activity(deals, TODAY)
    assert result["available"] is True
    assert result["score"] < 50.0


# ---------------------------------------------------------------------------
# 3. Multiple insiders buying -> accumulation boosted vs a single buyer
# ---------------------------------------------------------------------------
def test_multiple_insiders_buying_beats_single_buyer_accumulation():
    single = [make_deal("BUY", days_ago=5, client_name="Insider A")]
    multiple = [make_deal("BUY", days_ago=5, client_name=f"Insider {i}") for i in range(4)]
    score_single = factors.compute_accumulation(single)["score"]
    score_multiple = factors.compute_accumulation(multiple)["score"]
    assert score_multiple > score_single


# ---------------------------------------------------------------------------
# 4. Repeat buying by the same insider boosts accumulation further
# ---------------------------------------------------------------------------
def test_repeat_buying_boosts_accumulation():
    one_off = [make_deal("BUY", days_ago=5, client_name="Insider A")]
    repeated = [
        make_deal("BUY", days_ago=30, client_name="Insider A"),
        make_deal("BUY", days_ago=15, client_name="Insider A"),
        make_deal("BUY", days_ago=5, client_name="Insider A"),
    ]
    score_one_off = factors.compute_accumulation(one_off)["score"]
    score_repeated = factors.compute_accumulation(repeated)["score"]
    assert score_repeated > score_one_off


# ---------------------------------------------------------------------------
# 5. Promoter buying receives a higher role bonus than an unclassified buyer
# ---------------------------------------------------------------------------
def test_promoter_role_bonus_exceeds_other_role():
    promoter_deals = [make_deal("BUY", days_ago=5, role="Promoter")]
    other_deals = [make_deal("BUY", days_ago=5, role="Other")]
    promoter_score = factors.compute_insider_activity(promoter_deals, TODAY)["score"]
    other_score = factors.compute_insider_activity(other_deals, TODAY)["score"]
    assert promoter_score > other_score


# ---------------------------------------------------------------------------
# 6. Large transaction relative to market cap scores higher than a small one
# ---------------------------------------------------------------------------
def test_large_transaction_vs_market_cap_scores_higher():
    deals = [make_deal("BUY", days_ago=5, total_value=50_000_000.0)]  # ₹5 Cr
    small_cap_result = factors.compute_transaction_strength(deals, market_cap=500_000_000.0)     # ₹50 Cr mcap -> 10%
    large_cap_result = factors.compute_transaction_strength(deals, market_cap=500_000_000_000.0)  # ₹50,000 Cr mcap -> 0.01%
    assert small_cap_result["score"] > large_cap_result["score"]


# ---------------------------------------------------------------------------
# 7. Small transaction relative to market cap contributes near-zero mcap points
# ---------------------------------------------------------------------------
def test_small_transaction_vs_huge_market_cap_contributes_little():
    deals = [make_deal("BUY", days_ago=5, total_value=5_000_000.0)]
    result = factors.compute_transaction_strength(deals, market_cap=1_000_000_000_000.0)  # ₹1 lakh Cr
    mcap_contrib = next((c for c in result["contributions"] if "market cap" in c["label"].lower()), None)
    assert mcap_contrib is not None
    assert mcap_contrib["points"] < 5.0


# ---------------------------------------------------------------------------
# 8. Missing market cap: component stays available, flagged unavailable in metrics
# ---------------------------------------------------------------------------
def test_missing_market_cap_does_not_break_transaction_strength():
    deals = [make_deal("BUY", days_ago=5, total_value=5_000_000.0)]
    result = factors.compute_transaction_strength(deals, market_cap=None)
    assert result["available"] is True
    assert result["metrics"]["market_cap_available"] is False
    assert not any("market cap" in c["label"].lower() for c in result["contributions"])


# ---------------------------------------------------------------------------
# 9. Missing volume: volume/delivery still scores using delivery alone
# ---------------------------------------------------------------------------
def test_missing_volume_falls_back_to_delivery_only():
    deals = [make_deal("BUY", days_ago=10)]
    candles = []
    for days_ago in range(40, 4, -1):
        candles.append(make_candle(days_ago, close=100.0, volume=None, delivery_pct=40.0 if days_ago > 15 else 70.0))
    result = factors.compute_volume_delivery(deals, candles)
    assert result["available"] is True
    assert result["metrics"]["volume_ratio_sample"] == 0
    assert result["metrics"]["delivery_ratio_sample"] >= 1
    assert any("Volume data unavailable" in c["label"] for c in result["contributions"])


# ---------------------------------------------------------------------------
# 10. Missing delivery: volume/delivery still scores using volume alone
# ---------------------------------------------------------------------------
def test_missing_delivery_falls_back_to_volume_only():
    deals = [make_deal("BUY", days_ago=10)]
    candles = []
    for days_ago in range(40, 4, -1):
        candles.append(make_candle(days_ago, close=100.0, volume=1_000_000 if days_ago > 15 else 2_000_000, delivery_pct=None))
    result = factors.compute_volume_delivery(deals, candles)
    assert result["available"] is True
    assert result["metrics"]["delivery_ratio_sample"] == 0
    assert any("Delivery data unavailable" in c["label"] for c in result["contributions"])


# ---------------------------------------------------------------------------
# 11. Insufficient historical data -> explicitly unavailable, never fabricated
# ---------------------------------------------------------------------------
def test_insufficient_historical_sample_is_marked_unavailable():
    deals = [make_deal("BUY", days_ago=400)]  # only one past event
    candles = make_price_series(420, 400, start_price=100.0)
    result = factors.compute_historical_success(deals, candles, TODAY)
    assert result["available"] is False
    assert result["unavailable_reason"] == "insufficient data"
    assert result["score"] is None


# ---------------------------------------------------------------------------
# 12. Mixed buy/sell activity -> net ratio near zero, accumulation penalized
# ---------------------------------------------------------------------------
def test_mixed_buy_sell_activity_is_near_neutral():
    deals = [make_deal("BUY", days_ago=10), make_deal("SELL", days_ago=8)]
    result = factors.compute_insider_activity(deals, TODAY)
    assert result["available"] is True
    assert 30.0 < result["score"] < 70.0


def test_repeated_buying_then_selling_reduces_accumulation():
    buys_only = [make_deal("BUY", days_ago=20, client_name="Insider A"), make_deal("BUY", days_ago=15, client_name="Insider A")]
    buys_then_sells = buys_only + [make_deal("SELL", days_ago=5, client_name="Insider A"), make_deal("SELL", days_ago=3, client_name="Insider A"), make_deal("SELL", days_ago=1, client_name="Insider A")]
    score_buys_only = factors.compute_accumulation(buys_only)["score"]
    score_with_sells = factors.compute_accumulation(buys_then_sells)["score"]
    assert score_with_sells < score_buys_only


# ---------------------------------------------------------------------------
# 13. Old vs recent transactions -> recency decay weights recent higher
# ---------------------------------------------------------------------------
def test_recency_weight_decays_with_age():
    fresh = factors.recency_weight(TODAY, TODAY)
    old = factors.recency_weight(TODAY - timedelta(days=90), TODAY)
    assert fresh == 1.0
    assert 0.0 < old < fresh


def test_older_buying_scores_lower_than_recent_buying():
    recent_deals = [make_deal("BUY", days_ago=2, client_name=f"Insider {i}") for i in range(2)]
    old_deals = [make_deal("BUY", days_ago=175, client_name=f"Insider {i}") for i in range(2)]
    recent_score = factors.compute_insider_activity(recent_deals, TODAY)["score"]
    old_score = factors.compute_insider_activity(old_deals, TODAY)["score"]
    assert recent_score > old_score


# ---------------------------------------------------------------------------
# 14 & 15. Score boundaries never leave [0, 100]
# ---------------------------------------------------------------------------
def test_score_bounds_clips_below_zero():
    assert cfg.score_bounds(-500.0) == 0.0


def test_score_bounds_clips_above_hundred():
    assert cfg.score_bounds(500.0) == 100.0


def test_extreme_selling_never_produces_negative_score():
    deals = [make_deal("SELL", days_ago=1, client_name=f"Insider {i}", total_value=100_000_000.0) for i in range(10)]
    ia = factors.compute_insider_activity(deals, TODAY)
    ts = factors.compute_transaction_strength(deals)
    acc = factors.compute_accumulation(deals)
    for result in (ia, ts, acc):
        assert 0.0 <= result["score"] <= 100.0


# ---------------------------------------------------------------------------
# 16. Missing-data normalization: weights renormalize to sum to 100%
# ---------------------------------------------------------------------------
def test_weight_renormalization_across_available_components():
    deals = [make_deal("BUY", days_ago=5, total_value=2_000_000.0)]
    # No candles at all -> price_confirmation, volume_delivery, historical_success all unavailable.
    result = scorer.build_result("TESTSYM", deals, [], [], TODAY)
    assert result["components_available"] == 3  # insider_activity, transaction_strength, accumulation
    normalized_sum = sum(
        c["normalized_weight_pct"] for c in result["components"].values() if c["available"]
    )
    assert abs(normalized_sum - 100.0) < 0.5
    assert all(c["weighted_contribution"] is None for c in result["components"].values() if not c["available"])


def test_fully_unavailable_result_has_no_overall_score():
    result = scorer.build_result("TESTSYM", [], [], [], TODAY)
    assert result["overall_score"] is None
    assert result["components_available"] == 0


# ---------------------------------------------------------------------------
# 17. Confidence calculation boundaries
# ---------------------------------------------------------------------------
def test_confidence_high_requires_strong_evidence():
    conf = scorer.compute_confidence(
        components_available=6, components_total=6, txn_count=10, unique_insiders=3,
        historical_available=True, market_data_available=True, market_cap_available=True,
    )
    assert conf["tier"] == "HIGH"


def test_confidence_low_with_sparse_evidence():
    conf = scorer.compute_confidence(
        components_available=1, components_total=6, txn_count=1, unique_insiders=1,
        historical_available=False, market_data_available=False, market_cap_available=False,
    )
    assert conf["tier"] == "LOW"


# ---------------------------------------------------------------------------
# 18. Look-ahead bias prevention
# ---------------------------------------------------------------------------
def test_historical_success_ignores_deals_after_as_of_date():
    as_of = TODAY - timedelta(days=100)
    deals_including_future = [
        make_deal("BUY", days_ago=200),  # before as_of -> valid
        make_deal("BUY", days_ago=50),   # after as_of (only 50 days ago vs as_of at 100 days ago) -> must be excluded
    ]
    candles = make_price_series(250, 250, start_price=100.0)
    result_with_asof = factors.compute_historical_success(deals_including_future, candles, as_of)
    # The future-relative deal must never be counted as of this earlier as_of_date.
    assert result_with_asof["metrics"].get("sample_size", 0) <= 1


def test_price_confirmation_only_uses_elapsed_windows():
    # A BUY deal from yesterday cannot have a 60-trading-day-elapsed window yet.
    deals = [make_deal("BUY", days_ago=1)]
    candles = make_price_series(3, 3, start_price=100.0)  # only 3 days of candles exist
    result = factors.compute_price_confirmation(deals, candles, TODAY)
    assert result["available"] is False
    assert "too new" in result["unavailable_reason"].lower()


# ---------------------------------------------------------------------------
# 19. Model version is present and consistent
# ---------------------------------------------------------------------------
def test_model_version_is_stamped_on_every_result():
    assert cfg.MODEL_VERSION == "INSIDER_CONVICTION_V1"
    result = scorer.build_result("TESTSYM", [make_deal("BUY", days_ago=5)], [], [], TODAY)
    assert result["model_version"] == cfg.MODEL_VERSION


# ---------------------------------------------------------------------------
# 20. Explanation generation is derived purely from the computed result
# ---------------------------------------------------------------------------
def test_explanation_generation_reflects_available_and_unavailable_components():
    deals = [make_deal("BUY", days_ago=5, client_name=f"Insider {i}", role="Promoter") for i in range(3)]
    result = scorer.build_result("TESTSYM", deals, [], [], TODAY)
    explanation = explanations.generate_explanation(result)

    assert explanation["symbol"] == "TESTSYM"
    assert "INSIDER CONVICTION SCORE" in explanation["headline"]
    assert len(explanation["positive"]) > 0
    # price_confirmation/volume_delivery/historical_success are unavailable (no candles) -> must appear as negative flags
    assert any("unavailable" in n.lower() for n in explanation["negative"])
    assert "guaranteed" not in explanation["disclaimer"].lower() or "not" in explanation["disclaimer"].lower()


def test_explanation_handles_fully_unavailable_result():
    result = scorer.build_result("TESTSYM", [], [], [], TODAY)
    explanation = explanations.generate_explanation(result)
    assert "INSUFFICIENT DATA" in explanation["headline"]
