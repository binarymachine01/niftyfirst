"""
Technical Analysis Engine.

Pure functions computing price returns, moving averages, RSI, volume ratio,
52-week position, breakout, and delivery statistics from an already-loaded
list of daily candles. No database access happens here - callers (e.g.
backend/engine/screener) load candles once via
backend/engine/conviction/market_data.py:load_price_window and pass them in,
so this module never issues its own queries or duplicates a price fetch.

Every candle list a caller passes in is expected to already be bounded to
trade_date <= as_of_date (the same look-ahead boundary the Conviction
Engine enforces at its data-loading layer) - these functions only ever read
what they're given, so that boundary is inherited automatically.
"""

from typing import List, Dict, Any, Optional

# Trading-day window definitions. NSE has ~21 trading days/month, so 3M/6M
# are expressed in trading days for consistency with every other window in
# this codebase (the Conviction Engine's PRICE_CONFIRMATION_WINDOWS etc.
# are also trading-day counts, not calendar days).
RETURN_WINDOWS_TRADING_DAYS = {
    "1d": 1,
    "5d": 5,
    "20d": 20,
    "3m": 63,
    "6m": 126,
}

DMA_WINDOWS = (20, 50, 200)
RSI_PERIOD = 14
VOLUME_RATIO_RECENT_DAYS = 5
VOLUME_RATIO_BASELINE_DAYS = 20
DELIVERY_BASELINE_DAYS = 20
WEEK_52_TRADING_DAYS = 252
BREAKOUT_LOOKBACK_DAYS = 20


def _sorted(candles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(candles, key=lambda c: c["trade_date"])


def compute_returns(candles: List[Dict[str, Any]]) -> Dict[str, Optional[float]]:
    """
    Percent price return over each window, measured from the close N
    trading days before the latest candle to the latest close. A window
    returns None (not 0) if there isn't enough history to measure it.
    """
    s = _sorted(candles)
    if not s:
        return {k: None for k in RETURN_WINDOWS_TRADING_DAYS}

    latest_close = s[-1]["close"]
    result = {}
    for label, window in RETURN_WINDOWS_TRADING_DAYS.items():
        if len(s) > window and s[-1 - window]["close"] > 0:
            base_close = s[-1 - window]["close"]
            result[label] = round(((latest_close - base_close) / base_close) * 100.0, 2)
        else:
            result[label] = None
    return result


def compute_dma(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Simple moving average of close price over each window in DMA_WINDOWS,
    plus whether the latest close is above it. None (not False) if there
    isn't enough history for that window.
    """
    s = _sorted(candles)
    result = {}
    latest_close = s[-1]["close"] if s else None

    for window in DMA_WINDOWS:
        key = f"dma_{window}"
        if len(s) >= window and latest_close is not None:
            avg = sum(c["close"] for c in s[-window:]) / window
            result[key] = round(avg, 2)
            result[f"above_{key}"] = latest_close > avg
        else:
            result[key] = None
            result[f"above_{key}"] = None
    return result


def compute_rsi(candles: List[Dict[str, Any]], period: int = RSI_PERIOD) -> Optional[float]:
    """
    Standard simple-average RSI (not Wilder-smoothed, to keep the
    methodology transparent and easy to verify by hand):
        RS = (average gain over `period` days) / (average loss over `period` days)
        RSI = 100 - (100 / (1 + RS))
    Requires at least `period` + 1 candles (period day-over-day changes).
    Returns None if there isn't enough history.
    """
    s = _sorted(candles)
    if len(s) < period + 1:
        return None

    changes = [s[i]["close"] - s[i - 1]["close"] for i in range(len(s) - period, len(s))]
    gains = [c for c in changes if c > 0]
    losses = [-c for c in changes if c < 0]

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0

    rs = avg_gain / avg_loss
    return round(100.0 - (100.0 / (1.0 + rs)), 2)


def compute_volume_ratio(
    candles: List[Dict[str, Any]],
    recent_days: int = VOLUME_RATIO_RECENT_DAYS,
    baseline_days: int = VOLUME_RATIO_BASELINE_DAYS,
) -> Optional[float]:
    """
    (average volume over the most recent `recent_days`) / (average volume
    over the `baseline_days` immediately preceding that window). Non-
    overlapping windows, same style as the Conviction Engine's Volume/
    Delivery factor. None if either window lacks volume data.
    """
    s = _sorted(candles)
    if len(s) < recent_days + baseline_days:
        return None

    recent = s[-recent_days:]
    baseline = s[-(recent_days + baseline_days):-recent_days]

    recent_vols = [c["volume"] for c in recent if c.get("volume") is not None]
    baseline_vols = [c["volume"] for c in baseline if c.get("volume") is not None]
    if not recent_vols or not baseline_vols:
        return None

    avg_baseline = sum(baseline_vols) / len(baseline_vols)
    if avg_baseline <= 0:
        return None

    avg_recent = sum(recent_vols) / len(recent_vols)
    return round(avg_recent / avg_baseline, 2)


def compute_52w_position(candles: List[Dict[str, Any]], window: int = WEEK_52_TRADING_DAYS) -> Optional[float]:
    """
    Where the latest close sits within its trailing 52-week (252 trading
    day) high/low range, as a percentage:
        (close - 52w_low) / (52w_high - 52w_low) * 100
    100% = at the 52-week high, 0% = at the 52-week low. None if fewer than
    `window` candles are available (uses whatever history exists up to that
    cap, but requires at least 20 candles to be meaningful).
    """
    s = _sorted(candles)
    if len(s) < 20:
        return None

    window_candles = s[-window:]
    highs = [c["high"] for c in window_candles]
    lows = [c["low"] for c in window_candles]
    week_52_high, week_52_low = max(highs), min(lows)
    latest_close = s[-1]["close"]

    if week_52_high == week_52_low:
        return 100.0
    return round(((latest_close - week_52_low) / (week_52_high - week_52_low)) * 100.0, 2)


def compute_breakout(candles: List[Dict[str, Any]], lookback: int = BREAKOUT_LOOKBACK_DAYS) -> Dict[str, Any]:
    """
    Explicit breakout definition: the latest close is a new high relative
    to the highest CLOSE of the preceding `lookback` trading days
    (excluding today). Returns the prior high for transparency. None/False
    if there isn't enough history.
    """
    s = _sorted(candles)
    if len(s) < lookback + 1:
        return {"is_breakout": None, "lookback_days": lookback, "prior_high": None}

    prior_window = s[-(lookback + 1):-1]
    prior_high = max(c["close"] for c in prior_window)
    latest_close = s[-1]["close"]
    return {
        "is_breakout": latest_close > prior_high,
        "lookback_days": lookback,
        "prior_high": round(prior_high, 2),
    }


def compute_delivery_stats(candles: List[Dict[str, Any]], baseline_days: int = DELIVERY_BASELINE_DAYS) -> Dict[str, Any]:
    """
    Current delivery % (latest candle with non-null delivery_pct) vs the
    trailing `baseline_days` average (the baseline_days immediately
    preceding the current day, non-overlapping). delivery_increase is the
    absolute percentage-point difference (current - baseline), not a
    ratio. None fields (not 0) when delivery data is missing.
    """
    s = _sorted(candles)
    with_delivery = [c for c in s if c.get("delivery_pct") is not None]
    if not with_delivery:
        return {"current_delivery_pct": None, "avg_delivery_pct": None, "delivery_increase": None}

    current_delivery_pct = with_delivery[-1]["delivery_pct"]

    latest_date = with_delivery[-1]["trade_date"]
    baseline_candidates = [c for c in with_delivery if c["trade_date"] < latest_date][-baseline_days:]
    if not baseline_candidates:
        return {"current_delivery_pct": round(current_delivery_pct, 2), "avg_delivery_pct": None, "delivery_increase": None}

    avg_delivery_pct = sum(c["delivery_pct"] for c in baseline_candidates) / len(baseline_candidates)
    return {
        "current_delivery_pct": round(current_delivery_pct, 2),
        "avg_delivery_pct": round(avg_delivery_pct, 2),
        "delivery_increase": round(current_delivery_pct - avg_delivery_pct, 2),
    }


def compute_all(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Convenience aggregator: computes every metric above in one call over one candle list."""
    s = _sorted(candles)
    return {
        "returns": compute_returns(candles),
        "dma": compute_dma(candles),
        "rsi": compute_rsi(candles),
        "volume_ratio": compute_volume_ratio(candles),
        "week_52_position": compute_52w_position(candles),
        "breakout": compute_breakout(candles),
        "delivery": compute_delivery_stats(candles),
        "latest_close": s[-1]["close"] if s else None,
        "latest_trade_date": str(s[-1]["trade_date"]) if s else None,
    }
