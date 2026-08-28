"""
Dynamic explanation generator for the Insider Conviction Engine.

Turns an already-computed scorer.py result into positive/negative bullet
lists. Every bullet is read directly from a real contribution or
unavailable_reason produced during scoring - nothing here is hard-coded
per stock, and nothing here re-derives a number independently of the score
(so the explanation can never drift from the calculation).
"""

from typing import Dict, Any, List


def generate_explanation(result: Dict[str, Any]) -> Dict[str, Any]:
    symbol = result["symbol"]
    overall = result["overall_score"]

    positive: List[str] = []
    negative: List[str] = []

    for key, comp in result["components"].items():
        if comp["available"]:
            for c in comp["contributions"]:
                if c["points"] > 0:
                    positive.append(f"{c['detail']} ({comp['label']}: +{c['points']:.1f})")
                elif c["points"] < 0:
                    negative.append(f"{c['detail']} ({comp['label']}: {c['points']:.1f})")
        else:
            negative.append(f"{comp['label']} unavailable — {comp['unavailable_reason']}")

    if overall is None:
        headline = f"INSUFFICIENT DATA — no Insider Conviction Score could be calculated for {symbol}"
    else:
        headline = f"INSIDER CONVICTION SCORE: {overall:.0f}/100 ({symbol})"

    components_summary = (
        f"Score calculated using {result['components_available']} of {result['components_total']} components."
        if overall is not None
        else f"0 of {result['components_total']} components had usable data."
    )

    confidence = result["confidence"]
    confidence_summary = f"Confidence: {confidence['tier']} — " + "; ".join(confidence["reasons"])

    return {
        "symbol": symbol,
        "headline": headline,
        "components_summary": components_summary,
        "confidence_summary": confidence_summary,
        "positive": positive,
        "negative": negative,
        "model_version": result["model_version"],
        "disclaimer": (
            "This score represents the strength of observable insider conviction based on "
            "available transaction and market evidence. It is not a guaranteed return, a "
            "prediction, or investment advice."
        ),
    }
