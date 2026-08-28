"""
Screener filter request models and per-stock filter evaluation.

Every predicate follows one rule (per spec): if a filter constrains a
metric and that metric is unavailable (None) for a stock, the stock FAILS
that filter - missing data is never treated as a silent pass or as zero.
A filter that the user left unset never excludes anything.

All filters combine with AND semantics only - no OR support in this phase,
kept deliberately simple and predictable.
"""

from typing import List, Optional, Dict, Any, Tuple
from pydantic import BaseModel, Field

from . import configuration as cfg

DEAL_CATEGORIES = ("Insider Trading", "SAST Deals", "Block Deals", "Bulk Deals")


class InsiderFilters(BaseModel):
    buy: bool = True
    sell: bool = False
    min_transaction_value_lakhs: float = Field(default=0.0, ge=0.0)
    min_insiders: int = Field(default=1, ge=0)
    promoter_buying: bool = False
    repeat_buying: bool = False
    lookback_days: int = Field(default=cfg.DEFAULT_INSIDER_LOOKBACK_DAYS, ge=1, le=730)


class PriceFilters(BaseModel):
    return_1d_min: Optional[float] = None
    return_1d_max: Optional[float] = None
    return_5d_min: Optional[float] = None
    return_5d_max: Optional[float] = None
    return_20d_min: Optional[float] = None
    return_20d_max: Optional[float] = None
    return_3m_min: Optional[float] = None
    return_3m_max: Optional[float] = None
    return_6m_min: Optional[float] = None
    return_6m_max: Optional[float] = None
    week_52_position_min: Optional[float] = None
    week_52_position_max: Optional[float] = None


class TechnicalFilters(BaseModel):
    above_20dma: Optional[bool] = None
    above_50dma: Optional[bool] = None
    above_200dma: Optional[bool] = None
    rsi_min: Optional[float] = None
    rsi_max: Optional[float] = None
    volume_ratio_min: Optional[float] = None
    volume_ratio_max: Optional[float] = None
    breakout: Optional[bool] = None


class DeliveryFilters(BaseModel):
    delivery_pct_min: Optional[float] = None
    delivery_pct_max: Optional[float] = None
    delivery_increase_min: Optional[float] = None


class DealFilters(BaseModel):
    categories: List[str] = Field(default_factory=lambda: list(DEAL_CATEGORIES))


class ConvictionFilters(BaseModel):
    min_score: Optional[float] = Field(default=None, ge=0, le=100)
    max_score: Optional[float] = Field(default=None, ge=0, le=100)


class SortSpec(BaseModel):
    field: str = cfg.DEFAULT_SORT_FIELD
    direction: str = "desc"  # "asc" or "desc"


class ScreenerRequest(BaseModel):
    insider: InsiderFilters = Field(default_factory=InsiderFilters)
    price: PriceFilters = Field(default_factory=PriceFilters)
    technical: TechnicalFilters = Field(default_factory=TechnicalFilters)
    delivery: DeliveryFilters = Field(default_factory=DeliveryFilters)
    deals: DealFilters = Field(default_factory=DealFilters)
    conviction: ConvictionFilters = Field(default_factory=ConvictionFilters)
    sort: SortSpec = Field(default_factory=SortSpec)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=cfg.DEFAULT_PAGE_SIZE, ge=1, le=cfg.MAX_PAGE_SIZE)


def filter_deals_by_category(deals: List[Dict[str, Any]], categories: List[str]) -> List[Dict[str, Any]]:
    """Restricts a deal list to the selected deal categories, reusing the existing deal_category field."""
    if not categories:
        return deals
    allowed = set(categories)
    return [d for d in deals if d.get("deal_category") in allowed]


def _fails_min_max(value: Optional[float], min_val: Optional[float], max_val: Optional[float]) -> bool:
    """True if this filter is constrained (min or max set) and the stock can't satisfy it."""
    if min_val is None and max_val is None:
        return False
    if value is None:
        return True  # constrained but unmeasurable -> exclude, never silently pass
    if min_val is not None and value < min_val:
        return True
    if max_val is not None and value > max_val:
        return True
    return False


def evaluate_insider(insider_metrics: Dict[str, Any], f: InsiderFilters) -> List[str]:
    """Returns a list of failure reasons (empty list = passes all insider filters)."""
    failures = []
    if f.buy and insider_metrics["buy_count"] == 0:
        failures.append("No qualifying BUY activity in the selected lookback window")
    if f.sell and insider_metrics["sell_count"] == 0:
        failures.append("No qualifying SELL activity in the selected lookback window")
    if f.min_transaction_value_lakhs > 0:
        total_value = insider_metrics.get("total_value")
        if total_value is None or (total_value / 100000.0) < f.min_transaction_value_lakhs:
            failures.append(f"Total transaction value below ₹{f.min_transaction_value_lakhs}L threshold")
    if f.min_insiders > 0:
        # Direction-aware: counts insiders matching whichever of BUY/SELL is
        # active. If neither toggle is set, falls back to any direction.
        if f.buy or f.sell:
            relevant = set()
            if f.buy:
                relevant |= insider_metrics["unique_buyers"]
            if f.sell:
                relevant |= insider_metrics["unique_sellers"]
        else:
            relevant = insider_metrics["unique_buyers"] | insider_metrics["unique_sellers"]
        if len(relevant) < f.min_insiders:
            failures.append(f"Fewer than {f.min_insiders} unique insider(s) involved")
    if f.promoter_buying and not insider_metrics["promoter_buying"]:
        failures.append("No Promoter buying detected in window")
    if f.repeat_buying and not insider_metrics["repeat_buying"]:
        failures.append("No repeat buying by the same insider detected in window")
    return failures


def evaluate_price(technical: Dict[str, Any], f: PriceFilters) -> List[str]:
    failures = []
    returns = technical["returns"]
    checks = [
        ("1D Return", returns["1d"], f.return_1d_min, f.return_1d_max),
        ("5D Return", returns["5d"], f.return_5d_min, f.return_5d_max),
        ("20D Return", returns["20d"], f.return_20d_min, f.return_20d_max),
        ("3M Return", returns["3m"], f.return_3m_min, f.return_3m_max),
        ("6M Return", returns["6m"], f.return_6m_min, f.return_6m_max),
        ("52-Week Position", technical["week_52_position"], f.week_52_position_min, f.week_52_position_max),
    ]
    for label, value, min_val, max_val in checks:
        if _fails_min_max(value, min_val, max_val):
            failures.append(f"{label} outside selected range (value: {value if value is not None else 'N/A'})")
    return failures


def evaluate_technical(technical: Dict[str, Any], f: TechnicalFilters) -> List[str]:
    failures = []
    dma = technical["dma"]

    if f.above_20dma is True and dma["above_dma_20"] is not True:
        failures.append("Not above 20-day moving average (or insufficient history)")
    if f.above_50dma is True and dma["above_dma_50"] is not True:
        failures.append("Not above 50-day moving average (or insufficient history)")
    if f.above_200dma is True and dma["above_dma_200"] is not True:
        failures.append("Not above 200-day moving average (or insufficient history)")

    if _fails_min_max(technical["rsi"], f.rsi_min, f.rsi_max):
        failures.append(f"RSI outside selected range (value: {technical['rsi'] if technical['rsi'] is not None else 'N/A'})")

    if _fails_min_max(technical["volume_ratio"], f.volume_ratio_min, f.volume_ratio_max):
        failures.append(f"Volume ratio outside selected range (value: {technical['volume_ratio'] if technical['volume_ratio'] is not None else 'N/A'})")

    if f.breakout is True and technical["breakout"]["is_breakout"] is not True:
        failures.append("No 20-day breakout detected (or insufficient history)")

    return failures


def evaluate_delivery(technical: Dict[str, Any], f: DeliveryFilters) -> List[str]:
    failures = []
    delivery = technical["delivery"]

    if _fails_min_max(delivery["current_delivery_pct"], f.delivery_pct_min, f.delivery_pct_max):
        failures.append(f"Delivery % outside selected range (value: {delivery['current_delivery_pct'] if delivery['current_delivery_pct'] is not None else 'N/A'})")

    if f.delivery_increase_min is not None:
        if delivery["delivery_increase"] is None or delivery["delivery_increase"] < f.delivery_increase_min:
            failures.append(f"Delivery increase below {f.delivery_increase_min} percentage points threshold")

    return failures


def evaluate_conviction(conviction_result: Optional[Dict[str, Any]], f: ConvictionFilters) -> List[str]:
    failures = []
    if f.min_score is None and f.max_score is None:
        return failures

    score = conviction_result["overall_score"] if conviction_result else None
    if score is None:
        failures.append("Conviction Score unavailable (insufficient data)")
        return failures
    if f.min_score is not None and score < f.min_score:
        failures.append(f"Conviction Score below minimum {f.min_score}")
    if f.max_score is not None and score > f.max_score:
        failures.append(f"Conviction Score above maximum {f.max_score}")
    return failures


def evaluate_all(candidate: Dict[str, Any], req: ScreenerRequest) -> Tuple[bool, List[str]]:
    """Runs every filter group against one computed candidate. AND semantics: any failure excludes the stock."""
    failures = []
    failures += evaluate_insider(candidate["insider"], req.insider)
    failures += evaluate_price(candidate["technical"], req.price)
    failures += evaluate_technical(candidate["technical"], req.technical)
    failures += evaluate_delivery(candidate["technical"], req.delivery)
    failures += evaluate_conviction(candidate["conviction"], req.conviction)
    return (len(failures) == 0, failures)
