"""
Common shared module for all data extraction and ingestion scripts.
Provides centralized path configuration, environment loading, HTTP utilities, and logging.
"""

import os
import sys
import logging
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv

# ==============================================================================
# BASE PROJECT DIRECTORIES & ENVIRONMENT
# ==============================================================================
# Root project directory
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Load environment variables from .env located at root
load_dotenv(BASE_DIR / ".env")
load_dotenv()

# Common folders
DOWNLOADS_DIR = Path(os.getenv("DOWNLOADS_DIR", BASE_DIR / "downloads"))
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

LOGS_DIR = Path(os.getenv("LOGS_DIR", BASE_DIR / "logs"))
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# Database Configuration (PostgreSQL)
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "nse_market_data")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DATABASE_URL = os.getenv("DATABASE_URL")

# Request & Downloader Configuration
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "30"))
RETRY_COUNT = int(os.getenv("RETRY_COUNT", "3"))
RETRY_DELAY = int(os.getenv("RETRY_DELAY", "2"))

# Standard Browser Headers
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
}

# ==============================================================================
# EXCHANGE CONFIGURATION
# ==============================================================================
# Centralized, configurable exchange filter for the insider/deal data
# pipeline (scripts/insider_data_extractor). This is the ONLY place exchange
# eligibility is decided - extraction code calls is_exchange_enabled()
# rather than comparing against a literal exchange name, so enabling an
# additional exchange later is a configuration change, not a code change.
#
# Default is NSE-only, and MUST stay that way in production today: the
# platform's market-price/EOD dataset (nse_equity_eod) contains NSE data
# only, so a deal on a non-enabled exchange could never be correlated with
# price/technical data anyway (SymbolMatcher, Conviction, the Screener, and
# backtesting all resolve against nse_equity_eod, not exchange-scoped
# tables - none of them need to change for this to work correctly).
#
# To enable an additional exchange once its EOD data and a verified
# StockEdge API code exist: set ENABLED_EXCHANGES=NSE,BSE and add the
# verified code to EXCHANGE_API_CODES below. Until both of those are done,
# adding a name to ENABLED_EXCHANGES that has no entry in
# EXCHANGE_API_CODES causes that exchange to be skipped with a warning,
# never silently mismatched or guessed.
ENABLED_EXCHANGES = [e.strip().upper() for e in os.getenv("ENABLED_EXCHANGES", "NSE").split(",") if e.strip()]

# Maps an exchange name to the StockEdge API's numeric "exchange"
# query-parameter code. This is the single source of truth for which
# exchanges the application actually knows how to process end-to-end -
# SUPPORTED_EXCHANGES (below) is derived from its keys, never listed
# separately. Only NSE (code 1) has ever been verified against the live
# API (it is the value this pipeline already used, previously hard-coded
# inline). BSE's code is deliberately NOT guessed here.
EXCHANGE_API_CODES = {
    "NSE": 1,
}

# Exchanges the application knows how to process at all (has a verified
# StockEdge API integration for). Kept distinct from ENABLED_EXCHANGES:
# "supported" means the integration exists; "enabled" means it is actually
# turned on for extraction today. ENABLED_EXCHANGES is not required to be a
# subset (see fetch_api_data's own skip-with-warning handling for an
# enabled-but-unsupported exchange), but any exchange picker in the UI must
# only ever offer ENABLED_EXCHANGES, never all of SUPPORTED_EXCHANGES.
SUPPORTED_EXCHANGES = list(EXCHANGE_API_CODES.keys())

# The exchange(s) used when a caller (UI, API request, or a direct script
# invocation) doesn't explicitly choose any. Falls back to the first enabled
# exchange if unset or misconfigured, never to a bare literal "NSE"
# scattered at each call site. Comma-separated, same shape as
# ENABLED_EXCHANGES (e.g. DEFAULT_EXCHANGES=NSE,BSE once both are enabled).
_default_exchanges_env = [
    e.strip().upper()
    for e in os.getenv("DEFAULT_EXCHANGES", os.getenv("DEFAULT_EXCHANGE", "")).split(",")
    if e.strip()
]
if _default_exchanges_env:
    DEFAULT_EXCHANGES = _default_exchanges_env
elif ENABLED_EXCHANGES:
    DEFAULT_EXCHANGES = [ENABLED_EXCHANGES[0]]
else:
    DEFAULT_EXCHANGES = ["NSE"]

# Single-value convenience for callers that only ever need one default
# (e.g. the Deals Explorer / Smart Screener exchange filters) - always the
# first entry of DEFAULT_EXCHANGES, never a separately configured value.
DEFAULT_EXCHANGE = DEFAULT_EXCHANGES[0]


def is_exchange_enabled(exchange_name: Optional[str]) -> bool:
    """
    Single centralized exchange-eligibility check, case-insensitive.
    Every extraction/filtering decision in the insider/deal pipeline goes
    through this function rather than comparing against a literal name.
    """
    if not exchange_name:
        return False
    return exchange_name.strip().upper() in ENABLED_EXCHANGES


def is_exchange_supported(exchange_name: Optional[str]) -> bool:
    """Whether the application has a verified integration for this exchange at all (see SUPPORTED_EXCHANGES)."""
    if not exchange_name:
        return False
    return exchange_name.strip().upper() in SUPPORTED_EXCHANGES

# ==============================================================================
# LOGGING SETUP
# ==============================================================================
def setup_logger(name: str, log_file: str = None, level: int = logging.INFO) -> logging.Logger:
    """Configures a standardized logger with console and optional file handlers."""
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # Avoid duplicate handlers if logger already initialized
    if not logger.handlers:
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        )

        # Console handler
        ch = logging.StreamHandler(sys.stdout)
        ch.setFormatter(formatter)
        logger.addHandler(ch)

        # Optional file handler
        if log_file:
            log_path = LOGS_DIR / log_file
            fh = logging.FileHandler(log_path, encoding="utf-8")
            fh.setFormatter(formatter)
            logger.addHandler(fh)

    return logger
