# Symbol Matcher Governance

## 1. Why this exists

Every insider/deal record in this platform is only as trustworthy as the symbol resolution behind it — an incorrect company→NSE-symbol mapping silently corrupts price association, backtests, Conviction scores, screener results, and historical signal analysis. This phase adds **governance**: every resolution now carries an explicit method, an evidence-based confidence score, and one of four statuses — and only the two "trustworthy" statuses are ever used for analysis by default.

## 2. The matching pipeline (unchanged tiers, new instrumentation)

```
Original Security Name / Slug
        ↓
Manual override lookup (security_mappings, is_manual_override=TRUE)  → MANUAL_OVERRIDE (always wins, never recomputed)
        ↓ (no override)
Persisted automated mapping lookup (security_mappings)                → reused as-is (no re-matching)
        ↓ (no persisted result yet)
Tier 1: Curated alias dictionary                                      → ALIAS, confidence 1.00
Tier 2: Slug cleaned → exact / prefix match vs NSE symbols             → NORMALIZED_NAME, 0.92 / 0.80
Tier 3: Security name cleaned → exact match; or name IS a symbol       → NORMALIZED_NAME 0.92 / EXACT_SYMBOL 1.00
Tier 4 (ONLY if tiers 1-3 found nothing): difflib similarity ranking   → FUZZY_NAME, real similarity ratio
        ↓
classify_status(confidence) → MATCHED / LOW_CONFIDENCE / UNMATCHED
        ↓
Persisted to security_mappings, cached in-memory
```

Tiers 1–3 are the **original** implementation (`backend/engine/symbol_matcher.py`), unchanged in substance — only instrumented with method/confidence. Tier 4 is genuinely upgraded: it used to be a crude "does any word literally appear in the symbol" check with no confidence concept at all; it now computes a real `difflib.SequenceMatcher` similarity ratio (Python stdlib, no new dependency) over a token-prefiltered candidate set, so its confidence is real evidence, not an invented number. Tier 4 only ever runs as a genuine last resort — if any earlier tier produced a candidate, fuzzy matching is skipped entirely, so a coincidentally high fuzzy score can never "steal" credit from a more authoritative exact/normalized match.

## 3. Confidence values (documented, not invented)

| Method | Confidence | Rationale |
|---|---|---|
| ALIAS | 1.00 | Curated, human-verified mapping dictionary |
| EXACT_SYMBOL | 1.00 | The input string literally IS a valid NSE symbol |
| NORMALIZED_NAME (exact clean match) | 0.92 | Slug/name fully matches a symbol after stripping punctuation/corporate suffixes |
| NORMALIZED_NAME (prefix match) | 0.80 | Only the first token of the slug matches a symbol — partial evidence |
| FUZZY_NAME | `difflib.SequenceMatcher(...).ratio()` | Real string-similarity evidence, varies per case |

## 4. Thresholds (centralized in `backend/engine/symbol_matcher.py`)

```python
MATCH_THRESHOLD = 0.90          # >= this -> MATCHED
LOW_CONFIDENCE_THRESHOLD = 0.70  # >= this (below MATCH_THRESHOLD) -> LOW_CONFIDENCE
                                 # below this -> UNMATCHED
```

## 5. Status definitions

| Status | Meaning |
|---|---|
| `MATCHED` | Confidence ≥ 0.90 — safe to use everywhere |
| `LOW_CONFIDENCE` | 0.70 ≤ confidence < 0.90 — a candidate exists but is not auto-trusted |
| `UNMATCHED` | Confidence < 0.70, or no candidate produced at all |
| `MANUAL_OVERRIDE` | An explicit user mapping — always wins, confidence 1.00, never auto-recomputed |

## 6. The critical safety mechanism

`SymbolMatcher.resolve_symbol()` — the original, simple API every existing caller (`backend/engine/backtester.py`, `backend/engine/conviction/market_data.py`) already used — is now a thin wrapper around the new `resolve_symbol_detailed()`. It returns a symbol **only** when status is `MATCHED` or `MANUAL_OVERRIDE`, and `None` otherwise. This means every existing caller became governance-safe **without needing to change its resolution call at all**. On top of that automatic safety, the call sites that need visible reporting (not silent exclusion) were explicitly updated to use `resolve_symbol_detailed()` and tally an audit:

- `backend/engine/backtester.py:run_backtest` — attaches a `symbol_mapping_audit` block (`total_transactions`, `matched`, `manual_override`, `excluded_low_confidence`, `excluded_unmatched`) to every backtest result, and the frontend (`App.jsx`) shows a warning banner whenever anything was excluded.
- `backend/engine/conviction/market_data.py:load_symbol_deals` / `load_active_symbols` — accept an optional `audit` dict (mutated in place) so Conviction/Screener/Stock Intelligence can all surface the same information via `data_quality.symbol_mapping_audit`, without changing their call signatures for callers that don't need it.

**No LOW_CONFIDENCE or UNMATCHED deal is ever silently used for backtesting, Conviction scoring, screening, or historical signal analysis** — this is enforced at the single lowest layer (`resolve_symbol`), not re-implemented per feature.

## 7. Persistence

Two additive-only tables (no existing table modified):

- **`security_mappings`** — one row per distinct company, keyed by `normalized_security_name` (unique index). The SAME `normalize_name()` function is used both as the matching input and the persistence key, so there is exactly one normalization definition anywhere in the system.
- **`security_mapping_history`** — append-only audit trail (`mapping_id` with `ON DELETE SET NULL`, `normalized_security_name` denormalized onto the row) so history survives even if a mapping is later removed.

Manual overrides are protected **at the SQL level**: `save_automated_mapping`'s `ON CONFLICT ... DO UPDATE ... WHERE is_manual_override = FALSE` guarantees an automated re-match can never silently overwrite a manual override, even under concurrent writes — if the WHERE blocks the update, the code falls back to reading and returning the (untouched) existing override.

Deal-level resolution info is **not** stored as new columns on the raw deal tables (`stockedge_*_deals`) — that would duplicate data and require migrating 4 tables. Instead, every deal already carries `security_name`, and any deal's mapping is a cheap indexed lookup by `normalize_name(security_name)` against `security_mappings` — the linkage is inherent, not duplicated.

## 8. Manual override workflow

`POST /api/symbol-matcher/mapping` validates the target symbol against the real NSE reference data (`nse_equity_eod`) before accepting it, then upserts a `MANUAL_OVERRIDE` row and records the transition in `security_mapping_history`. `DELETE /api/symbol-matcher/mapping/{id}` removes the override (the security reverts to automated matching on its next resolution) while preserving the audit trail. Overrides survive application restarts (persisted in Postgres) and are never recomputed by automated reprocessing.

## 9. API

| Endpoint | Purpose |
|---|---|
| `GET /api/symbol-matcher/unmatched` | Securities with no reliable NSE symbol |
| `GET /api/symbol-matcher/low-confidence` | Securities with a candidate below the acceptance threshold |
| `GET /api/symbol-matcher/mappings` | All persisted mappings (search/status filter) |
| `GET /api/symbol-matcher/candidates/{security_name}` | Full evidence + ranked candidates for one security |
| `POST /api/symbol-matcher/mapping` | Create/replace a manual override |
| `PUT /api/symbol-matcher/mapping/{id}` | Update an existing mapping's override |
| `DELETE /api/symbol-matcher/mapping/{id}` | Remove a manual override (reverts to automated) |
| `GET /api/symbol-matcher/history/{id}` | Audit trail for one mapping |

The unmatched/low-confidence/mappings list endpoints enrich each row with deal-count, latest-deal-date, deal categories, and total transaction value — computed by grouping `stockedge_all_deals_view` in Python using the **same** `normalize_name()` function the matcher itself uses, guaranteeing the grouping key matches exactly how resolution groups companies (rather than risking a second, potentially-divergent SQL-side normalization).

## 10. Frontend

- **Symbol Matching** (new nav tab) — tabbed review queues (Unmatched / Low Confidence / Manual Overrides / Matched / All), search, a "Map" modal showing ranked candidates with confidence + a manual-symbol fallback input, and an expandable audit-history view per row.
- **Backtesting Lab** — an amber warning banner appears whenever `symbol_mapping_audit` reports any excluded transactions, stating the exact excluded/total counts and the LOW_CONFIDENCE vs UNMATCHED breakdown — never silent.
- **Stock Intelligence** — each transaction in the Recent Transactions table shows a small `MATCHED` / `MANUAL_OVERRIDE` mapping badge (transactions reaching this list have already passed the eligibility gate, so only these two statuses ever appear there).

## 11. Performance

- The in-memory `_detailed_cache` (keyed by normalized name) is shared by both `resolve_symbol()` and `resolve_symbol_detailed()`, so mixing the two APIs for the same security never triggers a redundant DB lookup or re-match within a process's lifetime.
- Persisted automated mappings are reused as-is on every subsequent resolution (no re-matching), and manual overrides are never recomputed at all.
- Fuzzy matching (`difflib`) only ever runs when tiers 1–3 produce nothing, and only scores a token-prefiltered candidate set — never the full ~4,000-symbol universe.

## 12. Known limitations

- The `security_mappings` unique key is `normalized_security_name`; two genuinely different companies that happen to normalize to the same string (a rare edge case) would collide. This mirrors how the underlying matching algorithm itself already treats normalized names as the equivalence class.
- Persistence-backed behaviors (manual override storage/precedence/removal against a real Postgres instance, reprocessing reusing a persisted row) are covered by manual verification rather than DB-mocked unit tests, to avoid a mocking layer that could silently diverge from real Postgres semantics (especially the `ON CONFLICT ... WHERE` guard, which is genuinely SQL-specific behavior).
- Bulk mapping review (reviewing many securities in one action) was explicitly out of scope for this phase per the spec's own prioritization — single-company manual mapping is the reliable baseline this phase delivers.

## 13. Exchange scoping fix — input-side filtering, not output-side hiding

**Root cause found**: the matcher's *target/output* universe (`_nse_symbols`, loaded from `nse_equity_eod`) was already NSE-only by construction — it structurally cannot resolve a BSE ticker, because `nse_equity_eod` contains no BSE data. The bug was on the *input* side: the three places that feed deal rows into `matcher.resolve_symbol_detailed()` — `backend/engine/conviction/market_data.py` (`load_symbol_deals`, `load_active_symbols`), `backend/engine/backtester.py` (`load_deals`), and `backend/routers/symbol_matcher.py` (`_deal_stats_by_normalized_name`) — queried `stockedge_all_deals_view` with **no exchange filter at all**. Every deal ever ingested (including pre-existing BSE-origin rows from before the pipeline's own exchange filter existed, or from deal categories that had no exchange-scoped API param) was fed into matching and into the Symbol Matching review queues, regardless of its own `exchange_name`.

**Fix**: all four queries now add `WHERE UPPER(exchange_name) = ANY(%s)` bound to `scripts.common.ENABLED_EXCHANGES` — filtering happens *before* a deal is ever handed to the matcher, not by hiding an already-matched result afterward. A company whose deals are all on a disabled exchange is simply never considered for matching at all.

**Explicit `resolved_exchange` field**: every match result (`_result_shape()` in `symbol_matcher.py`, `_row_to_result()` in `symbol_matcher_persistence.py`) now carries a `resolved_exchange` field — `"NSE"` (the constant `RESOLVED_EXCHANGE`) when a symbol is resolved, `None` otherwise. This makes the "resolved exchange = enabled exchange" invariant an explicit, checkable field instead of an implicit assumption, and the Symbol Matching UI surfaces it as an "Exchange" column (an `UNKNOWN` badge would indicate a resolved symbol that predates a matcher fix and no longer exists in the current NSE universe — this should never appear going forward).

**Hard validation** (`GET /api/symbol-matcher/validate`): counts every persisted mapping — manual or automatic — whose `resolved_nse_symbol` is not literally present in the *current* `nse_equity_eod` symbol set. Being labeled "NSE" is not sufficient on its own (per the spec: a symbol must actually exist in the valid reference universe, not merely carry the label). Invalid manual overrides are surfaced for human review and **never** auto-modified or auto-deleted — a human must explicitly choose the correct NSE symbol.

**Clear & Re-Match** (`POST /api/symbol-matcher/rematch`, confirmation-gated with the exact string `"CLEAR"`): deletes every *automatic* mapping (`is_manual_override = FALSE` — manual overrides are never touched), clears the in-memory cache, and re-runs matching for every distinct security across all `ENABLED_EXCHANGES` deals using the corrected, exchange-filtered query above. Returns real, DB-sourced status counts (`MATCHED`/`LOW_CONFIDENCE`/`UNMATCHED`/`MANUAL_OVERRIDE`) and the remaining invalid-symbol count — never fabricated numbers.
