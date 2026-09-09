# Release Notes — NiftyFirst Version 2.0.0

**Release Tag / Branch:** `release-v2`  
**Base Release:** `release/v1.1.0`  
**Release Date:** September 2026  
**Status:** Production Staging Ready  

---

## Executive Summary

Version 2.0.0 represents a major milestone for the NiftyFirst Quantitative Trading & Backtesting Platform. This release delivers institutional-grade deal signal analytics, comprehensive date-range backtesting across historical insider and bulk/block deal disclosures, advanced deal aggregation and transaction consolidation, and strict NSE symbol governance to completely eliminate look-ahead bias and unmapped symbol contamination.

---

## Major Features & Capabilities

### 1. NSE Symbol Master & Symbol Matching Governance
- **NSE-Only Symbol Master:** Centralized exchange resolution strictly enforcing NSE symbol spaces, eliminating BSE ticker contamination.
- **Match Confidence Tiering:** Deals are classified into `MATCHED`, `LOW_CONFIDENCE`, `UNMATCHED`, and `MANUAL_OVERRIDE`.
- **Governance Safety Gate:** The backtesting engine strictly rejects `LOW_CONFIDENCE` and `UNMATCHED` securities from return calculations, ensuring 100% price data fidelity.
- **Audit & Re-Match Operations:** Confirmation-gated endpoints to re-run automated symbol mapping while preserving manual user mappings and overrides.

### 2. Deals Explorer Enhancements
- **Net Buy Only Mode:** Dedicated toggle to filter and highlight stocks where aggregate institutional and insider buying exceeds selling.
- **Server-Side Date Filtering:** Quick-select presets (`Today`, `Last 7 Days`, `Last 30 Days`, `Last 90 Days`) and custom date range pickers.
- **Numeric & Date Sorting:** Multi-column server-side sorting for deal value, trade date, quantity, and price.
- **Advanced Export Utilities:** Full CSV and Excel (.xlsx) export capabilities with server-side pagination and category filtering.
- **Comprehensive Column Controls:** Dynamic column visibility, row selection, and refined deal summary metrics.

### 3. Full Deal Backtesting by Date Range
- **Arbitrary Date Range Selection:** Backtest all eligible insider, SAST, block, and bulk deals across any historical date window.
- **Look-Forward Trading Return Horizons:** Evaluates forward performance at **1D, 5D, 10D, 20D, and 60D** trading-day intervals using daily EOD price candles.
- **Dual Directional Testing:** Supports `BUY`, `SELL`, or combined long/short simulation.
- **Exclusion Audit Trail:** Transparently records and displays all deals excluded due to missing symbol mappings, insufficient trading history, or date boundary cutoffs.
- **Statistical Summaries:** Computes win rates, mean returns, median returns, profit factors, and standard deviations by deal category and action.

### 4. Backtest Signal Consolidation
- **Transaction Grouping:** Consolidates multiple intra-day transactions into unified signals grouped by `NSE Symbol + Signal Date + Deal Type`.
- **Dominant Action Resolution:** Intelligently identifies the primary trade action (`BUY` vs. `SELL`) based on total transactional value.
- **Net Buy Value Calculation:** Calculates net institutional inflow/outflow per consolidated signal (`Total BUY - Total SELL`).
- **Underlying Transaction Drill-Down:** Expandable audit view showing individual deal executions, brokers, clients, quantities, and prices supporting each consolidated signal.
- **Export Consistency:** Export consolidated signals or granular underlying transactions directly to CSV/Excel.

---

## Database Architecture & Migrations

All schema changes are additive and self-healing, utilizing non-destructive `CREATE TABLE IF NOT EXISTS` patterns executed during application startup:

- **`backtest_runs`**:
  - Stores backtest execution parameters, summary metrics, breakdowns, signal records, and excluded record audit trails.
  - Indexes: `idx_backtest_runs_run_id` (unique lookups), `idx_backtest_runs_created_at` (chronological ordering).
- **`symbol_mappings`**:
  - Manages governance mappings, confidence scores, and manual overrides.
- **`insider_conviction_scores`**:
  - Additive conviction factor storage.

---

## API Endpoints Inventory (v2.0.0)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/deals` | Paginated deal disclosures with `net_buy_only`, date range, category, action, and sorting |
| `GET` | `/api/deals/summary` | Aggregate volume and count statistics respecting active filters |
| `GET` | `/api/backtest/data-availability` | Earliest and latest dates available for EOD prices and deals |
| `POST` | `/api/backtest/run-date-range` | Executes full date-range backtest with consolidated signals |
| `GET` | `/api/backtest/runs` | Lists historical backtest runs |
| `GET` | `/api/backtest/runs/{run_id}` | Retrieves detailed results and audit data for a specific run |
| `GET` | `/api/backtest/runs/{run_id}/export` | Exports backtest signals or transactions as CSV/Excel |
| `POST` | `/api/backtest/run` | Executes portfolio simulation strategy |
| `GET` | `/api/symbol-matcher/mappings` | Governance mapping status and review queue |
| `POST` | `/api/symbol-matcher/map` | Submits manual symbol override |
| `GET` | `/api/health` | Service health status |

---

## Verification & Validation Results

- **Frontend Production Build:** `npm run build` completed successfully with 0 errors.
- **Backend Test Suite:** Passed all regression, net-buy, date-range backtest, and consolidation tests:
  - `tests/test_deals_net_buy.py`: 25 passed
  - `tests/test_full_deal_backtest.py`: 10 passed
  - `tests/test_backtest_consolidation.py`: 6 passed
  - `tests/test_symbol_matcher_governance.py`: 16 passed
  - `tests/test_symbol_matcher_exchange_scope.py`: 11 passed
  - `tests/test_screener.py`: 30 passed
  - `tests/test_stock_intelligence.py`: 14 passed
  - `tests/test_exchange_configuration.py`: 14 passed
  - `tests/test_multi_exchange_pipeline.py`: 5 passed
- **Branch Isolation:** `master` and `release/v1.1.0` remain untouched.
