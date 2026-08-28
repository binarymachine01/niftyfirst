"""
Signal Strength classification and result sorting for the Smart Screener.

Signal Strength is a transparent, rule-based classification built entirely
from the Conviction Score (Phase 1, reused as-is) plus measurable
technical/volume/delivery evidence already computed by
backend/engine/technical_analysis.py. It is NOT a second scoring system -
no new numeric score is invented here, only threshold classification over
existing numbers, with every contributing reason listed explicitly.
"""

from typing import Dict, Any, List, Tuple

from . import configuration as cfg


def _has_evidence(candidate: Dict[str, Any]) -> Tuple[int, List[str]]:
    """Counts how many independent, measurable confirmation signals are present, and names them."""
    reasons = []
    conviction = candidate["conviction"]
    technical = candidate["technical"]

    if conviction and conviction["components"]["accumulation"]["available"] and \
            conviction["components"]["accumulation"]["score"] >= cfg.SIGNAL_EVIDENCE_ACCUMULATION_MIN_SCORE:
        reasons.append("Strong insider accumulation")

    if conviction and conviction["components"]["price_confirmation"]["available"] and \
            conviction["components"]["price_confirmation"]["score"] >= cfg.SIGNAL_EVIDENCE_PRICE_CONFIRMATION_MIN_SCORE:
        reasons.append("Positive price confirmation")

    if technical["volume_ratio"] is not None and technical["volume_ratio"] >= cfg.SIGNAL_EVIDENCE_VOLUME_RATIO_MIN:
        reasons.append("Volume confirmation")

    delivery_pct = technical["delivery"]["current_delivery_pct"]
    delivery_increase = technical["delivery"]["delivery_increase"]
    if (delivery_pct is not None and delivery_pct >= cfg.SIGNAL_EVIDENCE_DELIVERY_MIN_PCT) or \
            (delivery_increase is not None and delivery_increase > 0):
        reasons.append("Delivery confirmation")

    if candidate["insider"]["promoter_buying"]:
        reasons.append("Promoter participation")

    if candidate["insider"]["repeat_buying"]:
        reasons.append("Repeat insider purchases")

    if technical["dma"]["above_dma_50"] is True:
        reasons.append("Price above 50-day moving average")

    return len(reasons), reasons


def classify_signal_strength(candidate: Dict[str, Any]) -> Dict[str, Any]:
    """
    Returns {"tier": str, "rank": int, "reasons": [...]}. Tier logic:
      VERY STRONG: conviction >= 80 AND >= 4 independent evidence signals
      STRONG:      conviction >= 65 AND >= 3 independent evidence signals
      MODERATE:    conviction >= 50 AND >= 2 independent evidence signals
      WEAK:        everything else (including conviction unavailable)
    """
    conviction = candidate["conviction"]
    score = conviction["overall_score"] if conviction else None
    evidence_count, reasons = _has_evidence(candidate)

    if score is not None and score >= cfg.SIGNAL_VERY_STRONG_CONVICTION_MIN and evidence_count >= cfg.SIGNAL_VERY_STRONG_EVIDENCE_MIN:
        tier = "VERY STRONG"
    elif score is not None and score >= cfg.SIGNAL_STRONG_CONVICTION_MIN and evidence_count >= cfg.SIGNAL_STRONG_EVIDENCE_MIN:
        tier = "STRONG"
    elif score is not None and score >= cfg.SIGNAL_MODERATE_CONVICTION_MIN and evidence_count >= cfg.SIGNAL_MODERATE_EVIDENCE_MIN:
        tier = "MODERATE"
    else:
        tier = "WEAK"

    return {"tier": tier, "rank": cfg.SIGNAL_STRENGTH_RANK[tier], "evidence_count": evidence_count, "reasons": reasons}


def historical_win_rate(candidate: Dict[str, Any]) -> Dict[str, Any]:
    """
    Reads the Historical Success component directly from the Conviction
    Engine result (Phase 1) - no separate win-rate calculation exists here.
    """
    conviction = candidate["conviction"]
    if not conviction:
        return {"available": False, "pct_positive": None, "sample_size": 0, "positive_count": 0}

    hs = conviction["components"]["historical_success"]
    if not hs["available"]:
        return {"available": False, "pct_positive": None, "sample_size": hs["metrics"].get("sample_size", 0), "positive_count": 0}

    sample_size = hs["metrics"]["sample_size"]
    pct_positive = hs["metrics"]["pct_positive"]
    positive_count = round(pct_positive / 100.0 * sample_size)
    return {"available": True, "pct_positive": pct_positive, "sample_size": sample_size, "positive_count": positive_count}


def sort_results(rows: List[Dict[str, Any]], field: str, direction: str) -> List[Dict[str, Any]]:
    """
    Sorts by `field`, always placing rows with a missing (None) value last,
    regardless of direction (an unmeasurable stock is never implicitly
    treated as the highest or lowest ranked). Non-null rows are sorted by
    the actual value in the requested direction.
    """
    reverse = direction == "desc"
    with_value = [r for r in rows if r.get(field) is not None]
    without_value = [r for r in rows if r.get(field) is None]
    with_value.sort(key=lambda r: r[field], reverse=reverse)
    return with_value + without_value
