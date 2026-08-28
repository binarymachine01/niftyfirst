# Smart Stock Screener — Methodology

## 1. What this is

The Smart Screener ranks stocks by combining insider/institutional deal activity with the existing **Insider Conviction Score** (Phase 1) and technical/price/delivery confirmation. It reuses the Conviction Engine's data loaders and scoring function directly (`backend/engine/conviction/scorer.py:build_result`) — it does not compute a second, independent conviction score.

## 2. Universe scoping (read this before interpreting "why isn't stock X showing up")

The screener only considers symbols with **at least one qualifying BUY/SELL deal** (Insider Trading, SAST, Block, or Bulk) within `max(user's insider lookback, 730 days)`. This is the same scoping principle the Conviction Engine's own `/api/conviction` ranking endpoint already uses — it is a deliberate design choice, not an arbitrary limitation: this is an insider-driven screener with technical/price confirmation layered on top, not a blind technical scan of all ~4,000 listed NSE symbols. A stock with excellent technicals but zero recent insider/institutional activity will not appear, by design.

## 3. Data reuse

- `stockedge_all_deals_view` (+ joins for `security_slug`/`person_category`) and `nse_equity_eod` — same tables the Conviction Engine uses.
- `backend/engine/conviction/market_data.py:load_active_symbols` / `load_price_window` — the exact same batched, look-ahead-safe loaders (one deals query + one price query for the whole universe, never per-symbol).
- `backend/engine/conviction/scorer.py:build_result` — the exact Phase 1 Conviction Score calculation, fed with the screener's own batch-loaded data.
- `backend/engine/technical_analysis.py` (new) — returns/DMA/RSI/volume-ratio/52-week-position/breakout/delivery-stats, computed once per symbol from the same already-loaded candles (no duplicate price queries).

## 4. Filters

### Insider (evaluated over the user's chosen `lookback_days`, independent of the Conviction Score's own fixed 180-day window)
| Filter | Definition |
|---|---|
| Insider BUY / SELL | Requires ≥1 qualifying deal in that direction within the lookback window. Both can be checked simultaneously (requires both). |
| Min Transaction Value | Total ₹ value of all qualifying (BUY+SELL combined, per active direction toggles) transactions in the window, in lakhs. |
| Minimum Insiders | Count of unique insiders, direction-aware: if BUY is checked, counts unique buyers; if SELL is checked, counts unique sellers; if both, the union; if neither, any direction. |
| Promoter Buying | ≥1 BUY deal in-window with `role == "Promoter"` (same role classification the Conviction Engine uses). |
| Repeat Buying | ≥1 insider with more than one BUY transaction in-window (same definition as the Conviction Engine's Accumulation factor). |
| Lookback | 7/14/30/60/90/180 days. Default 30. |

### Price (from `technical_analysis.compute_returns` / `compute_52w_position`)
1D/5D/20D/3M(≈63 trading days)/6M(≈126 trading days) returns, and 52-week position (`(close − 52w low) / (52w high − 52w low) × 100`). Each supports independent min/max.

### Technical
- **Above N-day DMA**: `current close > simple moving average of the last N closes (N ∈ {20,50,200})`.
- **RSI(14)**: standard simple-average method (not Wilder-smoothed, chosen for transparency): `RSI = 100 − 100/(1 + avg_gain/avg_loss)` over the last 14 daily changes.
- **Volume Ratio**: `(avg volume, last 5 trading days) / (avg volume, the 20 trading days immediately before that)` — non-overlapping windows.
- **Breakout**: `latest close > highest CLOSE of the preceding 20 trading days` (explicit, closing-price based — not intraday high).

### Delivery
- **Delivery %**: latest available `delivery_pct`.
- **Delivery Increase**: `current delivery % − trailing 20-day average delivery %`, in percentage points (not a ratio).

### Deals
Restricts which of the 4 deal categories are even loaded into the candidate pool (reuses the existing `deal_category` classification — no new taxonomy).

### Conviction
Min/max on the Conviction Score's `overall_score`, computed by the unmodified Phase 1 engine.

## 5. Missing-data handling

Every filter that references a metric which is `None` for a stock **excludes that stock** — it is never treated as passing, and never treated as zero. A filter the user left at its default (unset) never excludes anything based on that metric. This applies uniformly across insider, price, technical, delivery, and conviction filters.

## 6. Filter combination

**AND-only.** Every selected filter must pass. There is no OR support in this phase (a deliberate simplification per the spec).

## 7. Ranking / sorting

Sorting happens server-side, over the already-computed (filtered) result set — not a second database query. Rows with a missing value for the chosen sort field are always placed last, regardless of ascending/descending direction.

## 8. Signal Strength

A transparent, rule-based classification — **not** a second scoring system. It counts how many of the following measurable, already-computed signals are present:
- Accumulation component (Conviction Engine) ≥ 60
- Price Confirmation component (Conviction Engine) ≥ 60
- Volume Ratio ≥ 1.5×
- Delivery ≥ 50% or a positive delivery increase
- Promoter buying detected
- Repeat buying detected
- Price above the 50-day moving average

| Tier | Requires |
|---|---|
| VERY STRONG | Conviction ≥ 80 **and** ≥ 4 of the above signals |
| STRONG | Conviction ≥ 65 **and** ≥ 3 signals |
| MODERATE | Conviction ≥ 50 **and** ≥ 2 signals |
| WEAK | Everything else, including Conviction unavailable |

Every contributing reason is returned alongside the tier (`signal_reasons`) so a result's classification is always traceable to real numbers.

## 9. Historical Win Rate

Read directly from the Conviction Engine's existing Historical Success component (`conviction.components.historical_success.metrics`) — **no separate win-rate calculation exists in the screener.** If that component reports `available: false` (fewer than 3 qualifying historical events — the same threshold the Conviction Engine already enforces), the screener shows "Insufficient history" rather than a misleading percentage.

## 10. Price Momentum

Displayed as the **20-trading-day return** — the same primary window the Conviction Engine's own Price Confirmation factor highlights. No separate composite momentum formula was introduced; this avoids inventing new market-data computations where an existing, already-calculated number serves the purpose.

## 11. No look-ahead bias

Every price/deal query is bounded by `as_of_date` (defaults to today) via the same mechanism the Conviction Engine already enforces at its data-loading layer (`market_data.py:load_price_window`, `load_active_symbols`). The screener never issues its own unbounded query — it always goes through these existing, already-audited loaders.

## 12. Pagination & performance

- Default page size 25, max 100.
- One deals query + one price-history query for the entire candidate universe, regardless of how many stocks are ultimately returned — sorting, filtering, and pagination all happen in-memory over that single batch-loaded, pre-computed set.
- Conviction Score is computed exactly once per symbol per request (never recomputed per filter, per sort, or per page).

## 13. API

`POST /api/screener/search` — full filter/sort/pagination payload, returns `{results, total_count, page, page_size, total_pages, universe_size, top_exclusion_reasons}`.
`GET /api/screener/options` — static metadata (lookback options, sortable fields, deal categories) so the frontend doesn't hardcode a second copy of these lists.

## 14. Known limitations

- The universe scoping (§2) means a purely technical screen with zero insider-activity requirement will only surface stocks that happen to have *some* qualifying deal in the lookback window — this is intentional for Phase 2.
- Historical Win Rate will show "Insufficient history" for most stocks today, for the same reason documented in the Conviction Engine's own methodology doc (the platform currently holds only ~5.5 months of Insider Trading disclosures).
- RSI uses the simple-average method, not Wilder's smoothed EMA variant — chosen for calculation transparency; values will differ slightly from some charting platforms that default to Wilder smoothing.
