"""
Symbol Matcher Engine — with governance (Phase: Symbol Matcher Governance).
Resolves StockEdge security names and slugs to exact NSE trading symbols in nse_equity_eod.

GOVERNANCE MODEL
----------------
Every resolution attempt produces a MatchResult with an explicit method,
a confidence score backed by real matching evidence (never invented), and
one of four statuses:

    MATCHED          - confidence >= MATCH_THRESHOLD
    LOW_CONFIDENCE   - LOW_CONFIDENCE_THRESHOLD <= confidence < MATCH_THRESHOLD
    UNMATCHED        - confidence < LOW_CONFIDENCE_THRESHOLD, or no candidate at all
    MANUAL_OVERRIDE  - a user explicitly mapped this security (always wins,
                        never overwritten by automated matching)

`resolve_symbol()` is the original, simple API every existing caller
already uses (backend/engine/backtester.py, backend/engine/conviction/
market_data.py). It is now a thin wrapper: it returns a symbol ONLY when
status is MATCHED or MANUAL_OVERRIDE, and None otherwise - so a stock is
NEVER silently treated as correctly matched when the match is uncertain,
without requiring every existing call site to change. Callers that need
the full evidence (confidence, method, candidates) call
`resolve_symbol_detailed()` instead.

Resolutions are persisted in the security_mappings table (see
symbol_matcher_persistence.py) keyed by normalized security name, so the
same company is only ever matched once - subsequent lookups (including
after an application restart) reuse the persisted result instead of
re-running matching.
"""

import re
import difflib
import logging
from typing import Dict, List, Optional, Set, Any

try:
    from backend.database import fetch_all
    from backend.engine import symbol_matcher_persistence as persistence
except ImportError:
    from ..database import fetch_all
    from . import symbol_matcher_persistence as persistence

logger = logging.getLogger(__name__)

# The exchange nse_equity_eod's price/candle data belongs to - NOT the same
# concept as scripts.common.ENABLED_EXCHANGES (which governs which
# exchanges' DEALS are extracted). This matcher's entire candidate/target
# universe (_nse_symbols) is loaded from nse_equity_eod, which today
# contains NSE data exclusively by construction of the NSE EOD pipeline
# (scripts/nse_eod/) - there is no per-exchange EOD dataset to choose
# between yet, so every resolved symbol is, by construction, an NSE symbol.
RESOLVED_EXCHANGE = "NSE"

# ---------------------------------------------------------------------------
# Governance constants (centralized - nothing below is duplicated elsewhere)
# ---------------------------------------------------------------------------
class MatchStatus:
    MATCHED = "MATCHED"
    LOW_CONFIDENCE = "LOW_CONFIDENCE"
    UNMATCHED = "UNMATCHED"
    MANUAL_OVERRIDE = "MANUAL_OVERRIDE"


class MatchMethod:
    """Only methods that actually exist in this implementation - nothing aspirational."""
    EXACT_SYMBOL = "EXACT_SYMBOL"        # the input itself is a valid NSE symbol
    ALIAS = "ALIAS"                       # curated MANUAL_MAPPINGS dictionary hit
    NORMALIZED_NAME = "NORMALIZED_NAME"   # slug/name cleaned (punctuation/suffix-stripped) and matched
    FUZZY_NAME = "FUZZY_NAME"             # difflib similarity ratio over a token-prefiltered candidate set
    MANUAL_OVERRIDE = "MANUAL_OVERRIDE"   # explicit user mapping
    NONE = "NONE"                         # no candidate could be produced at all


# Confidence assigned per method/tier. Each value reflects the actual
# strength of the evidence behind it - documented in
# docs/SYMBOL_MATCHER_GOVERNANCE.md - never an arbitrary guess.
CONFIDENCE_ALIAS = 1.00
CONFIDENCE_EXACT_SYMBOL = 1.00
CONFIDENCE_NORMALIZED_EXACT = 0.92
CONFIDENCE_NORMALIZED_PREFIX = 0.80
# FUZZY_NAME confidence is NOT a constant - it's the real difflib.SequenceMatcher
# ratio computed per candidate (see _fuzzy_candidates below).

MATCH_THRESHOLD = 0.90          # >= this -> MATCHED
LOW_CONFIDENCE_THRESHOLD = 0.70  # >= this (and < MATCH_THRESHOLD) -> LOW_CONFIDENCE; below -> UNMATCHED

# Common well-known manual mappings for prominent Indian stocks where slug differs from NSE symbol
MANUAL_MAPPINGS = {
    "hindustan-unilever": "HINDUNILVR",
    "info-edge-india": "NAUKRI",
    "tata-consultancy-services": "TCS",
    "reliance-industries": "RELIANCE",
    "state-bank-of-india": "SBIN",
    "housing-development-finance-corporation": "HDFC",
    "icici-bank": "ICICIBANK",
    "hdfc-bank": "HDFCBANK",
    "kotak-mahindra-bank": "KOTAKBANK",
    "axis-bank": "AXISBANK",
    "larsen-and-toubro": "LT",
    "mahindra-and-mahindra": "M&M",
    "bharat-petroleum-corporation": "BPCL",
    "hindustan-petroleum-corporation": "HPCL",
    "oil-and-natural-gas-corporation": "ONGC",
    "tata-motors": "TATAMOTORS",
    "tata-steel": "TATASTEEL",
    "tata-power": "TATAPOWER",
    "adani-enterprises": "ADANIENT",
    "adani-ports-and-special-economic-zone": "ADANIPORTS",
    "adani-green-energy": "ADANIGREEN",
    "adani-power": "ADANIPOWER",
    "bajaj-finance": "BAJFINANCE",
    "bajaj-finserv": "BAJAJFINSV",
    "bajaj-auto": "BAJAJ-AUTO",
    "sun-pharmaceutical-industries": "SUNPHARMA",
    "dr-reddys-laboratories": "DRREDDY",
    "cipla": "CIPLA",
    "bharti-airtel": "BHARTIARTL",
    "itc": "ITC",
    "wipro": "WIPRO",
    "infosys": "INFY",
    "hcl-technologies": "HCLTECH",
    "tech-mahindra": "TECHM",
    "maruti-suzuki-india": "MARUTI",
    "power-grid-corporation-of-india": "POWERGRID",
    "ntpc": "NTPC",
    "coal-india": "COALINDIA",
    "grasim-industries": "GRASIM",
    "ultratech-cement": "ULTRACEMCO",
    "asian-paints": "ASIANPAINT",
    "titan-company": "TITAN",
    "nestle-india": "NESTLEIND",
    "britannia-industries": "BRITANNIA",
    "eicher-motors": "EICHERMOT",
    "divis-laboratories": "DIVISLAB",
    "apollo-hospitals-enterprise": "APOLLOHOSP",
    "jsw-steel": "JSWSTEEL",
    "tata-consumer-products": "TATACONSUM",
    "ravindra-energy": "RAVINDRA",
    "trident-techlabs": "TRIDENT",
}


def normalize_name(security_name: Optional[str]) -> str:
    """
    Canonical normalization used as the security_mappings persistence key.
    Strips common corporate suffixes and non-alphanumeric characters,
    uppercased. The SAME function is used everywhere a "normalized name"
    is needed, so there is exactly one normalization definition.
    """
    if not security_name:
        return ""
    clean = re.sub(r"\b(LTD|LIMITED|INDIA|CORP|CORPORATION|INC|CO)\b", "", security_name.upper())
    return re.sub(r"[^A-Z0-9]", "", clean)


def classify_status(confidence: float) -> str:
    """Single source of truth for confidence -> status classification."""
    if confidence >= MATCH_THRESHOLD:
        return MatchStatus.MATCHED
    if confidence >= LOW_CONFIDENCE_THRESHOLD:
        return MatchStatus.LOW_CONFIDENCE
    return MatchStatus.UNMATCHED


def _result_shape(
    original_security_name: Optional[str],
    normalized_security_name: str,
    resolved_nse_symbol: Optional[str],
    match_method: str,
    match_confidence: float,
    match_status: str,
    candidates: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """
    Canonical MatchResult shape - used for every code path (persisted or
    not) so callers never need to guard against missing keys depending on
    whether persistence succeeded.
    """
    return {
        "mapping_id": None,
        "original_security_name": original_security_name,
        "normalized_security_name": normalized_security_name,
        "resolved_nse_symbol": resolved_nse_symbol,
        # Explicit, checkable field (rather than an implicit assumption)
        # that this resolution's target exchange is NSE - None when there
        # is no resolved symbol at all (nothing to attribute an exchange to).
        "resolved_exchange": RESOLVED_EXCHANGE if resolved_nse_symbol else None,
        "match_method": match_method,
        "match_confidence": match_confidence,
        "match_status": match_status,
        "is_manual_override": match_status == MatchStatus.MANUAL_OVERRIDE,
        "candidates": candidates,
        "notes": None,
        "created_at": None,
        "updated_at": None,
        "updated_by": None,
    }


def is_symbol_currently_valid(resolved_nse_symbol: Optional[str], valid_symbols: Set[str]) -> bool:
    """
    Pure re-validation check (no DB/cache access): a resolved symbol is only
    ever trustworthy if it still exists in the CURRENT NSE reference
    universe - being labeled "NSE" is not enough on its own (a persisted
    mapping could predate a matcher fix, or the symbol could have been
    delisted). A missing resolved_nse_symbol (nothing to validate, e.g. an
    UNMATCHED result) is treated as valid - there is no false claim to check.
    """
    if not resolved_nse_symbol:
        return True
    return resolved_nse_symbol.strip().upper() in valid_symbols


class SymbolMatcher:
    """Matches StockEdge company names/slugs to NSE EOD symbols, with full match governance."""

    def __init__(self):
        # Keyed by normalized_security_name - the SAME in-memory cache backs
        # both resolve_symbol_detailed() and resolve_symbol(), so a company
        # resolved once (whether via the simple or detailed API) is never
        # re-queried against the DB again within this process's lifetime.
        self._detailed_cache: Dict[str, Dict[str, Any]] = {}
        self._nse_symbols: Set[str] = set()
        self._symbol_lookup: Dict[str, str] = {}
        self._initialized = False

    def initialize(self):
        """Preloads distinct NSE symbols from database and ensures the mapping persistence schema exists."""
        if self._initialized:
            return

        try:
            rows = fetch_all("SELECT DISTINCT symbol FROM nse_equity_eod")
            self._nse_symbols = {r["symbol"].upper() for r in rows if r["symbol"]}
            for sym in self._nse_symbols:
                clean_key = re.sub(r"[^A-Z0-9]", "", sym)
                self._symbol_lookup[clean_key] = sym
            self._initialized = True
            logger.info(f"SymbolMatcher initialized with {len(self._nse_symbols)} NSE symbols.")
        except Exception as e:
            logger.warning(f"Could not load symbols for SymbolMatcher: {e}")

        try:
            persistence.ensure_schema()
        except Exception as e:
            logger.warning(f"Could not initialize symbol mapping persistence schema: {e}")

    # -----------------------------------------------------------------
    # Evidence-producing tiers (the ONE matching algorithm - unchanged
    # tiers 1-3 from the original implementation, tier 4 upgraded from a
    # crude word-membership check to real difflib similarity evidence)
    # -----------------------------------------------------------------
    def _match_evidence(self, security_name: Optional[str], security_slug: Optional[str]) -> Dict[str, Any]:
        """
        Runs the full tiered algorithm and returns evidence regardless of
        confidence - classification into MATCHED/LOW_CONFIDENCE/UNMATCHED
        happens one layer up, never inside the matching logic itself.
        """
        candidates: List[Dict[str, Any]] = []

        # Tier 1: curated alias dictionary
        if security_slug and security_slug.lower() in MANUAL_MAPPINGS:
            target = MANUAL_MAPPINGS[security_slug.lower()]
            if target in self._nse_symbols:
                candidates.append({"symbol": target, "confidence": CONFIDENCE_ALIAS, "method": MatchMethod.ALIAS})

        # Tier 2: slug cleaned -> exact / prefix match against NSE symbols
        if security_slug:
            slug_clean = re.sub(r"[^A-Z0-9]", "", security_slug.upper())
            if slug_clean in self._symbol_lookup:
                candidates.append({
                    "symbol": self._symbol_lookup[slug_clean],
                    "confidence": CONFIDENCE_NORMALIZED_EXACT,
                    "method": MatchMethod.NORMALIZED_NAME,
                })
            parts = security_slug.upper().split("-")
            if parts and parts[0] in self._symbol_lookup:
                candidates.append({
                    "symbol": self._symbol_lookup[parts[0]],
                    "confidence": CONFIDENCE_NORMALIZED_PREFIX,
                    "method": MatchMethod.NORMALIZED_NAME,
                })

        # Tier 3: security name cleaned -> exact match; or raw name IS a symbol
        if security_name:
            clean_name = normalize_name(security_name)
            if clean_name in self._symbol_lookup:
                candidates.append({
                    "symbol": self._symbol_lookup[clean_name],
                    "confidence": CONFIDENCE_NORMALIZED_EXACT,
                    "method": MatchMethod.NORMALIZED_NAME,
                })
            raw_upper = security_name.upper().strip()
            if raw_upper in self._nse_symbols:
                candidates.append({"symbol": raw_upper, "confidence": CONFIDENCE_EXACT_SYMBOL, "method": MatchMethod.EXACT_SYMBOL})

        # Tier 4: real fuzzy-string evidence (difflib) - a genuine LAST
        # RESORT, only attempted when tiers 1-3 (exact/alias/normalized)
        # found nothing at all. This is a strict fallback, not blended by
        # score, so a coincidentally high fuzzy ratio can never "steal"
        # credit from a more authoritative exact/normalized-name match -
        # the method reported always reflects the actual strongest tier
        # that produced a result, matching the pipeline's intended
        # exact -> alias -> normalized -> fuzzy priority order.
        if not candidates:
            candidates.extend(self._fuzzy_candidates(security_name, security_slug))

        # De-duplicate by symbol, keeping the highest-confidence entry for each.
        best_by_symbol: Dict[str, Dict[str, Any]] = {}
        for c in candidates:
            existing = best_by_symbol.get(c["symbol"])
            if not existing or c["confidence"] > existing["confidence"]:
                best_by_symbol[c["symbol"]] = c

        ranked = sorted(best_by_symbol.values(), key=lambda c: c["confidence"], reverse=True)
        return {"candidates": ranked}

    def _fuzzy_candidates(self, security_name: Optional[str], security_slug: Optional[str]) -> List[Dict[str, Any]]:
        """
        Token-prefiltered difflib.SequenceMatcher similarity scoring - real
        evidence, not an invented confidence. Only scores symbols that
        share at least one meaningful token with the input, so this never
        runs an expensive comparison against the full ~4,000-symbol universe.
        """
        target = re.sub(r"[^A-Z0-9]", "", (security_slug or security_name or "").upper())
        if not target:
            return []

        words: Set[str] = set()
        if security_slug:
            words |= {w for w in security_slug.upper().split("-") if len(w) > 2}
        if security_name:
            words |= {w for w in re.split(r"[^A-Z0-9]+", normalize_name(security_name)) if len(w) > 2}
            words |= {w for w in re.split(r"[^A-Z0-9]+", security_name.upper()) if len(w) > 2}
        if not words:
            return []

        candidate_symbols: Set[str] = set()
        for w in words:
            for clean_sym, sym in self._symbol_lookup.items():
                if len(clean_sym) > 2 and (w in clean_sym or clean_sym in w):
                    candidate_symbols.add(sym)

        results = []
        for sym in candidate_symbols:
            clean_sym = re.sub(r"[^A-Z0-9]", "", sym)
            ratio = difflib.SequenceMatcher(None, target, clean_sym).ratio()
            results.append({"symbol": sym, "confidence": round(ratio, 4), "method": MatchMethod.FUZZY_NAME})

        results.sort(key=lambda c: c["confidence"], reverse=True)
        return results[:5]

    # -----------------------------------------------------------------
    # Public governance-aware resolution
    # -----------------------------------------------------------------
    def resolve_symbol_detailed(self, security_name: Optional[str], security_slug: Optional[str] = None) -> Dict[str, Any]:
        """
        Full governance-aware resolution. Checks the persisted mapping
        first (manual overrides always win and are never recomputed;
        previously-computed automated mappings are reused rather than
        re-running matching - this is the caching/persistence layer that
        makes repeated resolution of the same company cheap).
        """
        if not self._initialized:
            self.initialize()

        normalized = normalize_name(security_name) or normalize_name(security_slug)
        if not normalized:
            return _result_shape(
                original_security_name=security_name, normalized_security_name="",
                resolved_nse_symbol=None, match_method=MatchMethod.NONE,
                match_confidence=0.0, match_status=MatchStatus.UNMATCHED, candidates=[],
            )

        if normalized in self._detailed_cache:
            return self._detailed_cache[normalized]

        existing = persistence.get_mapping(normalized)
        if existing:
            self._detailed_cache[normalized] = existing
            return existing

        evidence = self._match_evidence(security_name, security_slug)
        candidates = [c for c in evidence["candidates"] if c["symbol"] in self._nse_symbols]

        if candidates:
            best = candidates[0]
            status = classify_status(best["confidence"])
            resolved_symbol = best["symbol"] if status != MatchStatus.UNMATCHED else None
            method = best["method"]
            confidence = best["confidence"]
        else:
            status, resolved_symbol, method, confidence = MatchStatus.UNMATCHED, None, MatchMethod.NONE, 0.0

        result = _result_shape(
            original_security_name=security_name, normalized_security_name=normalized,
            resolved_nse_symbol=resolved_symbol, match_method=method,
            match_confidence=confidence, match_status=status, candidates=candidates,
        )

        try:
            saved = persistence.save_automated_mapping(security_name, normalized, result)
            if saved:
                result = saved
        except Exception as e:
            logger.warning(f"Could not persist symbol mapping for '{normalized}': {e}")

        self._detailed_cache[normalized] = result
        return result

    def resolve_symbol(self, security_name: str, security_slug: Optional[str] = None) -> Optional[str]:
        """
        Backward-compatible simple API. Returns a symbol ONLY for MATCHED
        or MANUAL_OVERRIDE results - a stock is never silently treated as
        correctly matched when the match is uncertain. Every existing
        caller (backtester.py, conviction/market_data.py) already only
        checks truthiness here, so this makes them governance-safe without
        requiring changes to their resolution call itself. Shares the same
        cache as resolve_symbol_detailed(), so mixing the two APIs for the
        same security never triggers a redundant DB lookup or re-match.
        """
        detailed = self.resolve_symbol_detailed(security_name, security_slug)
        if detailed["match_status"] in (MatchStatus.MATCHED, MatchStatus.MANUAL_OVERRIDE):
            return detailed["resolved_nse_symbol"]
        return None

    # -----------------------------------------------------------------
    # Small public accessors for governance API/UI use, so callers never
    # need to reach into private attributes (_nse_symbols, _detailed_cache).
    # -----------------------------------------------------------------
    def is_valid_nse_symbol(self, symbol: str) -> bool:
        if not self._initialized:
            self.initialize()
        return symbol.upper().strip() in self._nse_symbols

    def refresh_cached_result(self, normalized_security_name: str, result: Dict[str, Any]) -> None:
        """Updates the in-memory cache after an out-of-band write (e.g. a manual mapping saved via the API)."""
        self._detailed_cache[normalized_security_name] = result

    def invalidate_cached_result(self, normalized_security_name: str) -> None:
        """Drops a cached result (e.g. after a manual override is removed) so the next lookup re-resolves fresh."""
        self._detailed_cache.pop(normalized_security_name, None)

    def get_valid_nse_symbols(self) -> Set[str]:
        """Read-only copy of the current NSE reference universe, for hard-validation checks (never the live set itself)."""
        if not self._initialized:
            self.initialize()
        return set(self._nse_symbols)

    def clear_cache(self) -> None:
        """
        Drops the ENTIRE in-memory resolution cache (used by a full
        re-match run, after stale automatic mappings have been cleared in
        the database). Safe for manual overrides too: the next lookup just
        re-fetches them from security_mappings via get_mapping() and
        re-caches the same value - nothing is lost.
        """
        self._detailed_cache.clear()


# Global singleton instance
matcher = SymbolMatcher()
