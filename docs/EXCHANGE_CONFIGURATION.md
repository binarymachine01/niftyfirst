# Insider & Deal Data Pipeline — Exchange Configuration

## 1. What changed and why

The StockEdge insider/deal extractor (`scripts/insider_data_extractor/stockedge_deals_extractor.py`) previously hard-coded `"exchange": 1` (NSE's StockEdge API code) directly inside two of its four API endpoint configs (Insider Trading, SAST), and applied **no exchange filter at all** to the other two (Block Deals, Bulk Deals) — meaning any exchange StockEdge happens to return for those categories could already be flowing into the database unfiltered. This phase replaces that with a single, centralized, configurable exchange filter used by every category identically.

## 2. Configuration

Centralized in `scripts/common/__init__.py` (the shared config module every extraction script already imports from):

```python
ENABLED_EXCHANGES = [e.strip().upper() for e in os.getenv("ENABLED_EXCHANGES", "NSE").split(",") if e.strip()]

EXCHANGE_API_CODES = {
    "NSE": 1,
}

def is_exchange_enabled(exchange_name) -> bool: ...
```

| Env var | Default | Example (future, not enabled today) |
|---|---|---|
| `ENABLED_EXCHANGES` | `NSE` | `NSE,BSE` |

Documented in `.env.example`. **The default and current production configuration is `NSE` only** — this must not change until BSE EOD price data actually exists in `nse_equity_eod` (or a BSE-equivalent table), since a deal on an exchange with no price data can never be correlated with anything downstream anyway.

## 3. Where the filter is applied

Every extraction path funnels through the **one** function, `is_exchange_enabled()` — there is no `if exchange == "NSE"` anywhere in the codebase:

- **Insider Trading / SAST Deals** (StockEdge endpoints that accept a request-level `exchange` query param): `scripts/insider_data_extractor/stockedge_deals_extractor.py:main()` loops over `ENABLED_EXCHANGES` and fetches once per enabled exchange, injecting the code from `EXCHANGE_API_CODES`. If an enabled exchange has no entry in `EXCHANGE_API_CODES` (e.g. someone sets `ENABLED_EXCHANGES=NSE,BSE` before BSE's code is verified), that exchange is **skipped with a warning** — never guessed, never silently mismatched.
- **Block Deals / Bulk Deals** (no exchange-scoped request param exists on these StockEdge endpoints): every fetched record is filtered by `is_exchange_enabled(record["ExchangeName"])` before being counted, inserted, or included in the Excel export.
- Both paths converge in `fetch_api_data()`, which applies the **same** per-record `is_exchange_enabled()` check regardless of category — defense-in-depth even for the request-filtered categories, and the only filter at all for the non-filterable ones.

Disabled-exchange records are excluded from: the database insert, the Excel workbook, and the function's return value — never merely hidden downstream.

## 4. Why nothing else needed to change

- **Database schema**: `exchange_name` already existed as a column on all four deal tables — no migration needed.
- **SymbolMatcher / Conviction / Screener / Backtesting / Stock Intelligence**: none of these compare against a literal exchange name anywhere; they resolve against `nse_equity_eod`, which is inherently NSE-scoped by what data it contains, not by a scattered exchange check. Since the extraction pipeline now guarantees only enabled-exchange deals ever reach the database, every downstream consumer is automatically correct with zero code changes.
- **NSE EOD pipeline** (`scripts/nse_eod/`): intentionally untouched — it is an NSE-specific downloader by construction (it pulls NSE's own Bhavcopy archives), not a multi-exchange extractor, so "making it configurable" doesn't apply here.

## 5. Enabling an additional exchange later

1. Add real BSE (or other) EOD/price data to the platform (a new table or an extended `nse_equity_eod`-equivalent).
2. Verify the exchange's StockEdge API code and add it to `EXCHANGE_API_CODES`.
3. Set `ENABLED_EXCHANGES=NSE,BSE`.

No extraction, database, SymbolMatcher, or analytics code needs to change for step 3 alone — by design.

## 6. Testing

`tests/test_exchange_configuration.py` covers: default is NSE-only, multi-exchange parsing, whitespace/case normalization, `is_exchange_enabled()` correctness, and that enabling an exchange with no verified API code causes a graceful skip rather than a crash or a guess. Written but not executed, per standing project instruction.

## 7. System Health UI — exchange selection & the `SUPPORTED` / `ENABLED` / `DEFAULT` distinction

The Insider & Deal Data Pipeline card in System Health (`frontend/src/components/SystemStatus.jsx`) lets the user pick which exchange(s) to run the pipeline against, without introducing a second execution mechanism — it still calls the existing `POST /api/system/run-script`, just with an added `exchanges` field.

Three related but distinct config concepts, all centralized in `scripts/common/__init__.py`:

| Concept | Meaning | Current value |
|---|---|---|
| `SUPPORTED_EXCHANGES` | Exchanges the app has a verified StockEdge API integration for at all (derived from `EXCHANGE_API_CODES.keys()`). Informational only — never itself offered as a selectable option. | `["NSE"]` |
| `ENABLED_EXCHANGES` | Exchanges actually turned on for extraction today. The **only** values any exchange picker in the UI may offer. | `["NSE"]` |
| `DEFAULT_EXCHANGES` | Pre-selected subset of `ENABLED_EXCHANGES` when the user hasn't chosen (env: `DEFAULT_EXCHANGES`, comma-separated; `DEFAULT_EXCHANGE` singular still accepted for compatibility). | `["NSE"]` |

The frontend never hard-codes any of these lists — it fetches all three (plus `available_exchanges`, whatever's actually in the DB) from the existing `GET /api/deals/exchanges` endpoint, reused rather than duplicated for this UI.

### Multi-select behavior

- Rendered as a checkbox group (not a dropdown) so multiple simultaneous selections are visually unambiguous.
- Defaults to `DEFAULT_EXCHANGES` (currently just NSE) on page load.
- The user can select any non-empty subset of `ENABLED_EXCHANGES`; deselecting down to zero disables the "Trigger Deals Ingestion" button and shows "Please select at least one exchange."
- Selections are de-duplicated by construction (checkbox state, not free text) — a duplicate value is structurally impossible.

### Request/response shape

`POST /api/system/run-script` body (script_key unchanged, `args` unchanged, new field added):
```json
{ "script_key": "insider_data_extractor", "args": [], "exchanges": ["NSE"] }
```
Backend (`backend/routers/system.py:run_script`): normalizes (uppercase, de-dupe), defaults to `DEFAULT_EXCHANGES` when `exchanges` is omitted entirely, rejects an explicitly empty list ("Please select at least one exchange."), and rejects **the whole request** if *any* selected exchange isn't in `ENABLED_EXCHANGES` — e.g. `["NSE", "BSE"]` with only NSE enabled returns `400: "Exchange BSE is not currently enabled."` and launches nothing; it never silently drops BSE and proceeds with NSE alone. Once validated, every exchange is passed through the **same existing** subprocess mechanism as `--exchange NSE BSE ...` CLI arguments — the extractor script itself (`stockedge_deals_extractor.py`) validates identically and scopes both its per-exchange API loop and its post-fetch eligibility filter to exactly the requested exchange(s).

## 8. Clear All Insider & Deal Data

A destructive action added to the same System Health card, gated behind an explicit "type CLEAR to confirm" modal (`POST /api/system/insider-data/clear`, body `{"confirmation": "CLEAR"}` — no other value is accepted, and the frontend never sends SQL or table names).

**Deletes** (single transaction — `backend/database.py:get_db_cursor(commit=True)` rolls back everything on any failure, so the database is never left partially cleared):
- `stockedge_insider_deals`, `stockedge_sast_deals`, `stockedge_block_deals`, `stockedge_bulk_deals` — the four raw pipeline tables. `stockedge_all_deals_view` is a `VIEW` over these four, so it empties automatically.
- `insider_conviction_scores` — the Insider Conviction Engine's persisted score snapshots. These are derived entirely from the deal tables above, so they're cleared in the same transaction rather than left displaying scores for data that no longer exists.

**Never touched**: `nse_equity_eod` (NSE EOD market data), `security_mappings` / `security_mapping_history` (SymbolMatcher manual and automated mappings — governance/config data, not raw deal data, and explicitly required to survive a data clear), and every other application table. No foreign key exists between the four cleared tables and anything preserved, so no `CASCADE` or special deletion ordering is needed — confirmed by inspecting `scripts/insider_data_extractor/database.py`'s schema (only FK in the whole insider/deal/mapping schema is `security_mapping_history.mapping_id -> security_mappings.id`, unrelated to the cleared tables).

**Dependent surfaces after a clear**: Smart Screener and Stock Intelligence compute everything live from the database on every request (no server-side cache), so they reflect the cleared state on their very next request with no separate invalidation step needed. The backtester likewise never persists results — it queries live on each run — so there is no stored/stale backtest result to go invalid; a backtest run *after* clearing simply reflects the (now empty) insider/deal data, same as it would with any other real data change.

**Security limitation**: this project has no authentication/authorization layer at all (confirmed: no auth middleware or dependency exists anywhere in `backend/`). The clear-data endpoint is therefore only as protected as the rest of the API — anyone who can reach `/api/system/*` can call it (with the correct confirmation string). This is a pre-existing, application-wide limitation, not something introduced by this feature, and is called out here rather than silently accepted.
