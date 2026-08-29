"""
Tests for the NSE-only exchange scoping fix in the Symbol Matcher.

Root cause: the matcher's TARGET universe (_nse_symbols, loaded from
nse_equity_eod) was already NSE-only by construction - it structurally
cannot produce a BSE symbol as output. The bug was on the INPUT side:
market_data.py/backtester.py/symbol_matcher.py router queried
stockedge_all_deals_view with no exchange filter at all, feeding
deals from any exchange into matching. That fix (adding
WHERE UPPER(exchange_name) = ANY(%s) to those four queries) is a SQL-level
change verified by code review, not unit-tested here - mirrors this
project's existing convention (see test_symbol_matcher_governance.py's
own docstring) of not building a DB-mocking layer for persistence/query
behavior that could silently diverge from real Postgres semantics.

What IS covered here with pure logic (no DB): the structural guarantee
that the matcher can never produce a candidate outside its NSE universe,
that a BSE-only (no NSE overlap) company correctly becomes UNMATCHED with
resolved_exchange=None, the new resolved_exchange field's correctness, and
is_symbol_currently_valid()'s hard-validation logic for manual overrides.

Deferred to manual verification against a live database (per the project's
"skip test execution" instruction and the same rationale as
test_symbol_matcher_governance.py): the four SQL exchange filters
themselves, duplicate-mapping prevention (unique index), the
POST /api/symbol-matcher/rematch and GET /api/symbol-matcher/validate
endpoints end-to-end, and the final "zero BSE/invalid mappings" count.

Run with: pytest tests/test_symbol_matcher_exchange_scope.py -v
"""

import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.engine.symbol_matcher import (
    SymbolMatcher, MatchStatus, RESOLVED_EXCHANGE, is_symbol_currently_valid,
)


def make_matcher(symbols):
    """A SymbolMatcher pre-loaded with a fixed (NSE-only, by construction) symbol universe."""
    m = SymbolMatcher()
    m._nse_symbols = set(symbols)
    for sym in symbols:
        clean = "".join(ch for ch in sym.upper() if ch.isalnum())
        m._symbol_lookup[clean] = sym
    m._initialized = True
    return m


# ---------------------------------------------------------------------------
# 4, 6, 7. The matcher structurally cannot produce a non-NSE candidate -
# there is no BSE universe in memory to select from in the first place.
# ---------------------------------------------------------------------------
def test_all_candidates_are_within_the_nse_universe():
    m = make_matcher(["RELIANCE", "TCS", "ABCIND"])
    evidence = m._match_evidence("ABC Industries", "abcind")
    for c in evidence["candidates"]:
        assert c["symbol"] in m._nse_symbols


def test_fuzzy_candidates_never_include_a_symbol_outside_the_loaded_universe():
    m = make_matcher(["ABCINDIA"])
    candidates = m._fuzzy_candidates("ABC Industries India", "abc-industries-india")
    for c in candidates:
        assert c["symbol"] in m._nse_symbols


# ---------------------------------------------------------------------------
# 5. A company that only ever trades on a disabled exchange (no NSE-name
# overlap at all) must become UNMATCHED, never fall back to a coincidental
# or foreign symbol.
# ---------------------------------------------------------------------------
def test_bse_only_company_with_no_nse_overlap_is_unmatched():
    m = make_matcher(["RELIANCE", "TCS", "INFY", "HDFCBANK"])
    result = m._match_evidence("Zzxxqqww Exchange Only Company Pvt Ltd", "zzxxqqww-exchange-only")
    # Either no candidates at all, or none clear MATCH_THRESHOLD.
    from backend.engine.symbol_matcher import MATCH_THRESHOLD
    assert all(c["confidence"] < MATCH_THRESHOLD for c in result["candidates"])


# ---------------------------------------------------------------------------
# resolved_exchange field: present, correct, and only set when there's
# actually a resolved symbol to attribute it to.
# ---------------------------------------------------------------------------
def test_resolved_exchange_is_nse_when_matched():
    # resolve_symbol_detailed() touches persistence (DB) - _result_shape()
    # is the pure function that actually sets resolved_exchange, so it is
    # tested directly rather than through the DB-backed call.
    from backend.engine.symbol_matcher import _result_shape
    shape = _result_shape(
        original_security_name="RELIANCE", normalized_security_name="RELIANCE",
        resolved_nse_symbol="RELIANCE", match_method="EXACT_SYMBOL",
        match_confidence=1.0, match_status=MatchStatus.MATCHED, candidates=[],
    )
    assert shape["resolved_exchange"] == RESOLVED_EXCHANGE
    assert shape["resolved_exchange"] == "NSE"


def test_resolved_exchange_is_none_when_unmatched():
    from backend.engine.symbol_matcher import _result_shape
    shape = _result_shape(
        original_security_name="Unknown Co", normalized_security_name="UNKNOWNCO",
        resolved_nse_symbol=None, match_method="NONE",
        match_confidence=0.0, match_status=MatchStatus.UNMATCHED, candidates=[],
    )
    assert shape["resolved_exchange"] is None


# ---------------------------------------------------------------------------
# 8, 9, 19. Hard validation: a resolved symbol is only trustworthy if it
# still exists in the CURRENT NSE reference universe - being labeled "NSE"
# is not enough on its own.
# ---------------------------------------------------------------------------
def test_is_symbol_currently_valid_true_for_symbol_in_universe():
    assert is_symbol_currently_valid("RELIANCE", {"RELIANCE", "TCS"}) is True


def test_is_symbol_currently_valid_false_for_symbol_not_in_universe():
    """Simulates an invalid/stale manual override pointing to a symbol that no longer resolves against NSE."""
    assert is_symbol_currently_valid("SOMEOLDBSESYMBOL", {"RELIANCE", "TCS"}) is False


def test_is_symbol_currently_valid_true_when_nothing_to_validate():
    assert is_symbol_currently_valid(None, {"RELIANCE", "TCS"}) is True


def test_is_symbol_currently_valid_is_case_insensitive():
    assert is_symbol_currently_valid("reliance", {"RELIANCE"}) is True


# ---------------------------------------------------------------------------
# 17. Re-match operation's cache-clearing step (pure in-memory behavior).
# ---------------------------------------------------------------------------
def test_clear_cache_empties_detailed_cache():
    m = make_matcher(["RELIANCE"])
    m._detailed_cache["SOMECOMPANY"] = {"resolved_nse_symbol": "RELIANCE"}
    assert len(m._detailed_cache) == 1
    m.clear_cache()
    assert len(m._detailed_cache) == 0


def test_get_valid_nse_symbols_returns_a_copy_not_the_live_set():
    m = make_matcher(["RELIANCE", "TCS"])
    valid = m.get_valid_nse_symbols()
    valid.add("INJECTED")
    assert "INJECTED" not in m._nse_symbols
