"""
Configuration module for Official NSE Deals & Insider Trading Data Extractor.
"""

import sys
from pathlib import Path

# Add root directory to sys.path if not present
BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from scripts.common import (
    BASE_DIR,
    DOWNLOADS_DIR,
    DB_HOST,
    DB_PORT,
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    DATABASE_URL,
    REQUEST_TIMEOUT,
    RETRY_COUNT,
    RETRY_DELAY,
    DEFAULT_HEADERS,
)

# Output Excel report path
EXCEL_FILENAME = str(DOWNLOADS_DIR / "nse_all_deals.xlsx")

# NSE Official Deals Endpoints
NSE_BASE_URL = "https://www.nseindia.com"

# 1. Insider Trading (PIT) JSON & CSV API
NSE_PIT_URL = "https://www.nseindia.com/api/corporates-pit?index=equities&from_date={from_date}&to_date={to_date}"
NSE_PIT_GG_URL = "https://www.nseindia.com/api/corporates-pit-gg?index=equities&from_date={from_date}&to_date={to_date}"

# 2. Bulk, Block, and Short Selling Deals API
NSE_BULK_BLOCK_URL = "https://www.nseindia.com/api/historicalOR/bulk-block-short-deals?optionType={option_type}&from={from_date}&to={to_date}"

# Category to optionType mapping
OPTION_TYPE_MAP = {
    "bulk": "bulk_deals",
    "block": "block_deals",
    "short": "short_selling",
    "sast": "short_selling",
}

# Standard Request Headers for NSE
NSE_DEALS_HEADERS = DEFAULT_HEADERS.copy()
NSE_DEALS_HEADERS.update({
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/companies-listing/corporate-filings-insider-trading",
    "Origin": "https://www.nseindia.com",
})
