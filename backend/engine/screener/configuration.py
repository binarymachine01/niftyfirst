"""
Centralized configuration for the Smart Stock Screener.
Mirrors the pattern in backend/engine/conviction/configuration.py - every
threshold/default lives here, not scattered through filters.py/ranking.py.
"""

try:
    from backend.engine.conviction import configuration as conviction_cfg
except ImportError:
    from ..conviction import configuration as conviction_cfg

# ---------------------------------------------------------------------------
# Universe scoping
# ---------------------------------------------------------------------------
# The screener only ever considers symbols with at least one qualifying
# BUY/SELL deal within this window (same scoping principle the Conviction
# Engine's own ranking endpoint already uses) - this is an insider-driven
# screener with technical/price confirmation, not a blind full-NSE
# technical scanner over the ~4,000 listed symbols. Documented as a
# deliberate Phase 2 scope decision (see docs/SMART_SCREENER_METHODOLOGY.md).
DEFAULT_INSIDER_LOOKBACK_DAYS = 30
LOOKBACK_OPTIONS_DAYS = (7, 14, 30, 60, 90, 180)

# Widest window ever needed to load deals for: must cover both the user's
# chosen insider lookback AND the Conviction Engine's own historical window,
# so one batch query can satisfy everything downstream.
def universe_lookback_days(user_lookback_days: int) -> int:
    return max(user_lookback_days, conviction_cfg.HISTORICAL_LOOKBACK_DAYS)


# Calendar-day buffer for price history: 200-day DMA + 252-trading-day
# 52-week window need roughly 252 trading days of history, which spans
# about 370 calendar days including weekends/holidays. Rounded up for margin.
PRICE_HISTORY_CALENDAR_DAYS = 400

# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------
DEFAULT_PAGE_SIZE = 25
MAX_PAGE_SIZE = 100

# ---------------------------------------------------------------------------
# Sortable fields (also the whitelist used to validate the "sort.field" request)
# ---------------------------------------------------------------------------
SORT_FIELDS = (
    "conviction_score",
    "insider_value",
    "insider_count",
    "return_1d",
    "return_5d",
    "return_20d",
    "return_3m",
    "return_6m",
    "week_52_position",
    "rsi",
    "volume_ratio",
    "delivery_pct",
    "delivery_increase",
    "historical_win_rate",
    "signal_strength_rank",
)
DEFAULT_SORT_FIELD = "conviction_score"

# ---------------------------------------------------------------------------
# Signal Strength thresholds - transparent, rule-based, built entirely from
# the Conviction Score (Phase 1, reused as-is) plus measurable technical/
# volume/delivery evidence computed in this package. Not a new hidden score.
# ---------------------------------------------------------------------------
SIGNAL_EVIDENCE_VOLUME_RATIO_MIN = 1.5
SIGNAL_EVIDENCE_DELIVERY_MIN_PCT = 50.0
SIGNAL_EVIDENCE_ACCUMULATION_MIN_SCORE = 60.0
SIGNAL_EVIDENCE_PRICE_CONFIRMATION_MIN_SCORE = 60.0

SIGNAL_VERY_STRONG_CONVICTION_MIN = 80.0
SIGNAL_VERY_STRONG_EVIDENCE_MIN = 4
SIGNAL_STRONG_CONVICTION_MIN = 65.0
SIGNAL_STRONG_EVIDENCE_MIN = 3
SIGNAL_MODERATE_CONVICTION_MIN = 50.0
SIGNAL_MODERATE_EVIDENCE_MIN = 2

SIGNAL_STRENGTH_RANK = {"WEAK": 0, "MODERATE": 1, "STRONG": 2, "VERY STRONG": 3}

# Historical Win Rate is reused directly from the Conviction Engine's
# Historical Success component - MIN_HISTORICAL_SAMPLE_SIZE there already
# governs when a win rate is shown vs "insufficient history".
