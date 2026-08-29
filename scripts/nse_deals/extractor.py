"""
Official NSE Deals & Insider Trading Extractor.
Extracts Insider Trading (PIT), Bulk Deals, Block Deals, and Short Selling / SAST from official NSE India APIs,
performs automated deduplication, inserts records into PostgreSQL, and generates an Excel report.
"""

import sys
import time
import argparse
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import requests
import pandas as pd
from pathlib import Path

# Add root directory to sys.path if not present
BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from scripts.common import setup_logger, DOWNLOADS_DIR
from scripts.nse_deals.config import (
    NSE_PIT_URL,
    NSE_BULK_BLOCK_URL,
    NSE_DEALS_HEADERS,
    EXCEL_FILENAME,
    REQUEST_TIMEOUT,
    RETRY_COUNT,
    RETRY_DELAY,
)
from scripts.nse_deals.database import NSEDealsDatabase, parse_date_str

logger = setup_logger("NSEDealsExtractor")


class NSEDealsExtractor:
    """Official NSE Deals & Insider Trading Extractor."""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(NSE_DEALS_HEADERS)
        self._init_session()

    def _init_session(self):
        """Visits corporate filings page to obtain valid NSE cookies."""
        try:
            r = self.session.get(
                "https://www.nseindia.com/companies-listing/corporate-filings-insider-trading",
                timeout=REQUEST_TIMEOUT
            )
            if r.status_code == 200:
                logger.info("NSE session initialized successfully.")
            else:
                logger.debug(f"NSE session warm-up returned status {r.status_code}")
        except Exception as e:
            logger.warning(f"NSE session warm-up warning (non-fatal): {e}")

    def _request_with_retry(self, url: str) -> Optional[requests.Response]:
        """Performs GET request with retry."""
        for attempt in range(1, RETRY_COUNT + 1):
            try:
                response = self.session.get(url, timeout=REQUEST_TIMEOUT)
                if response.status_code == 200:
                    return response
                elif response.status_code == 404:
                    logger.warning(f"Endpoint not found (404) at {url}")
                    return None
                elif response.status_code == 403:
                    logger.warning(f"Attempt {attempt}: Received 403 Forbidden. Re-initializing session...")
                    self._init_session()
                else:
                    logger.warning(f"Attempt {attempt}: Received status {response.status_code} from {url}")
            except Exception as e:
                logger.warning(f"Attempt {attempt} failed for {url}: {e}")

            if attempt < RETRY_COUNT:
                time.sleep(RETRY_DELAY * attempt)

        logger.error(f"Failed to fetch {url} after {RETRY_COUNT} attempts.")
        return None

    def fetch_insider_deals(self, from_date: str, to_date: str) -> List[Dict[str, Any]]:
        """Fetches Insider Trading (PIT) disclosures from NSE."""
        url = NSE_PIT_URL.format(from_date=from_date, to_date=to_date)
        logger.info(f"Fetching Insider Trading (PIT) deals from {from_date} to {to_date}...")
        r = self._request_with_retry(url)
        if r and r.content:
            try:
                data = r.json()
                if isinstance(data, dict) and "data" in data:
                    records = data["data"]
                    logger.info(f"-> Fetched {len(records)} Insider Trading records.")
                    return records
                elif isinstance(data, list):
                    logger.info(f"-> Fetched {len(data)} Insider Trading records.")
                    return data
            except Exception as e:
                logger.error(f"Error parsing Insider Trading JSON: {e}")
        return []

    def fetch_bulk_deals(self, from_date: str, to_date: str) -> List[Dict[str, Any]]:
        """Fetches Bulk Deals from NSE."""
        url = NSE_BULK_BLOCK_URL.format(option_type="bulk_deals", from_date=from_date, to_date=to_date)
        logger.info(f"Fetching Bulk Deals from {from_date} to {to_date}...")
        r = self._request_with_retry(url)
        if r and r.content:
            try:
                data = r.json()
                if isinstance(data, dict) and "data" in data:
                    records = data["data"]
                    logger.info(f"-> Fetched {len(records)} Bulk Deal records.")
                    return records
                elif isinstance(data, list):
                    logger.info(f"-> Fetched {len(data)} Bulk Deal records.")
                    return data
            except Exception as e:
                logger.error(f"Error parsing Bulk Deals JSON: {e}")
        return []

    def fetch_block_deals(self, from_date: str, to_date: str) -> List[Dict[str, Any]]:
        """Fetches Block Deals from NSE."""
        url = NSE_BULK_BLOCK_URL.format(option_type="block_deals", from_date=from_date, to_date=to_date)
        logger.info(f"Fetching Block Deals from {from_date} to {to_date}...")
        r = self._request_with_retry(url)
        if r and r.content:
            try:
                data = r.json()
                if isinstance(data, dict) and "data" in data:
                    records = data["data"]
                    logger.info(f"-> Fetched {len(records)} Block Deal records.")
                    return records
                elif isinstance(data, list):
                    logger.info(f"-> Fetched {len(data)} Block Deal records.")
                    return data
            except Exception as e:
                logger.error(f"Error parsing Block Deals JSON: {e}")
        return []

    def fetch_short_selling(self, from_date: str, to_date: str) -> List[Dict[str, Any]]:
        """Fetches Short Selling / SAST Deals from NSE."""
        url = NSE_BULK_BLOCK_URL.format(option_type="short_selling", from_date=from_date, to_date=to_date)
        logger.info(f"Fetching Short Selling / SAST deals from {from_date} to {to_date}...")
        r = self._request_with_retry(url)
        if r and r.content:
            try:
                data = r.json()
                if isinstance(data, dict) and "data" in data:
                    records = data["data"]
                    logger.info(f"-> Fetched {len(records)} Short Selling records.")
                    return records
                elif isinstance(data, list):
                    logger.info(f"-> Fetched {len(data)} Short Selling records.")
                    return data
            except Exception as e:
                logger.error(f"Error parsing Short Selling JSON: {e}")
        return []


def save_excel_report(raw_data_dict: Dict[str, List[Dict[str, Any]]], output_path: str = EXCEL_FILENAME):
    """Saves multi-sheet Excel workbook of all extracted deals."""
    has_data = any(len(records) > 0 for records in raw_data_dict.values())
    if not has_data:
        logger.info("No deal records to write to Excel report.")
        return

    logger.info(f"Writing Excel workbook: {output_path}...")
    try:
        with pd.ExcelWriter(output_path, engine="openpyxl") as writer:
            # 1. Consolidated All Trades
            consolidated_rows = []
            for cat_name, records in raw_data_dict.items():
                for r in records:
                    if cat_name == "Insider Trading":
                        sym = r.get("symbol", "")
                        company = r.get("company") or r.get("companyName") or sym
                        client = r.get("acqName", "")
                        action = r.get("tdpTransactionType", "BUY")
                        qty = r.get("secAcq", 0)
                        val = r.get("secVal", 0)
                        date_v = r.get("acqfromDt") or r.get("date")
                    elif cat_name in ("Bulk Deals", "Block Deals"):
                        sym = r.get("BD_SYMBOL", "")
                        company = r.get("BD_SCRIP_NAME") or sym
                        client = r.get("BD_CLIENT_NAME", "")
                        action = r.get("BD_BUY_SELL", "BUY")
                        qty = r.get("BD_QTY_TRD", 0)
                        price = r.get("BD_TP_WATP", 0)
                        try:
                            val = float(qty) * float(price)
                        except Exception:
                            val = 0
                        date_v = r.get("BD_DT_DATE")
                    else:  # Short Selling / SAST
                        sym = r.get("SS_SYMBOL", "")
                        company = r.get("SS_NAME") or sym
                        client = "Institutional Short Selling"
                        action = "SELL"
                        qty = r.get("SS_QTY", 0)
                        val = 0
                        date_v = r.get("SS_DATE")

                    consolidated_rows.append({
                        "Date": parse_date_str(date_v),
                        "Category": cat_name,
                        "Symbol": sym,
                        "Company Name": company,
                        "Client Name": client,
                        "Action": action,
                        "Quantity": qty,
                        "Total Value (₹)": val,
                    })

            if consolidated_rows:
                df_all = pd.DataFrame(consolidated_rows)
                df_all.sort_values(by=["Date", "Category", "Symbol"], ascending=[False, True, True], inplace=True)
                df_all.to_excel(writer, sheet_name="Consolidated Deals", index=False)
                logger.info(f"  - Sheet 'Consolidated Deals': {len(df_all)} rows written.")

            # Individual Sheets
            for sheet_name, records in raw_data_dict.items():
                if records:
                    df = pd.DataFrame(records)
                    df.to_excel(writer, sheet_name=sheet_name[:31], index=False)
                    logger.info(f"  - Sheet '{sheet_name}': {len(df)} rows written.")

        logger.info(f"Successfully generated Excel report: {output_path}")
    except Exception as e:
        logger.error(f"Failed to generate Excel report: {e}")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Official NSE Deals & Insider Trading Ingestion Pipeline"
    )
    parser.add_argument(
        "--init-db",
        action="store_true",
        help="Initialize database schema and tables, then exit",
    )
    parser.add_argument(
        "--today",
        action="store_true",
        help="Extract deals for today and recent 3 trading days",
    )
    parser.add_argument(
        "--date",
        type=str,
        help="Target date in DD-MM-YYYY or YYYY-MM-DD format",
    )
    parser.add_argument(
        "--from",
        dest="from_date",
        type=str,
        help="Start date in DD-MM-YYYY or YYYY-MM-DD format",
    )
    parser.add_argument(
        "--to",
        dest="to_date",
        type=str,
        help="End date in DD-MM-YYYY or YYYY-MM-DD format",
    )
    parser.add_argument(
        "--category",
        type=str,
        choices=["all", "insider", "pit", "bulk", "block", "short", "sast"],
        default="all",
        help="Deal category to extract (default: all)",
    )
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="Disable PostgreSQL ingestion",
    )
    parser.add_argument(
        "--no-excel",
        action="store_true",
        help="Disable Excel export",
    )
    return parser.parse_args()


def format_date_arg(date_str: str) -> str:
    """Standardizes input date string to DD-MM-YYYY for NSE APIs."""
    if not date_str:
        return datetime.now().strftime("%d-%m-%Y")
    for fmt in ("%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%b-%Y"):
        try:
            return datetime.strptime(date_str.strip(), fmt).strftime("%d-%m-%Y")
        except ValueError:
            continue
    return date_str.strip()


def main():
    args = parse_args()
    db = None

    if not args.no_db:
        try:
            db = NSEDealsDatabase()
            if args.init_db:
                db.init_schema()
                print("NSE Deals database schema initialized successfully.")
                return
            db.init_schema()
        except Exception as e:
            logger.error(f"Database connection error: {e}")
            logger.info("Proceeding without database ingestion.")
            db = None

    if args.init_db and args.no_db:
        print("Cannot initialize DB when --no-db is passed.")
        return

    # Determine date range
    today = datetime.now()
    if args.today:
        from_d = (today - timedelta(days=5)).strftime("%d-%m-%Y")
        to_d = today.strftime("%d-%m-%Y")
    elif args.date:
        d = format_date_arg(args.date)
        from_d = d
        to_d = d
    elif args.from_date:
        from_d = format_date_arg(args.from_date)
        to_d = format_date_arg(args.to_date) if args.to_date else today.strftime("%d-%m-%Y")
    else:
        # Default: last 30 days
        from_d = (today - timedelta(days=30)).strftime("%d-%m-%Y")
        to_d = today.strftime("%d-%m-%Y")

    logger.info(f"==================================================")
    logger.info(f" Extracting Official NSE Deals from {from_d} to {to_d}")
    logger.info(f" Category: {args.category.upper()}")
    logger.info(f" Database Storage: {'Enabled' if db else 'Disabled'}")
    logger.info(f" Excel Export: {'Disabled' if args.no_excel else 'Enabled'}")
    logger.info(f"==================================================")

    extractor = NSEDealsExtractor()
    raw_data_dict = {}

    cat = args.category.lower()

    # 1. Insider Trading (PIT)
    if cat in ("all", "insider", "pit"):
        records = extractor.fetch_insider_deals(from_d, to_d)
        raw_data_dict["Insider Trading"] = records
        if db and records:
            db.insert_insider_deals(records)

    # 2. Bulk Deals
    if cat in ("all", "bulk"):
        records = extractor.fetch_bulk_deals(from_d, to_d)
        raw_data_dict["Bulk Deals"] = records
        if db and records:
            db.insert_bulk_deals(records)

    # 3. Block Deals
    if cat in ("all", "block"):
        records = extractor.fetch_block_deals(from_d, to_d)
        raw_data_dict["Block Deals"] = records
        if db and records:
            db.insert_block_deals(records)

    # 4. Short Selling / SAST
    if cat in ("all", "short", "sast"):
        records = extractor.fetch_short_selling(from_d, to_d)
        raw_data_dict["Short Selling"] = records
        if db and records:
            db.insert_short_selling_or_sast(records)

    # Excel export
    if not args.no_excel:
        save_excel_report(raw_data_dict)

    total_records = sum(len(v) for v in raw_data_dict.values())
    logger.info(f"Completed extraction. Total {total_records} official NSE deal records processed.")


if __name__ == "__main__":
    main()
