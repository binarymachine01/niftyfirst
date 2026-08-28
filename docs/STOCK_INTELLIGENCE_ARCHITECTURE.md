# Stock Intelligence Page — Architecture

## 1. What this is

An upgrade of the existing Stock Inspector into a consolidated research page combining price/technical action, insider/deal activity, the Phase 1 Insider Conviction Score, and Phase 2's Signal Strength and historical-signal reader — for a single stock. It reuses Phase 1 and Phase 2 directly; it computes **no new scoring, ranking, or historical-signal math** of its own.

## 2. Data sources (all reused)

- `nse_equity_eod`, `stockedge_all_deals_view` + raw deal tables — same tables Phase 1/2 use.
- `backend/engine/conviction/market_data.py` — the same look-ahead-safe, batched loaders (`load_symbol_deals`, `load_price_window`).
- `backend/engine/screener/screener.py:build_candidate` — Conviction Score + technicals + insider-window metrics, computed exactly once.
- `backend/engine/screener/ranking.py` — Signal Strength classification and the Historical Win Rate reader.
- `backend/engine/conviction/explanations.py` — the base "why this score" bullets.

## 3. New backend module

`backend/engine/stock_intelligence.py` — a pure orchestrator (`get_stock_intelligence(symbol)`). It loads deals/candles once via the existing conviction loaders, calls `screener.build_candidate` once, and assembles:
- **Header**: latest price/change and 52-week high/low, computed directly from the already-loaded candle list (no separate query). Company name is sourced from the most recent real deal record's `security_name` — `None` (not fabricated) if the stock has no deal history at all.
- **Repeat buyers**: derived from the same buyer-count map Phase 2's screener already builds internally (`build_candidate`'s `insider.buyer_counts`), filtered to counts > 1.
- **Deal activity**: grouped by the existing `deal_category` classification — no new taxonomy, no duplicated categorization logic.
- **Historical Signal Performance**: reads `conviction.components.historical_success.metrics.by_window` (see §4) — not recalculated.
- **Explanation**: Phase 1's `explanations.generate_explanation()` output, with Phase 2's `signal_reasons` bullets merged into the same positive-factors list (not a second explanation engine).

## 4. Historical Signal Performance — extending, not duplicating

Phase 1's `factors.compute_historical_success` only ever reported stats for its primary scoring window (20 trading days). The spec for this page asks for a 1D/5D/10D/20D/60D spread. Rather than build a second, parallel historical-signal calculator, `compute_historical_success` was **extended** (in `backend/engine/conviction/factors.py`) to also compute an independent per-window breakdown (`metrics["by_window"]`):

- `HISTORICAL_SUCCESS_WINDOWS` broadened from `(5, 10, 20, 30)` to `(1, 5, 10, 20, 30, 60)`.
- Each window's sample is **independently qualified** — an event only needs *that* window to have elapsed, not the 20-day primary window used for scoring. This means a 1D breakdown can have a larger, more current sample than the Conviction Score's own 20D-gated sample (a real, not artificial, difference — a signal from 3 days ago has a valid 1D outcome even though its 20D outcome hasn't happened yet).
- **The Conviction Score's actual formula is untouched.** The `events` list used for scoring is built with exactly the same gate as before (`if HS_PRIMARY_WINDOW(20) in window_returns`), and the score's contributions still only reference the primary-window `pct_positive`/`avg_return`. This is verified by `tests/test_stock_intelligence.py::test_historical_success_score_formula_unaffected_by_window_expansion`, which asserts the primary-window stats are numerically identical whether read from the top-level `metrics` or from `metrics["by_window"]["20"]`.

## 5. Look-ahead bias

No new boundary was introduced. Every deal/price load in `stock_intelligence.py` goes through the same `as_of_date`-bounded loaders Phase 1 already audited (`conviction/market_data.py`). The historical-window extension in §4 reuses the exact same elapsed-window discipline already in place — a window's return is only computed once that many trading days have actually occurred in the loaded (bounded) candle set.

## 6. API

`GET /api/stocks/{symbol}/intelligence` (new, added to the existing `backend/routers/stocks.py`) — returns everything **except** the raw OHLCV candle series. `GET /api/stocks/{symbol}/history` (existing, unchanged) still serves the candle array. The frontend fires both in parallel on load — two calls, not per-row/per-item N+1 calls.

## 7. Frontend

`StockInspector.jsx` was upgraded in place (not duplicated): stock header with Conviction Score/Signal/Confidence, a compact Stock Intelligence Summary, a candlestick chart (custom recharts `Bar` shape — no new charting library) with 20/50/200-DMA overlays (computed client-side from the already-fetched candle array — a simple moving average needs no backend round-trip), BUY/SELL transaction markers (from the intelligence payload's `transactions`, merged into the chart data by date), a volume panel, a delivery panel (with a dashed reference line at the trailing average), a 1M/3M/6M/1Y/3Y/5Y/MAX range selector (client-side slicing of the one fetched candle array — no re-fetch per click), Insider Activity + Repeat Buyers cards, a Deal Activity breakdown, the Historical Signal Performance grid, the Conviction Score component table, a "Why This Signal" positive/negative-factors section, and the Recent Transactions table.

## 8. Missing-data handling

Every numeric field in the intelligence response is `None` when unmeasurable — never fabricated as 0. The frontend renders `N/A` (price/technical fields), "No activity" (deal categories with zero deals — the category key is simply absent from `deal_activity` rather than present with zero-filled values), or "Insufficient data"/"Insufficient history" (historical windows and win rate below the minimum sample size) accordingly.

## 9. Performance

One deals query + one price query total per page load (via the existing batched loaders), Conviction Score computed exactly once, DMA series computed client-side from data already in memory (no extra backend round-trip), and chart range switching is pure client-side array slicing.

## 10. Known limitations

- Volume and delivery mini-panels are separate small `ComposedChart` instances sharing the same data array rather than one fully-synced multi-axis chart — they align by column position but don't share a brush/zoom interaction (a deliberate scope simplification; recharts doesn't have a first-class multi-pane synced chart primitive without significant custom work).
- Company name is only available for stocks with at least one recorded insider/institutional deal (sourced from that deal's `security_name`); stocks with pure price history and no deal activity show no company name, matching the "don't fabricate" requirement rather than guessing.
