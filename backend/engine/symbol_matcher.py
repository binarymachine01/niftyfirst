"""
Symbol Matcher Engine.
Resolves StockEdge security names and slugs to exact NSE trading symbols in nse_equity_eod.
"""

import re
import logging
try:
    from backend.database import fetch_all
except ImportError:
    from ..database import fetch_all

logger = logging.getLogger(__name__)

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


class SymbolMatcher:
    """Matches StockEdge company names/slugs to NSE EOD symbols."""

    def __init__(self):
        self._cache: Dict[str, Optional[str]] = {}
        self._nse_symbols: Set[str] = set()
        self._symbol_lookup: Dict[str, str] = {}
        self._initialized = False

    def initialize(self):
        """Preloads distinct NSE symbols from database."""
        if self._initialized:
            return

        try:
            rows = fetch_all("SELECT DISTINCT symbol FROM nse_equity_eod")
            self._nse_symbols = {r["symbol"].upper() for r in rows if r["symbol"]}
            for sym in self._nse_symbols:
                # Clean alphanumeric key
                clean_key = re.sub(r"[^A-Z0-9]", "", sym)
                self._symbol_lookup[clean_key] = sym
            self._initialized = True
            logger.info(f"SymbolMatcher initialized with {len(self._nse_symbols)} NSE symbols.")
        except Exception as e:
            logger.warning(f"Could not load symbols for SymbolMatcher: {e}")

    def resolve_symbol(self, security_name: str, security_slug: Optional[str] = None) -> Optional[str]:
        """
        Resolves security_slug / security_name to valid NSE symbol in database.
        Returns None if not resolvable.
        """
        if not self._initialized:
            self.initialize()

        cache_key = (security_slug or security_name or "").lower().strip()
        if not cache_key:
            return None

        if cache_key in self._cache:
            return self._cache[cache_key]

        # 1. Check manual mappings
        if security_slug and security_slug.lower() in MANUAL_MAPPINGS:
            target = MANUAL_MAPPINGS[security_slug.lower()]
            if target in self._nse_symbols:
                self._cache[cache_key] = target
                return target

        # 2. Check if slug without hyphens matches symbol directly
        if security_slug:
            slug_clean = re.sub(r"[^A-Z0-9]", "", security_slug.upper())
            if slug_clean in self._symbol_lookup:
                target = self._symbol_lookup[slug_clean]
                self._cache[cache_key] = target
                return target

            # Try prefix match (e.g. "hindustan-unilever" -> "HINDUNILVR")
            parts = security_slug.upper().split("-")
            if parts:
                first_part = parts[0]
                if first_part in self._symbol_lookup:
                    target = self._symbol_lookup[first_part]
                    self._cache[cache_key] = target
                    return target

        # 3. Check clean name
        if security_name:
            # Strip common suffixes like 'Ltd', 'Limited', 'India', 'Corporation'
            clean_name = re.sub(r"\b(LTD|LIMITED|INDIA|CORP|CORPORATION|INC|CO)\b", "", security_name.upper())
            clean_name = re.sub(r"[^A-Z0-9]", "", clean_name)
            if clean_name in self._symbol_lookup:
                target = self._symbol_lookup[clean_name]
                self._cache[cache_key] = target
                return target

            # Check direct exact match
            raw_upper = security_name.upper().strip()
            if raw_upper in self._nse_symbols:
                self._cache[cache_key] = raw_upper
                return raw_upper

        # 4. Fallback search through NSE symbols
        if security_slug:
            slug_words = [w for w in security_slug.upper().split("-") if len(w) > 2]
            for sym in self._nse_symbols:
                if any(w == sym for w in slug_words):
                    self._cache[cache_key] = sym
                    return sym

        self._cache[cache_key] = None
        return None


# Global singleton instance
matcher = SymbolMatcher()
