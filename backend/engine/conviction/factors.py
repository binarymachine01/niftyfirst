"""
The six transparent sub-score calculators for the Insider Conviction Engine.

Every calculator returns a dict of the same shape:
{
    "available": bool,
    "score": float | None,          # 0-100, None if unavailable
    "contributions": [              # every contribution shown to the user
        {"label": str, "points": float, "detail": str}, ...
    ],
    "metrics": {...},                # raw numbers backing the contributions
    "unavailable_reason": str | None,
}

Each contribution is a literal term in the score formula - there is no
separate "explain the number" step; explanations.py simply renders these
contributions as bullet points, so the explanation can never drift from
the actual calculation.
"""

import math
from datetime import date, timedelta
from typing import List, Dict, Any, Optional

from . import configuration as cfg


def recency_weight(deal_date: date, as_of_date: date, half_life_days: float = cfg.RECENCY_HALF_LIFE_DAYS) -> float:
    """Exponential decay: weight = 0.5 ** (days_ago / half_life). Never zero, never discards data."""
    days_ago = max((as_of_date - deal_date).days, 0)
    return 0.5 ** (days_ago / half_life_days)


def _interp_log_scale(value: float, reference: tuple) -> float:
    """Piecewise-linear interpolation in log10 space over (value, points) reference points."""
    if value <= reference[0][0]:
        return reference[0][1]
    if value >= reference[-1][0]:
        return reference[-1][1]
    for (x0, y0), (x1, y1) in zip(reference, reference[1:]):
        if x0 <= value <= x1:
            if x0 <= 0:
                return y0 + (y1 - y0) * ((value - x0) / (x1 - x0))
            log_x0, log_x1, log_v = math.log10(x0), math.log10(x1), math.log10(value)
            frac = (log_v - log_x0) / (log_x1 - log_x0) if log_x1 != log_x0 else 0.0
            return y0 + (y1 - y0) * frac
    return reference[-1][1]


def _clip(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def format_inr(value: float) -> str:
    """Formats a rupee amount using Cr/L notation, matching the frontend's convention."""
    sign = "-" if value < 0 else ""
    abs_value = abs(value)
    if abs_value >= 1e7:
        return f"{sign}₹{abs_value / 1e7:.2f} Cr"
    if abs_value >= 1e5:
        return f"{sign}₹{abs_value / 1e5:.2f} L"
    return f"{sign}₹{abs_value:,.0f}"


# ---------------------------------------------------------------------------
# A. Insider Activity Score
# ---------------------------------------------------------------------------
def compute_insider_activity(deals: List[Dict[str, Any]], as_of_date: date) -> Dict[str, Any]:
    if not deals:
        return {
            "available": False, "score": None, "contributions": [], "metrics": {},
            "unavailable_reason": "No BUY/SELL insider or deal activity found in the lookback window.",
        }

    buys = [d for d in deals if d["action"] == "BUY"]
    sells = [d for d in deals if d["action"] == "SELL"]

    w_buy = sum(recency_weight(d["trade_date"], as_of_date) for d in buys)
    w_sell = sum(recency_weight(d["trade_date"], as_of_date) for d in sells)
    net_ratio = (w_buy - w_sell) / (w_buy + w_sell) if (w_buy + w_sell) > 0 else 0.0

    unique_buyers = {d["client_name"] for d in buys if d.get("client_name")}
    unique_sellers = {d["client_name"] for d in sells if d.get("client_name")}

    roles_bought = {d["role"] for d in buys}
    if "Promoter" in roles_bought:
        role_bonus, role_label = cfg.IA_ROLE_BONUS["Promoter"], "Promoter"
    elif "Director" in roles_bought:
        role_bonus, role_label = cfg.IA_ROLE_BONUS["Director"], "Director"
    elif "KMP" in roles_bought:
        role_bonus, role_label = cfg.IA_ROLE_BONUS["KMP"], "KMP"
    else:
        role_bonus, role_label = 0.0, None

    contributions = []

    net_points = net_ratio * cfg.IA_NET_RATIO_MAX_POINTS
    contributions.append({
        "label": "Net insider buy/sell balance",
        "points": round(net_points, 2),
        "detail": f"{len(buys)} buy vs {len(sells)} sell transaction(s), recency-weighted",
    })

    if unique_buyers:
        pts = min(len(unique_buyers), cfg.IA_UNIQUE_BUYER_MAX_COUNT) * cfg.IA_UNIQUE_BUYER_POINTS_PER
        contributions.append({
            "label": "Unique insiders buying",
            "points": round(pts, 2),
            "detail": f"{len(unique_buyers)} distinct insider(s)/entities purchased shares",
        })

    if unique_sellers:
        pts = -min(len(unique_sellers), cfg.IA_UNIQUE_SELLER_MAX_COUNT) * cfg.IA_UNIQUE_SELLER_POINTS_PER
        contributions.append({
            "label": "Unique insiders selling",
            "points": round(pts, 2),
            "detail": f"{len(unique_sellers)} distinct insider(s)/entities sold shares",
        })

    if role_label:
        contributions.append({
            "label": "Highest-conviction role participation",
            "points": round(role_bonus, 2),
            "detail": f"{role_label} participated in buying",
        })

    txn_bonus = min(len(deals), cfg.IA_TXN_COUNT_BONUS_MAX_COUNT) * cfg.IA_TXN_COUNT_BONUS_PER
    contributions.append({
        "label": "Transaction count evidence",
        "points": round(txn_bonus, 2),
        "detail": f"{len(deals)} total qualifying transaction(s) in window",
    })

    # The net-ratio term above is scale-invariant to recency for
    # one-directional activity (e.g. all buys), since it normalizes weight
    # by total weight. This term explicitly rewards freshness so recent
    # buying (or selling) scores differently from old buying (or selling),
    # per the spec's recency-weighting requirement.
    if buys:
        avg_buy_recency = w_buy / len(buys)
        contributions.append({
            "label": "Recency of buying activity",
            "points": round(avg_buy_recency * cfg.IA_RECENCY_BONUS_MAX_POINTS, 2),
            "detail": f"Average recency weight {avg_buy_recency:.2f} (1.0 = today, {cfg.RECENCY_HALF_LIFE_DAYS:.0f}-day half-life decay)",
        })
    if sells:
        avg_sell_recency = w_sell / len(sells)
        contributions.append({
            "label": "Recency of selling activity",
            "points": round(-avg_sell_recency * cfg.IA_RECENCY_BONUS_MAX_POINTS, 2),
            "detail": f"Average recency weight {avg_sell_recency:.2f} (1.0 = today, {cfg.RECENCY_HALF_LIFE_DAYS:.0f}-day half-life decay)",
        })

    score = cfg.score_bounds(50.0 + sum(c["points"] for c in contributions))

    return {
        "available": True,
        "score": round(score, 2),
        "contributions": contributions,
        "metrics": {
            "buy_count": len(buys), "sell_count": len(sells),
            "unique_buyers": len(unique_buyers), "unique_sellers": len(unique_sellers),
            "net_ratio": round(net_ratio, 4), "top_role": role_label,
        },
        "unavailable_reason": None,
    }


# ---------------------------------------------------------------------------
# B. Transaction Strength Score
# ---------------------------------------------------------------------------
def compute_transaction_strength(deals: List[Dict[str, Any]], market_cap: Optional[float] = None) -> Dict[str, Any]:
    valued = [d for d in deals if d.get("total_value") is not None]
    if not valued:
        return {
            "available": False, "score": None, "contributions": [], "metrics": {},
            "unavailable_reason": "No transactions with a known rupee value in the lookback window.",
        }

    buy_value = sum(float(d["total_value"]) for d in valued if d["action"] == "BUY")
    sell_value = sum(float(d["total_value"]) for d in valued if d["action"] == "SELL")
    net_value = buy_value - sell_value
    buy_valued = [d for d in valued if d["action"] == "BUY"]
    largest_buy = max((float(d["total_value"]) for d in buy_valued), default=0.0)

    contributions = []

    net_pts = math.copysign(_interp_log_scale(abs(net_value), cfg.TS_VALUE_SCALE_REFERENCE), net_value) if net_value != 0 else 0.0
    net_pts = _clip(net_pts, -cfg.TS_NET_VALUE_MAX_POINTS, cfg.TS_NET_VALUE_MAX_POINTS)
    contributions.append({
        "label": "Net insider transaction value",
        "points": round(net_pts, 2),
        "detail": f"{format_inr(net_value)} net insider {'buying' if net_value >= 0 else 'selling'} (buy {format_inr(buy_value)} vs sell {format_inr(sell_value)})",
    })

    if largest_buy > 0:
        largest_pts = _clip(_interp_log_scale(largest_buy, cfg.TS_VALUE_SCALE_REFERENCE) * (cfg.TS_LARGEST_BUY_MAX_POINTS / 100.0), 0, cfg.TS_LARGEST_BUY_MAX_POINTS)
        contributions.append({
            "label": "Largest single buy transaction",
            "points": round(largest_pts, 2),
            "detail": f"Largest single purchase {format_inr(largest_buy)}",
        })

    if market_cap and market_cap > 0:
        ratio_pct = (largest_buy / market_cap) * 100.0
        raw_mcap_score = _interp_log_scale(ratio_pct, cfg.TS_MCAP_RATIO_REFERENCE) if ratio_pct > 0 else 0.0
        mcap_pts = _clip(raw_mcap_score * (cfg.TS_MCAP_MAX_POINTS / 100.0), 0, cfg.TS_MCAP_MAX_POINTS)
        contributions.append({
            "label": "Transaction value vs market capitalization",
            "points": round(mcap_pts, 2),
            "detail": f"Largest transaction is {ratio_pct:.3f}% of market cap",
        })
        mcap_available = True
    else:
        mcap_available = False

    txn_pts = min(len(valued), cfg.TS_TXN_COUNT_MAX_COUNT) * cfg.TS_TXN_COUNT_POINTS_PER
    contributions.append({
        "label": "Multiple transaction evidence",
        "points": round(txn_pts, 2),
        "detail": f"{len(valued)} valued transaction(s)",
    })

    score = cfg.score_bounds(50.0 + sum(c["points"] for c in contributions))

    return {
        "available": True,
        "score": round(score, 2),
        "contributions": contributions,
        "metrics": {
            "buy_value": buy_value, "sell_value": sell_value, "net_value": net_value,
            "largest_buy": largest_buy, "valued_txn_count": len(valued),
            "market_cap_available": mcap_available,
        },
        "unavailable_reason": None,
    }


# ---------------------------------------------------------------------------
# C. Accumulation Score
# ---------------------------------------------------------------------------
def compute_accumulation(deals: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not deals:
        return {
            "available": False, "score": None, "contributions": [], "metrics": {},
            "unavailable_reason": "No BUY/SELL activity found in the lookback window.",
        }

    buys = [d for d in deals if d["action"] == "BUY"]
    sells = [d for d in deals if d["action"] == "SELL"]

    distinct_buy_dates = {d["trade_date"] for d in buys}
    distinct_buy_clients = {d["client_name"] for d in buys if d.get("client_name")}

    buyer_counts: Dict[str, int] = {}
    for d in buys:
        if d.get("client_name"):
            buyer_counts[d["client_name"]] = buyer_counts.get(d["client_name"], 0) + 1
    repeat_buyers = {c: n for c, n in buyer_counts.items() if n > 1}

    contributions = []

    if distinct_buy_dates:
        pts = min(len(distinct_buy_dates), cfg.ACC_BUY_DATES_MAX_COUNT) * cfg.ACC_BUY_DATES_POINTS_PER
        contributions.append({
            "label": "Multiple buying dates",
            "points": round(pts, 2),
            "detail": f"Buying occurred across {len(distinct_buy_dates)} distinct date(s)",
        })

    if distinct_buy_clients:
        pts = min(len(distinct_buy_clients), cfg.ACC_UNIQUE_BUYERS_MAX_COUNT) * cfg.ACC_UNIQUE_BUYERS_POINTS_PER
        contributions.append({
            "label": "Multiple unique insiders buying",
            "points": round(pts, 2),
            "detail": f"{len(distinct_buy_clients)} distinct insider(s)/entities bought",
        })

    if repeat_buyers:
        pts = min(len(repeat_buyers), cfg.ACC_REPEAT_BUYER_MAX_COUNT) * cfg.ACC_REPEAT_BUYER_POINTS_PER
        contributions.append({
            "label": "Repeat purchases by the same insider",
            "points": round(pts, 2),
            "detail": f"{len(repeat_buyers)} insider(s) purchased more than once",
        })

    if len(sells) > len(buys):
        excess_sells = len(sells) - len(buys)
        pts = -min(excess_sells, cfg.ACC_SELL_PENALTY_MAX_COUNT) * cfg.ACC_SELL_PENALTY_POINTS_PER
        contributions.append({
            "label": "Selling offsetting accumulation",
            "points": round(pts, 2),
            "detail": f"{len(sells)} sell transaction(s) vs {len(buys)} buy transaction(s)",
        })

    score = cfg.score_bounds(sum(c["points"] for c in contributions))

    return {
        "available": True,
        "score": round(score, 2),
        "contributions": contributions,
        "metrics": {
            "distinct_buy_dates": len(distinct_buy_dates),
            "distinct_buy_clients": len(distinct_buy_clients),
            "repeat_buyers": len(repeat_buyers),
            "buy_count": len(buys), "sell_count": len(sells),
        },
        "unavailable_reason": None,
    }


# ---------------------------------------------------------------------------
# D. Price Confirmation Score (CURRENT conviction - look-ahead-safe)
# ---------------------------------------------------------------------------
def compute_price_confirmation(
    buy_deals: List[Dict[str, Any]],
    candles: List[Dict[str, Any]],
    as_of_date: date,
) -> Dict[str, Any]:
    """
    Evaluates how price has moved since recent BUY deals, using ONLY
    windows that have already elapsed as of as_of_date (a deal from 2 days
    ago contributes zero windows, never an estimated one - this is the
    look-ahead-bias guard for the CURRENT conviction score).
    """
    if not buy_deals or not candles:
        return {
            "available": False, "score": None, "contributions": [], "metrics": {},
            "unavailable_reason": "No BUY transactions or no price history available for this symbol.",
        }

    sorted_candles = sorted(candles, key=lambda c: c["trade_date"])
    per_deal_returns: List[Dict[str, Any]] = []

    for d in buy_deals:
        deal_date = d["trade_date"]
        future = [c for c in sorted_candles if c["trade_date"] >= deal_date]
        if not future:
            continue
        entry_price = future[0]["open"] if future[0]["open"] > 0 else future[0]["close"]
        if entry_price <= 0:
            continue
        after_entry = future[1:]

        elapsed_returns = {}
        for w in cfg.PRICE_CONFIRMATION_WINDOWS:
            if len(after_entry) >= w:
                exit_price = after_entry[w - 1]["close"]
                if exit_price > 0:
                    elapsed_returns[w] = ((exit_price - entry_price) / entry_price) * 100.0

        if elapsed_returns:
            weight = recency_weight(deal_date, as_of_date)
            per_deal_returns.append({"deal_date": deal_date, "returns": elapsed_returns, "weight": weight})

    if not per_deal_returns:
        return {
            "available": False, "score": None, "contributions": [], "metrics": {},
            "unavailable_reason": "Recent BUY transactions are too new for any confirmation window to have elapsed yet.",
        }

    total_weight = sum(pd["weight"] for pd in per_deal_returns)
    avg_return_by_window: Dict[int, float] = {}
    for w in cfg.PRICE_CONFIRMATION_WINDOWS:
        vals = [(pd["returns"][w], pd["weight"]) for pd in per_deal_returns if w in pd["returns"]]
        if vals:
            avg_return_by_window[w] = sum(v * wt for v, wt in vals) / sum(wt for _, wt in vals)

    per_deal_avg_return = [
        (sum(pd["returns"].values()) / len(pd["returns"]), pd["weight"])
        for pd in per_deal_returns
    ]
    overall_avg = sum(avg * wt for avg, wt in per_deal_avg_return) / total_weight

    contributions = []
    move_pts = _clip(overall_avg * cfg.PC_RETURN_POINTS_MULTIPLIER, -cfg.PC_RETURN_POINTS_CAP, cfg.PC_RETURN_POINTS_CAP)
    contributions.append({
        "label": "Price move since insider buying",
        "points": round(move_pts, 2),
        "detail": f"Average {overall_avg:+.2f}% across {len(per_deal_returns)} elapsed-window buy event(s)",
    })

    window_values = list(avg_return_by_window.values())
    if len(window_values) >= 2:
        if all(v > 0 for v in window_values):
            contributions.append({"label": "Consistent positive confirmation", "points": cfg.PC_CONSISTENCY_BONUS,
                                   "detail": "Price gained across every elapsed window"})
        elif all(v < 0 for v in window_values):
            contributions.append({"label": "Consistent negative confirmation", "points": -cfg.PC_CONSISTENCY_BONUS,
                                   "detail": "Price declined across every elapsed window"})

    score = cfg.score_bounds(50.0 + sum(c["points"] for c in contributions))

    return {
        "available": True,
        "score": round(score, 2),
        "contributions": contributions,
        "metrics": {
            "avg_return_by_window": {str(k): round(v, 2) for k, v in avg_return_by_window.items()},
            "events_used": len(per_deal_returns),
        },
        "unavailable_reason": None,
    }


# ---------------------------------------------------------------------------
# E. Volume / Delivery Score
# ---------------------------------------------------------------------------
def compute_volume_delivery(buy_deals: List[Dict[str, Any]], candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not buy_deals or not candles:
        return {
            "available": False, "score": None, "contributions": [], "metrics": {},
            "unavailable_reason": "No BUY transactions or no price/volume history available for this symbol.",
        }

    sorted_candles = sorted(candles, key=lambda c: c["trade_date"])
    volume_ratios, delivery_ratios = [], []

    for d in buy_deals:
        deal_date = d["trade_date"]
        baseline_start = deal_date - timedelta(days=cfg.VOLUME_BASELINE_LOOKBACK_DAYS + cfg.VOLUME_BASELINE_GAP_DAYS)
        baseline_end = deal_date - timedelta(days=cfg.VOLUME_BASELINE_GAP_DAYS)
        post_end = deal_date + timedelta(days=cfg.VOLUME_POST_DEAL_WINDOW_DAYS * 2)

        baseline = [c for c in sorted_candles if baseline_start <= c["trade_date"] < baseline_end]
        post = [c for c in sorted_candles if deal_date <= c["trade_date"] <= post_end][:cfg.VOLUME_POST_DEAL_WINDOW_DAYS]

        if len(baseline) < cfg.MIN_BASELINE_CANDLES or not post:
            continue

        base_vols = [c["volume"] for c in baseline if c["volume"] is not None]
        post_vols = [c["volume"] for c in post if c["volume"] is not None]
        if base_vols and post_vols and sum(base_vols) > 0:
            avg_base_vol = sum(base_vols) / len(base_vols)
            avg_post_vol = sum(post_vols) / len(post_vols)
            if avg_base_vol > 0:
                volume_ratios.append(avg_post_vol / avg_base_vol)

        base_del = [c["delivery_pct"] for c in baseline if c["delivery_pct"] is not None]
        post_del = [c["delivery_pct"] for c in post if c["delivery_pct"] is not None]
        if base_del and post_del:
            avg_base_del = sum(base_del) / len(base_del)
            avg_post_del = sum(post_del) / len(post_del)
            if avg_base_del > 0:
                delivery_ratios.append(avg_post_del / avg_base_del)

    if not volume_ratios and not delivery_ratios:
        return {
            "available": False, "score": None, "contributions": [], "metrics": {},
            "unavailable_reason": "Insufficient trailing price history to establish a volume/delivery baseline.",
        }

    contributions = []
    if volume_ratios:
        avg_vol_ratio = sum(volume_ratios) / len(volume_ratios)
        pts = _clip((avg_vol_ratio - 1.0) * cfg.VD_VOLUME_RATIO_MULTIPLIER, cfg.VD_VOLUME_RATIO_MIN_POINTS, cfg.VD_VOLUME_RATIO_MAX_POINTS)
        contributions.append({
            "label": "Volume vs trailing average",
            "points": round(pts, 2),
            "detail": f"Volume was {avg_vol_ratio:.2f}× the pre-deal baseline average",
        })
    else:
        contributions.append({"label": "Volume data unavailable", "points": 0.0, "detail": "Insufficient volume history around deal date(s)"})

    if delivery_ratios:
        avg_del_ratio = sum(delivery_ratios) / len(delivery_ratios)
        pts = _clip((avg_del_ratio - 1.0) * cfg.VD_DELIVERY_RATIO_MULTIPLIER, cfg.VD_DELIVERY_RATIO_MIN_POINTS, cfg.VD_DELIVERY_RATIO_MAX_POINTS)
        contributions.append({
            "label": "Delivery percentage vs trailing average",
            "points": round(pts, 2),
            "detail": f"Delivery % was {avg_del_ratio:.2f}× the pre-deal baseline average",
        })
    else:
        contributions.append({"label": "Delivery data unavailable", "points": 0.0, "detail": "No delivery percentage data around deal date(s)"})

    score = cfg.score_bounds(50.0 + sum(c["points"] for c in contributions))

    return {
        "available": True,
        "score": round(score, 2),
        "contributions": contributions,
        "metrics": {
            "volume_ratio_sample": len(volume_ratios),
            "delivery_ratio_sample": len(delivery_ratios),
        },
        "unavailable_reason": None,
    }


# ---------------------------------------------------------------------------
# F. Historical Success Score (past track record - separate from CURRENT conviction)
# ---------------------------------------------------------------------------
def compute_historical_success(
    past_buy_deals: List[Dict[str, Any]],
    candles: List[Dict[str, Any]],
    as_of_date: date,
) -> Dict[str, Any]:
    """
    Evaluates prior BUY events for this stock (any BUY deal, not limited to
    the current lookback window) and their realized forward returns. Only
    windows that have already elapsed as of as_of_date are counted, so this
    can never leak future information. If fewer than
    MIN_HISTORICAL_SAMPLE_SIZE qualifying past events exist, the component
    is explicitly marked unavailable rather than scored.
    """
    if not past_buy_deals or not candles:
        return {
            "available": False, "score": None, "contributions": [], "metrics": {},
            "unavailable_reason": "insufficient data",
        }

    # Defense-in-depth: never evaluate a deal dated after the as-of boundary,
    # even if a caller passed in an improperly-bounded candle/deal list.
    past_buy_deals = [d for d in past_buy_deals if d["trade_date"] <= as_of_date]
    sorted_candles = sorted((c for c in candles if c["trade_date"] <= as_of_date), key=lambda c: c["trade_date"])
    events = []

    for d in past_buy_deals:
        deal_date = d["trade_date"]
        future = [c for c in sorted_candles if c["trade_date"] >= deal_date]
        if not future:
            continue
        entry_price = future[0]["open"] if future[0]["open"] > 0 else future[0]["close"]
        if entry_price <= 0:
            continue
        after_entry = future[1:]

        window_returns = {}
        for w in cfg.HISTORICAL_SUCCESS_WINDOWS:
            if len(after_entry) >= w:
                exit_price = after_entry[w - 1]["close"]
                if exit_price > 0:
                    window_returns[w] = ((exit_price - entry_price) / entry_price) * 100.0

        if cfg.HS_PRIMARY_WINDOW in window_returns:
            events.append(window_returns)

    if len(events) < cfg.MIN_HISTORICAL_SAMPLE_SIZE:
        return {
            "available": False, "score": None, "contributions": [], "metrics": {"sample_size": len(events)},
            "unavailable_reason": "insufficient data",
        }

    primary_returns = [e[cfg.HS_PRIMARY_WINDOW] for e in events]
    positive_count = sum(1 for r in primary_returns if r > 0)
    pct_positive = (positive_count / len(primary_returns)) * 100.0
    avg_return = sum(primary_returns) / len(primary_returns)
    sorted_returns = sorted(primary_returns)
    mid = len(sorted_returns) // 2
    median_return = sorted_returns[mid] if len(sorted_returns) % 2 else (sorted_returns[mid - 1] + sorted_returns[mid]) / 2.0

    contributions = [
        {
            "label": f"Historical win rate ({cfg.HS_PRIMARY_WINDOW}D)",
            "points": round(_clip((pct_positive - 50.0) * cfg.HS_WIN_RATE_MULTIPLIER, -cfg.HS_WIN_RATE_CAP, cfg.HS_WIN_RATE_CAP), 2),
            "detail": f"{positive_count}/{len(primary_returns)} past buy events ({pct_positive:.0f}%) were positive after {cfg.HS_PRIMARY_WINDOW} trading days",
        },
        {
            "label": f"Historical average return ({cfg.HS_PRIMARY_WINDOW}D)",
            "points": round(_clip(avg_return * cfg.HS_AVG_RETURN_MULTIPLIER, -cfg.HS_AVG_RETURN_CAP, cfg.HS_AVG_RETURN_CAP), 2),
            "detail": f"Average return {avg_return:+.2f}% (median {median_return:+.2f}%)",
        },
    ]

    score = cfg.score_bounds(50.0 + sum(c["points"] for c in contributions))

    return {
        "available": True,
        "score": round(score, 2),
        "contributions": contributions,
        "metrics": {
            "sample_size": len(events), "pct_positive": round(pct_positive, 2),
            "avg_return": round(avg_return, 2), "median_return": round(median_return, 2),
        },
        "unavailable_reason": None,
    }
