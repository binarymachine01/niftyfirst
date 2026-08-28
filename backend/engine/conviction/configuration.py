"""
Centralized Scoring Configuration for the Insider Conviction Engine.

Every weight, threshold, cap, and multiplier used anywhere in the scoring
pipeline lives here. Nothing in factors.py / scorer.py / explanations.py
should hard-code a number that changes scoring behavior - it should be a
named constant imported from this module, so the methodology can be
audited and tuned in one place.
"""

MODEL_VERSION = "INSIDER_CONVICTION_V1"

# ---------------------------------------------------------------------------
# Component weights (must sum to 100). Treated as configuration, not code.
# ---------------------------------------------------------------------------
COMPONENT_WEIGHTS = {
    "insider_activity": 20.0,
    "transaction_strength": 20.0,
    "accumulation": 20.0,
    "price_confirmation": 15.0,
    "volume_delivery": 15.0,
    "historical_success": 10.0,
}
assert abs(sum(COMPONENT_WEIGHTS.values()) - 100.0) < 1e-6

COMPONENT_LABELS = {
    "insider_activity": "Insider Activity",
    "transaction_strength": "Transaction Strength",
    "accumulation": "Accumulation",
    "price_confirmation": "Price Confirmation",
    "volume_delivery": "Volume / Delivery",
    "historical_success": "Historical Success",
}

# ---------------------------------------------------------------------------
# Lookback / recency
# ---------------------------------------------------------------------------
# Window of insider/deal activity considered for the CURRENT conviction score.
CURRENT_LOOKBACK_DAYS = 180

# Window of past BUY events considered for the Historical Success track
# record. Kept bounded (rather than scanning full table history back to
# 2004 for SAST deals) so the batch ranking endpoint stays fast - a
# deliberate Phase 1 scope decision, documented in the methodology doc.
# Must stay >= CURRENT_LOOKBACK_DAYS: scorer.py loads deals once at this
# wider window and derives the "current" subset by filtering client-side.
HISTORICAL_LOOKBACK_DAYS = 730
assert HISTORICAL_LOOKBACK_DAYS >= CURRENT_LOOKBACK_DAYS

# Exponential recency decay half-life (days). A transaction this many days
# old counts for half the weight of one made today. No transaction is ever
# discarded - older activity simply contributes less.
RECENCY_HALF_LIFE_DAYS = 30.0

# Deal actions that represent genuine open-market conviction signals.
# StockEdge insider filings also carry Pledge/Unpledge/Pledge Invoke rows
# (collateral actions, not buy/sell conviction) - these are excluded.
CONVICTION_ACTIONS = ("BUY", "SELL")

# ---------------------------------------------------------------------------
# Price / volume / delivery windows
# ---------------------------------------------------------------------------
PRICE_CONFIRMATION_WINDOWS = (5, 10, 20, 30, 60)  # trading days
HISTORICAL_SUCCESS_WINDOWS = (5, 10, 20, 30)      # trading days

# Baseline window (trading days, ending 5 days before the deal date) used to
# compute "normal" volume/delivery for comparison. Kept strictly before the
# deal date so it can never leak post-deal information into the baseline.
VOLUME_BASELINE_LOOKBACK_DAYS = 25
VOLUME_BASELINE_GAP_DAYS = 5
VOLUME_POST_DEAL_WINDOW_DAYS = 5
MIN_BASELINE_CANDLES = 5

# ---------------------------------------------------------------------------
# Historical Success minimum sample size
# ---------------------------------------------------------------------------
MIN_HISTORICAL_SAMPLE_SIZE = 3

# ---------------------------------------------------------------------------
# Insider Activity Score constants
# ---------------------------------------------------------------------------
IA_NET_RATIO_MAX_POINTS = 40.0
IA_UNIQUE_BUYER_POINTS_PER = 3.0
IA_UNIQUE_BUYER_MAX_COUNT = 5
IA_UNIQUE_SELLER_POINTS_PER = 2.0
IA_UNIQUE_SELLER_MAX_COUNT = 5
IA_ROLE_BONUS = {
    "Promoter": 10.0,
    "Director": 7.0,
    "KMP": 5.0,
    "Other": 0.0,
}
IA_TXN_COUNT_BONUS_PER = 0.5
IA_TXN_COUNT_BONUS_MAX_COUNT = 10
# Rewards recent buying over old buying directly. Necessary because the net
# buy/sell RATIO term above is scale-invariant to recency when activity is
# one-directional (all buys or all sells) - the ratio only captures
# direction, not freshness, so recency must be surfaced as its own term.
IA_RECENCY_BONUS_MAX_POINTS = 10.0

# ---------------------------------------------------------------------------
# Transaction Strength Score constants
# ---------------------------------------------------------------------------
TS_NET_VALUE_MAX_POINTS = 45.0
TS_LARGEST_BUY_MAX_POINTS = 20.0
TS_TXN_COUNT_POINTS_PER = 1.5
TS_TXN_COUNT_MAX_COUNT = 8
# Log-scale reference: value (INR) -> points, linearly interpolated in log10 space.
TS_VALUE_SCALE_REFERENCE = (
    (0, 0.0),
    (1_000_000, 20.0),        # ₹10L
    (5_000_000, 40.0),        # ₹50L
    (10_000_000, 55.0),       # ₹1Cr
    (50_000_000, 75.0),       # ₹5Cr
    (250_000_000, 100.0),     # ₹25Cr+
)
# Market-cap normalization thresholds (transaction value / market cap, %).
# Structurally defined so scoring activates automatically once market-cap
# data becomes available; currently always "unavailable" in this deployment.
TS_MCAP_RATIO_REFERENCE = (
    (0.0, 0.0),
    (0.1, 20.0),
    (0.5, 50.0),
    (2.0, 80.0),
    (5.0, 100.0),
)
TS_MCAP_MAX_POINTS = 30.0

# ---------------------------------------------------------------------------
# Accumulation Score constants
# ---------------------------------------------------------------------------
ACC_BUY_DATES_POINTS_PER = 6.0
ACC_BUY_DATES_MAX_COUNT = 5
ACC_UNIQUE_BUYERS_POINTS_PER = 5.0
ACC_UNIQUE_BUYERS_MAX_COUNT = 5
ACC_REPEAT_BUYER_POINTS_PER = 8.0
ACC_REPEAT_BUYER_MAX_COUNT = 3
ACC_SELL_PENALTY_POINTS_PER = 6.0
ACC_SELL_PENALTY_MAX_COUNT = 5

# ---------------------------------------------------------------------------
# Price Confirmation Score constants
# ---------------------------------------------------------------------------
PC_RETURN_POINTS_MULTIPLIER = 2.0
PC_RETURN_POINTS_CAP = 40.0
PC_CONSISTENCY_BONUS = 10.0

# ---------------------------------------------------------------------------
# Volume / Delivery Score constants
# ---------------------------------------------------------------------------
VD_VOLUME_RATIO_MULTIPLIER = 30.0
VD_VOLUME_RATIO_MIN_POINTS = -20.0
VD_VOLUME_RATIO_MAX_POINTS = 25.0
VD_DELIVERY_RATIO_MULTIPLIER = 30.0
VD_DELIVERY_RATIO_MIN_POINTS = -20.0
VD_DELIVERY_RATIO_MAX_POINTS = 25.0

# ---------------------------------------------------------------------------
# Historical Success Score constants
# ---------------------------------------------------------------------------
HS_WIN_RATE_MULTIPLIER = 0.6
HS_WIN_RATE_CAP = 30.0
HS_AVG_RETURN_MULTIPLIER = 2.0
HS_AVG_RETURN_CAP = 20.0
HS_PRIMARY_WINDOW = 20  # trading days used for the headline historical stat

# ---------------------------------------------------------------------------
# Confidence rubric
# ---------------------------------------------------------------------------
# Each condition below contributes points; total points map to a confidence
# tier. This rubric is intentionally simple and fully documented so a user
# can see exactly why a score is HIGH/MEDIUM/LOW confidence.
CONFIDENCE_HIGH_THRESHOLD = 5
CONFIDENCE_MEDIUM_THRESHOLD = 3


def score_bounds(value: float) -> float:
    """Clips any raw score to the valid [0, 100] range."""
    return max(0.0, min(100.0, value))
