# Insider Conviction Engine — Scoring Methodology

**Model version:** `INSIDER_CONVICTION_V1`

## 1. What this score is (and isn't)

The Insider Conviction Score represents **the strength of observable insider conviction based on available transaction and market evidence**, on a 0–100 scale. It is derived entirely from public insider/institutional deal disclosures (StockEdge Insider Trading, SAST, Block, and Bulk deals) and NSE price/volume/delivery history already stored in this platform's database.

It is **not** a guaranteed return, a prediction, a "sure-shot" signal, or investment advice. A high score means the available evidence shows strong, broad, recent insider buying with positive market confirmation — nothing more.

Every score is fully transparent: the API and UI always show the overall score, every component score, its configured and normalized weight, its weighted contribution, the literal positive/negative point contributions behind it, missing-data flags, supporting transactions, a confidence tier, and the model version.

## 2. Data sources (all reused, nothing new ingested)

- `stockedge_all_deals_view` (+ `LEFT JOIN` back to `stockedge_insider_deals` / `stockedge_sast_deals` / `stockedge_block_deals` / `stockedge_bulk_deals`, the same join pattern already used by `backend/engine/backtester.py:load_deals`) for deal records, `security_slug`, and `person_category`.
- `nse_equity_eod` for OHLCV and `delivery_pct`.
- `backend/engine/symbol_matcher.py`'s existing `matcher.resolve_symbol()` for mapping deal security names/slugs to NSE tickers.
- **Market capitalization is not available anywhere in this codebase or database.** No table, column, or ingestion pipeline provides it. The Transaction Strength formula has a market-cap-normalization term that is structurally ready to activate the moment such data exists, but today it always reports as unavailable — it is never fabricated or estimated.

Only `action IN ('BUY', 'SELL')` deals are used. StockEdge insider filings also include `Pledge`, `Unpledge`, and `Pledge Invoke` rows (collateral actions, not open-market conviction signals) — these are explicitly excluded.

## 3. Insider role classification

`person_category` (present only on Insider Trading and SAST deals; always `NULL` on Block/Bulk deals) is grouped by substring match into **Promoter**, **Director**, **KMP**, or **Other**, using only strings that actually appear in the live data (confirmed: `Promoter`, `Promoter Group`, `Promoter and Director`, `Director`, `Directors Immediate Relative`, `KMP`, `Designated Person`, `Employee`, `Trust`, `Immediate Relative`, `Connected Person`). When `person_category` is `NULL` (SAST, Block, Bulk deals), role is reported as **"Unavailable"** — never assumed.

## 4. Component scores, weights, and formulas

| Component | Weight | Base |
|---|---|---|
| Insider Activity | 20% | 50 (symmetric) |
| Transaction Strength | 20% | 50 (symmetric) |
| Accumulation | 20% | 0 (evidence accumulates) |
| Price Confirmation | 15% | 50 (symmetric) |
| Volume / Delivery | 15% | 50 (symmetric) |
| Historical Success | 10% | 50 (symmetric) or unavailable |

Weights live in `backend/engine/conviction/configuration.py:COMPONENT_WEIGHTS` — nowhere else in the codebase hard-codes a weight.

Every sub-score is `clip(base + sum(named point contributions), 0, 100)`. Each contribution is a literal term in the formula and is rendered verbatim as an explanation bullet — there is no separate step that re-derives or paraphrases the explanation from the number, so the explanation can never drift from the calculation.

### A. Insider Activity (`factors.compute_insider_activity`)
- **Net buy/sell balance**: `((Σ recency-weighted buys) − (Σ recency-weighted sells)) / (sum)` × 40 points.
- **Unique insiders buying**: up to 5 distinct buyers × 3 points.
- **Unique insiders selling**: up to 5 distinct sellers × −2 points.
- **Highest-conviction role participation**: +10 if any Promoter bought, else +7 if any Director bought, else +5 if any KMP bought (not stacked — only the highest applicable role counts).
- **Transaction count evidence**: up to 10 transactions × 0.5 points.
- **Recency of buying/selling activity**: `(average recency weight of buy txns) × 10` and, independently, `−(average recency weight of sell txns) × 10`. This term exists because the net-ratio term above is scale-invariant to recency when activity is one-directional (all buys, or all sells) — without it, a purchase from 6 months ago would score identically to one from yesterday.

### B. Transaction Strength (`factors.compute_transaction_strength`)
- **Net transaction value**: signed log-scale mapping of net (buy − sell) rupee value, capped at ±45 points. Reference curve (`TS_VALUE_SCALE_REFERENCE`): ₹0→0, ₹10L→20, ₹50L→40, ₹1Cr→55, ₹5Cr→75, ₹25Cr+→100 (interpolated in log10 space between points, linear below ₹10L).
- **Largest single buy transaction**: same curve, scaled to a 20-point cap.
- **Transaction value vs market capitalization**: only computed if market cap is available (currently never, in this deployment) — `transaction_value / market_cap` mapped through a separate reference curve, capped at 30 points. This is the concrete implementation of "₹5Cr / ₹50Cr market cap is far more significant than ₹5Cr / ₹50,000Cr".
- **Multiple transaction evidence**: up to 8 valued transactions × 1.5 points.
- Deals with no known `total_value` are excluded from this component's inputs; if **no** deal in the window has a value, the component is marked unavailable (never scored as 0).

### C. Accumulation (`factors.compute_accumulation`)
- **Multiple buying dates**: up to 5 distinct dates × 6 points.
- **Multiple unique insiders buying**: up to 5 distinct buyers × 5 points.
- **Repeat purchases by the same insider**: up to 3 repeat buyers × 8 points.
- **Selling offsetting accumulation**: if sell count exceeds buy count, up to 5 excess sells × −6 points.
- A single isolated purchase by one insider on one date scores ~11 (weak); four insiders buying across three dates scores 44+ (strong) — matching the spec's worked examples directly from the formula, not a special case.

### D. Price Confirmation (`factors.compute_price_confirmation`) — CURRENT conviction
Evaluates price movement following each BUY deal in the current window at 5/10/20/30/60-trading-day horizons, but **only counts a horizon if that many trading days have already elapsed** as of the query's `as_of_date` (default today). A deal from 2 days ago simply contributes zero horizons — never an estimated or interpolated one. This is the primary look-ahead-bias guard for the current-conviction score (see §6).
- **Price move since insider buying**: recency-weighted average return across all elapsed-window buy events × 2, capped at ±40 points.
- **Consistency bonus**: ±10 if the return is positive (or negative) across *every* elapsed window for a symbol with ≥2 elapsed windows.
- Scoped to BUY deals only — Insider Conviction is fundamentally a buying-conviction concept.

### E. Volume / Delivery (`factors.compute_volume_delivery`)
For each BUY deal, compares a 5-trading-day post-deal window against a trailing baseline (25 trading days, ending 5 days *before* the deal date — strictly non-overlapping, so post-deal activity can never leak into its own baseline):
- **Volume vs trailing average**: `(post/baseline ratio − 1) × 30`, clipped to [−20, +25].
- **Delivery percentage vs trailing average**: same shape, independently computed.
- If one of the two (volume or delivery) has no usable data, the other still scores the component and an explicit "data unavailable" bullet is shown for the missing half — the component is only fully unavailable if *neither* can be computed.

### F. Historical Success (`factors.compute_historical_success`) — track record, separate from CURRENT conviction
Looks at **all** past BUY events for the stock (not limited to the current 180-day window; bounded to `HISTORICAL_LOOKBACK_DAYS` = 730 days for query performance — see §7) and their realized 20-trading-day forward return, using the same elapsed-window discipline as Price Confirmation.
- Requires at least `MIN_HISTORICAL_SAMPLE_SIZE` = 3 qualifying past events with a fully elapsed 20-day window. **Below that, the component is explicitly `insufficient data` — never scored.**
- **Historical win rate (20D)**: `(% positive − 50) × 0.6`, capped ±30.
- **Historical average return (20D)**: `avg_return × 2`, capped ±20.

## 5. Missing-data handling

Every component reports `available: true/false`. An unavailable component contributes **nothing** (not a 0) to the overall score; the remaining available components' weights are renormalized to sum to 100%:

```
normalized_weight[k] = configured_weight[k] / Σ(configured_weight[j] for j in available components) × 100
overall_score = Σ(component_score[k] × normalized_weight[k] / 100) for k in available components
```

The API/UI always report `"Score calculated using N of 6 components."` If **zero** components are available, `overall_score` is `null` — the system returns an explicit "insufficient data" result rather than fabricating a number.

## 6. Look-ahead-bias prevention

Every price/volume query is bounded by an explicit `as_of_date` parameter (`backend/engine/conviction/market_data.py:load_price_window`, default today) — nothing dated after it is ever loaded from the database. On top of that structural guard:

- **Price Confirmation** only counts a forward-return window once that many trading days have actually elapsed in the loaded candle set (§4D).
- **Historical Success** applies the same elapsed-window discipline, plus a redundant defense-in-depth filter (`compute_historical_success` drops any deal or candle dated after `as_of_date` even if a caller passed an improperly-bounded list).
- **Volume/Delivery**'s baseline window ends 5 days *before* the deal date, so post-deal activity structurally cannot leak into the "normal" baseline it's compared against.

CURRENT conviction (Insider Activity, Transaction Strength, Accumulation, Price Confirmation, Volume/Delivery) and HISTORICAL SUCCESS (track record) are computed from separate, clearly-labeled inputs and never blended into a single number — a stock's current score is never inflated by "this worked well historically" reasoning smuggled into the current-conviction components.

## 7. Recency weighting

`recency_weight(deal_date, as_of_date) = 0.5 ^ (days_ago / 30)` — a transaction 30 days old counts half as much as one from today, 60 days old counts a quarter, and so on. No transaction is ever discarded; older activity simply contributes less. The half-life (`RECENCY_HALF_LIFE_DAYS`) is a configuration constant, not hard-coded inline.

## 8. Confidence methodology

A transparent point rubric (`scorer.compute_confidence`), not a hidden heuristic:

| Condition | Points |
|---|---|
| ≥5/6 components available | +2 (or +1 for ≥3/6, +0 below) |
| ≥5 qualifying transactions | +2 (or +1 for ≥2, +0 below) |
| ≥2 unique insiders involved | +1 |
| Historical track record available | +1 |
| Market price data available | +1 |
| Market cap data available | +1 (currently always +0 in this deployment) |

Total ≥5 → **HIGH**; ≥3 → **MEDIUM**; otherwise **LOW**. Every point is named in the API response's `confidence.reasons` list, so a score of 88 with LOW confidence is fully explainable, not contradictory.

## 9. Known limitations (Phase 1)

- **Market capitalization is unavailable platform-wide.** Transaction Strength's mcap-normalization term is dormant until this data source exists.
- The database currently holds only ~5.5 months of Insider Trading disclosures and sparse SAST history since 2004 — most stocks will legitimately show Historical Success as `insufficient data` until more history accumulates. This is correct behavior, not a bug.
- Historical Success is bounded to the last 730 days (not full table history) to keep the batch ranking endpoint fast; this is a deliberate Phase 1 scope decision.
- The ranking endpoint only scores symbols with qualifying BUY/SELL activity in the last 180 days (an intentional, natural bound — not an arbitrary cutoff of the full NSE universe).

## 10. Worked example

A stock with:
- 4 insiders bought (incl. 1 Promoter) across 3 dates in the last 40 days, ₹8.4 Cr net buying, no sells.
- Price +11.2% over the 20 trading days since the earliest of those buys; no 30D/60D window has elapsed yet.
- Volume 1.8× the pre-deal baseline; no delivery data available.
- Only 1 prior BUY event on record for this stock (below the minimum sample of 3).

Insider Activity ≈ 50 + 40 (all buying, no sells) + 12 (4 buyers) + 10 (Promoter) + 1.5 (txn count) + ~8 (recency) ≈ **92** (available)
Transaction Strength ≈ 50 + ~34 (net value ₹8.4Cr) + ~15 (largest buy) + 6 (3 valued txns) ≈ **86** (available; market-cap term unavailable)
Accumulation = 18 (3 dates) + 20 (4 buyers) + 0 (no repeat single-insider buys) = **90** (available)
Price Confirmation ≈ 50 + 22 (11.2% × 2) ≈ **78** (available; only the 20D window has elapsed)
Volume/Delivery ≈ 50 + 24 (1.8× volume) + 0 (delivery unavailable) ≈ **72** (available)
Historical Success: **unavailable** ("insufficient data", sample size 1 < 3)

Weights renormalize across the 5 available components (20/20/20/15/15 → summing to 90, scaled to 100):
`Overall = (92×20 + 86×20 + 90×20 + 78×15 + 72×15) / 90 ≈ 84`

Confidence: 5/6 components available (+2), 4+ transactions (+2), 4 unique insiders (+1), market data available (+1), historical unavailable (+0), market cap unavailable (+0) = 6 → **HIGH**.

Explanation would read:

> **INSIDER CONVICTION SCORE: 84/100**
> **Positive:** 4 distinct insider(s)/entities purchased shares (Insider Activity: +12); Promoter participated in buying (Insider Activity: +10); ₹8.40 Cr net insider buying (buy ₹8.40 Cr vs sell ₹0) (Transaction Strength: +34.2); Buying occurred across 3 distinct date(s) (Accumulation: +18); Average +11.20% across 1 elapsed-window buy event(s) (Price Confirmation: +22.4); Volume was 1.80× the pre-deal baseline average (Volume/Delivery: +24)
> **Negative / Missing-data:** Delivery data unavailable — insufficient volume/delivery history; Historical Success unavailable — insufficient data
