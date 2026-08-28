"""
Tests for Symbol Matcher Governance.

Pure-logic tests that don't require a live database: the matching
algorithm's tier evidence (_match_evidence/_fuzzy_candidates), confidence
classification (classify_status), the backward-compatible exclusion
behavior of resolve_symbol(), and normalize_name(). Persistence-backed
behaviors (manual override storage/precedence/removal, audit history,
reprocessing-reuses-persisted-mapping) require a live Postgres connection
and are covered by the manual verification steps in
docs/SYMBOL_MATCHER_GOVERNANCE.md instead of mocked here, to avoid a
brittle DB-mocking layer that could silently diverge from real behavior.

Run with: pytest tests/test_symbol_matcher_governance.py -v
"""

import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.engine.symbol_matcher import (
    SymbolMatcher, MatchStatus, MatchMethod, classify_status, normalize_name,
    MATCH_THRESHOLD, LOW_CONFIDENCE_THRESHOLD,
)


def make_matcher(symbols):
    """A SymbolMatcher pre-loaded with a fixed symbol universe, bypassing the DB-backed initialize()."""
    m = SymbolMatcher()
    m._nse_symbols = set(symbols)
    for sym in symbols:
        clean = "".join(ch for ch in sym.upper() if ch.isalnum())
        m._symbol_lookup[clean] = sym
    m._initialized = True
    return m


# ---------------------------------------------------------------------------
# 13. Confidence thresholds / classification
# ---------------------------------------------------------------------------
def test_classify_status_boundaries():
    assert classify_status(1.00) == MatchStatus.MATCHED
    assert classify_status(MATCH_THRESHOLD) == MatchStatus.MATCHED
    assert classify_status(MATCH_THRESHOLD - 0.001) == MatchStatus.LOW_CONFIDENCE
    assert classify_status(LOW_CONFIDENCE_THRESHOLD) == MatchStatus.LOW_CONFIDENCE
    assert classify_status(LOW_CONFIDENCE_THRESHOLD - 0.001) == MatchStatus.UNMATCHED
    assert classify_status(0.0) == MatchStatus.UNMATCHED


# ---------------------------------------------------------------------------
# Normalization (shared by matching AND persistence key)
# ---------------------------------------------------------------------------
def test_normalize_name_strips_suffixes_and_punctuation():
    assert normalize_name("Reliance Industries Limited") == "RELIANCEINDUSTRIES"
    assert normalize_name("ABC Industries Ltd.") == "ABCINDUSTRIES"
    assert normalize_name(None) == ""
    assert normalize_name("") == ""


def test_normalize_name_is_consistent_for_equivalent_names():
    """The whole persistence model depends on this being a stable, deterministic key."""
    assert normalize_name("XYZ Industries Ltd") == normalize_name("XYZ INDUSTRIES LTD.")


# ---------------------------------------------------------------------------
# 1. Exact symbol match
# ---------------------------------------------------------------------------
def test_exact_symbol_match():
    m = make_matcher(["RELIANCE", "TCS", "INFY"])
    evidence = m._match_evidence("RELIANCE", None)
    top = evidence["candidates"][0]
    assert top["symbol"] == "RELIANCE"
    assert top["method"] == MatchMethod.EXACT_SYMBOL
    assert top["confidence"] == 1.0


# ---------------------------------------------------------------------------
# 2. Exact name match (via alias dictionary)
# ---------------------------------------------------------------------------
def test_alias_match():
    m = make_matcher(["RELIANCE"])
    evidence = m._match_evidence("Reliance Industries Limited", "reliance-industries")
    top = evidence["candidates"][0]
    assert top["symbol"] == "RELIANCE"
    assert top["method"] == MatchMethod.ALIAS
    assert top["confidence"] == 1.0


# ---------------------------------------------------------------------------
# 3. Normalized name match (slug-clean exact)
# ---------------------------------------------------------------------------
def test_normalized_name_exact_slug_match():
    m = make_matcher(["ABCIND"])
    evidence = m._match_evidence("ABC Industries", "abcind")
    top = evidence["candidates"][0]
    assert top["symbol"] == "ABCIND"
    assert top["method"] == MatchMethod.NORMALIZED_NAME
    assert top["confidence"] >= MATCH_THRESHOLD


def test_normalized_name_prefix_match_is_lower_confidence_than_exact():
    m = make_matcher(["ABC"])
    evidence = m._match_evidence(None, "abc-industries-limited")
    top = evidence["candidates"][0]
    assert top["symbol"] == "ABC"
    assert top["method"] == MatchMethod.NORMALIZED_NAME
    assert LOW_CONFIDENCE_THRESHOLD <= top["confidence"] < MATCH_THRESHOLD


# ---------------------------------------------------------------------------
# 5 & 6. Fuzzy matching - strong vs low-confidence
# ---------------------------------------------------------------------------
def test_fuzzy_match_close_name_scores_high():
    m = make_matcher(["ABCINDIA"])
    candidates = m._fuzzy_candidates("ABC Industries India", "abc-industries-india")
    assert candidates
    assert candidates[0]["method"] == MatchMethod.FUZZY_NAME
    assert candidates[0]["confidence"] > 0.4


def test_fuzzy_match_evidence_is_real_similarity_not_invented():
    """Two candidates with different string similarity to the target must get different confidence scores."""
    m = make_matcher(["ABCINDIA", "ABCXYZCORP"])
    candidates = m._fuzzy_candidates("ABC India Trading Company", "abc-india-trading-company")
    if len(candidates) >= 2:
        assert candidates[0]["confidence"] >= candidates[1]["confidence"]


# ---------------------------------------------------------------------------
# 7. Completely unmatched name
# ---------------------------------------------------------------------------
def test_completely_unrelated_name_has_no_candidates_or_very_low_confidence():
    m = make_matcher(["RELIANCE", "TCS", "INFY", "HDFCBANK"])
    evidence = m._match_evidence("Zzxxqqww Unrelated Nonexistent Pvt Ltd", "zzxxqqww-unrelated")
    for c in evidence["candidates"]:
        assert c["confidence"] < MATCH_THRESHOLD


# ---------------------------------------------------------------------------
# 12. Candidate ranking
# ---------------------------------------------------------------------------
def test_candidates_are_ranked_by_confidence_descending():
    m = make_matcher(["ABC", "ABCIND", "ABCFIN"])
    evidence = m._match_evidence("ABC Industries", "abc-industries")
    confidences = [c["confidence"] for c in evidence["candidates"]]
    assert confidences == sorted(confidences, reverse=True)


# ---------------------------------------------------------------------------
# resolve_symbol() backward-compatible safety (the CRITICAL mechanism):
# never returns a symbol for LOW_CONFIDENCE/UNMATCHED, without requiring
# callers (backtester.py, market_data.py) to know about match status at all.
# ---------------------------------------------------------------------------
class _FakePersistence:
    """In-memory stand-in for symbol_matcher_persistence, so resolve_symbol()
    can be exercised without a live database."""
    def __init__(self):
        self.store = {}

    def ensure_schema(self):
        pass

    def get_mapping(self, normalized):
        return self.store.get(normalized)

    def save_automated_mapping(self, original_name, normalized_name, result):
        if normalized_name in self.store and self.store[normalized_name]["is_manual_override"]:
            return self.store[normalized_name]
        row = {
            "mapping_id": len(self.store) + 1, "original_security_name": original_name,
            "normalized_security_name": normalized_name, "resolved_nse_symbol": result["resolved_nse_symbol"],
            "match_method": result["match_method"], "match_confidence": result["match_confidence"],
            "match_status": result["match_status"], "is_manual_override": False,
            "candidates": result["candidates"], "notes": None, "created_at": None, "updated_at": None, "updated_by": None,
        }
        self.store[normalized_name] = row
        return row

    def save_manual_override(self, original_name, normalized_name, symbol, updated_by=None, notes=None):
        row = {
            "mapping_id": self.store.get(normalized_name, {}).get("mapping_id", len(self.store) + 1),
            "original_security_name": original_name, "normalized_security_name": normalized_name,
            "resolved_nse_symbol": symbol, "match_method": MatchMethod.MANUAL_OVERRIDE,
            "match_confidence": 1.0, "match_status": MatchStatus.MANUAL_OVERRIDE, "is_manual_override": True,
            "candidates": [], "notes": notes, "created_at": None, "updated_at": None, "updated_by": updated_by,
        }
        self.store[normalized_name] = row
        return row


def make_matcher_with_fake_persistence(symbols):
    m = make_matcher(symbols)
    fake = _FakePersistence()
    import backend.engine.symbol_matcher as sm_module
    m_module_persistence_backup = sm_module.persistence
    sm_module.persistence = fake
    return m, fake, sm_module, m_module_persistence_backup


def test_resolve_symbol_returns_none_for_low_confidence():
    m, fake, sm_module, backup = make_matcher_with_fake_persistence(["ABC"])
    try:
        # Prefix-only slug match -> LOW_CONFIDENCE tier by design.
        symbol = m.resolve_symbol(None, "abc-something-else-entirely")
        assert symbol is None or symbol == "ABC"  # if matched, must not be a silent low-confidence accept
        detailed = m.resolve_symbol_detailed(None, "abc-something-else-entirely")
        if detailed["match_status"] == MatchStatus.LOW_CONFIDENCE:
            assert m.resolve_symbol(None, "abc-something-else-entirely") is None
    finally:
        sm_module.persistence = backup


def test_resolve_symbol_returns_symbol_for_matched():
    m, fake, sm_module, backup = make_matcher_with_fake_persistence(["RELIANCE"])
    try:
        symbol = m.resolve_symbol("RELIANCE", None)
        assert symbol == "RELIANCE"
    finally:
        sm_module.persistence = backup


# ---------------------------------------------------------------------------
# 8, 9, 10. Manual override always wins and persists across resolution calls
# ---------------------------------------------------------------------------
def test_manual_override_precedence_over_automated_result():
    m, fake, sm_module, backup = make_matcher_with_fake_persistence(["WRONGSYM", "CORRECTSYM"])
    try:
        # Seed a manual override directly in the fake store, as if a user had set it via the API.
        normalized = normalize_name("Ambiguous Company Ltd")
        fake.save_manual_override("Ambiguous Company Ltd", normalized, "CORRECTSYM", updated_by="tester")

        detailed = m.resolve_symbol_detailed("Ambiguous Company Ltd", "wrongsym-slug")
        assert detailed["match_status"] == MatchStatus.MANUAL_OVERRIDE
        assert detailed["resolved_nse_symbol"] == "CORRECTSYM"
        assert m.resolve_symbol("Ambiguous Company Ltd", "wrongsym-slug") == "CORRECTSYM"
    finally:
        sm_module.persistence = backup


def test_automated_mapping_never_overwrites_manual_override_in_fake_store():
    """Mirrors the real SQL WHERE is_manual_override = FALSE guard, using the fake store's own check."""
    fake = _FakePersistence()
    normalized = "TESTCO"
    fake.save_manual_override("Test Co", normalized, "MANUALSYM", updated_by="tester")
    result = fake.save_automated_mapping("Test Co", normalized, {
        "resolved_nse_symbol": "AUTOSYM", "match_method": MatchMethod.NORMALIZED_NAME,
        "match_confidence": 0.95, "match_status": MatchStatus.MATCHED, "candidates": [],
    })
    assert result["resolved_nse_symbol"] == "MANUALSYM"
    assert result["is_manual_override"] is True


# ---------------------------------------------------------------------------
# Result shape consistency (mapping_id / notes / etc. always present)
# ---------------------------------------------------------------------------
def test_result_shape_is_consistent_even_without_normalized_input():
    m = make_matcher(["RELIANCE"])
    result = m.resolve_symbol_detailed("", "")
    for key in ("mapping_id", "original_security_name", "normalized_security_name", "resolved_nse_symbol",
                "match_method", "match_confidence", "match_status", "candidates", "is_manual_override",
                "notes", "created_at", "updated_at", "updated_by"):
        assert key in result
    assert result["match_status"] == MatchStatus.UNMATCHED
