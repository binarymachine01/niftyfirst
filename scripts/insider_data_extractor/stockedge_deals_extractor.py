"""
StockEdge Deals & Insider Trading Data Extractor.
Extracts Block Deals, Bulk Deals, Insider Trading, and SAST Deals from StockEdge APIs,
performs automated duplicate detection and incremental storage into PostgreSQL,
and optionally generates a consolidated multi-sheet Excel workbook.
"""

import os
import sys
import time
import argparse
from pathlib import Path
from typing import Dict, List, Any, Optional
import requests
import pandas as pd

# Add root directory to sys.path if not present
BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Import shared base configurations and database layer
from scripts.common import BASE_DIR, DOWNLOADS_DIR, DEFAULT_HEADERS, setup_logger
try:
    from .database import DealsDatabase
except ImportError:
    from database import DealsDatabase

logger = setup_logger("StockEdgeDealsExtractor")

# ==============================================================================
# CONFIGURATION SETTINGS
# ==============================================================================
EXCEL_FILENAME = str(DOWNLOADS_DIR / "stockedge_all_deals.xlsx")

# Global Request Configs
DELAY_SECONDS = 1.0       # Delay in seconds between API requests
PAGE_SIZE = 20            # Default records per page request
REQUEST_TIMEOUT = 15      # HTTP request timeout in seconds
LANG = "en"               # Default language

# Mapping between sheet name and database table
TABLE_MAPPING = {
    "Insider Trading": "stockedge_insider_deals",
    "SAST Deals": "stockedge_sast_deals",
    "Block Deals": "stockedge_block_deals",
    "Bulk Deals": "stockedge_bulk_deals",
}

# Columns to DISCARD from raw data sheets in Excel export
DISCARD_COLUMNS = [
    "SecurityID",
    "ClientID",
    "ParentClientID",
    "Important",
    "SecuritySlug",
    "SecurityLogoUrl",
    "InsiderDealTransactionType",
    "DealModeType",
    "InsiderPersonType",
    "SastTransactionType",
    "DealDirectionType"
]

HEADERS = DEFAULT_HEADERS.copy()
HEADERS.update({
    "Accept": "application/json, text/plain, */*",
})

# List of 4 StockEdge Deals API Endpoints & Configurations
API_CONFIGS = [
    {
        "name": "Block Deals",
        "sheet_name": "Block Deals",
        "key": "block",
        "url": "https://api.stockedge.com/Api/DealsDashboardApi/GetLatestBlockDeals",
        "extra_params": {}
    },
    {
        "name": "Bulk Deals",
        "sheet_name": "Bulk Deals",
        "key": "bulk",
        "url": "https://api.stockedge.com/Api/DealsDashboardApi/GetLatestBulkDeals",
        "extra_params": {}
    },
    {
        "name": "Insider Trading Deals",
        "sheet_name": "Insider Trading",
        "key": "insider",
        "url": "https://api.stockedge.com/Api/DealsDashboardApi/GetLatestInsidertradingDeals",
        "extra_params": {
            "exchange": 1,
            "insiderDealTransactionTypes": "",
            "dealModeTypes": ""
        }
    },
    {
        "name": "SAST Deals",
        "sheet_name": "SAST Deals",
        "key": "sast",
        "url": "https://api.stockedge.com/Api/DealsDashboardApi/GetLatestSASTDeals",
        "extra_params": {
            "exchange": 1,
            "sastTransactionTypes": "",
            "dealModeTypes": ""
        }
    }
]
# ==============================================================================


def fetch_api_data(
    api_config: Dict[str, Any],
    db: Optional[DealsDatabase] = None,
    page_size: int = PAGE_SIZE,
    delay_seconds: float = DELAY_SECONDS,
    timeout: int = REQUEST_TIMEOUT,
    lang: str = LANG,
    max_pages: Optional[int] = None,
    incremental: bool = True,
    save_to_db: bool = True
) -> List[Dict[str, Any]]:
    """
    Extracts data from a single StockEdge API endpoint by iterating pages.
    If database storage is enabled:
      - Checks database for existing IDs on each page to avoid duplicates.
      - In incremental mode, stops pagination early when existing historical records are met.
      - Directly bulk inserts newly fetched records.
    """
    name = api_config["name"]
    sheet_name = api_config["sheet_name"]
    url = api_config["url"]
    extra_params = api_config.get("extra_params", {})
    table_name = TABLE_MAPPING.get(sheet_name)

    page = 1
    all_fetched_records = []
    total_new_inserted = 0

    print(f"==================================================")
    print(f" Extracting: {name}")
    print(f" URL: {url}")
    if max_pages:
        print(f" Page Limit: Max {max_pages} pages")
    print(f" Incremental Sync: {'Enabled (stops when existing DB records found)' if (incremental and db and save_to_db) else 'Disabled'}")
    print(f" Database Storage: {'Enabled' if (db and save_to_db) else 'Disabled'}")
    print(f"==================================================")

    with requests.Session() as session:
        session.headers.update(HEADERS)

        while True:
            if max_pages is not None and page > max_pages:
                print(f"--> [Limit Reached] Reached max page limit ({max_pages}). Stopped for '{name}'.\n")
                break

            params = {
                "page": page,
                "pageSize": page_size,
                "lang": lang
            }
            params.update(extra_params)

            try:
                response = session.get(url, params=params, timeout=timeout)
                response.raise_for_status()
                data = response.json()

                if not data or not isinstance(data, list) or len(data) == 0:
                    print(f"--> [Page {page}] Empty response received. Finished extraction for '{name}'.\n")
                    break

                page_ids = [r["ID"] for r in data if "ID" in r and r["ID"] is not None]
                existing_ids = set()

                if db and save_to_db and table_name and page_ids:
                    try:
                        existing_ids = db.get_existing_ids(table_name, page_ids)
                    except Exception as e:
                        logger.error(f"Error checking existing IDs in {table_name}: {e}")

                new_records = [r for r in data if r.get("ID") not in existing_ids]

                # If incremental mode and entire page already exists in DB, stop pagination
                if incremental and db and save_to_db and len(page_ids) > 0 and len(existing_ids) == len(page_ids):
                    print(f"--> [Page {page}] All {len(page_ids)} deals already exist in database ({table_name}).")
                    print(f"--> Daily sync up to date. Stopped further pagination for '{name}'.\n")
                    break

                # Insert new records into DB
                if db and save_to_db and new_records:
                    inserted_count = db.insert_deals_by_category(sheet_name, new_records)
                    total_new_inserted += inserted_count
                    print(f"[Page {page}] Fetched {len(data)} items | New to DB: {len(new_records)} | Skipped Duplicates: {len(existing_ids)}")
                else:
                    duplicate_info = f" | Skipped Duplicates: {len(existing_ids)}" if existing_ids else ""
                    print(f"[Page {page}] Fetched {len(data)} items{duplicate_info} | Total: {len(all_fetched_records) + len(data)}")

                all_fetched_records.extend(data)

                # If some records on this page were already in DB during incremental sync,
                # the next page is guaranteed to be older data that already exists
                if incremental and db and save_to_db and len(existing_ids) > 0:
                    print(f"--> [Page {page}] Partial overlap detected ({len(existing_ids)} existing deals). Reached existing data frontier.")
                    print(f"--> Finished incremental sync for '{name}'.\n")
                    break

                page += 1
                time.sleep(delay_seconds)

            except requests.exceptions.RequestException as e:
                print(f"\n[Error] Failed to fetch page {page} for '{name}': {e}\n")
                break

    if db and save_to_db:
        print(f"[Summary] '{name}': {total_new_inserted} new records stored into database ({table_name}).\n")

    return all_fetched_records


def clean_raw_dataframe(records: List[Dict[str, Any]], discard_cols=DISCARD_COLUMNS) -> pd.DataFrame:
    """
    Converts raw API records list to pandas DataFrame and drops unwanted columns.
    Ensures a standardized, clean 'Date' column is present as the very first column (YYYY-MM-DD).
    """
    if not records:
        return pd.DataFrame()

    df = pd.DataFrame(records)
    cols_to_drop = [c for c in discard_cols if c in df.columns]
    df.drop(columns=cols_to_drop, inplace=True, errors="ignore")

    # Add Date column if not present (e.g., for Insider Trading & SAST Deals)
    if "Date" not in df.columns:
        date_series = None
        for candidate in ["ProcessDate", "TransactionFromDate", "ReportedDate"]:
            if candidate in df.columns:
                date_series = df[candidate]
                break
        if date_series is not None:
            df["Date"] = date_series

    # Clean ISO dates (e.g. 2026-08-14T00:00:00 -> 2026-08-14)
    if "Date" in df.columns:
        df["Date"] = df["Date"].astype(str).str.split("T").str[0].replace({"None": "", "nan": ""})
        # Move Date to the very first column (index 0)
        date_col = df.pop("Date")
        df.insert(0, "Date", date_col)

    return df


def build_consolidated_normalized_dataframe(all_raw_data: Dict[str, List[Dict[str, Any]]]) -> pd.DataFrame:
    """
    Standardizes records across all 4 deal types into a single unified DataFrame.
    """
    normalized_rows = []

    for deal_type, records in all_raw_data.items():
        for r in records:
            # Action normalization
            raw_action = r.get("BuySellName") or r.get("DealTransactionType") or "Unknown"
            raw_action_str = str(raw_action).strip()

            if raw_action_str in ["Buy", "Bought"]:
                action = "BUY"
            elif raw_action_str in ["Sell", "Sold"]:
                action = "SELL"
            else:
                action = raw_action_str.upper()

            # Date normalization
            date_val = r.get("Date") or r.get("ProcessDate") or r.get("TransactionFromDate") or ""
            if date_val and isinstance(date_val, str) and "T" in date_val:
                date_val = date_val.split("T")[0]

            # Quantity & Price calculation
            qty = r.get("Quantity") if "Quantity" in r and r.get("Quantity") is not None else r.get("DealQuantity", 0)
            qty = float(qty) if qty is not None else 0.0

            price = r.get("Price") if "Price" in r and r.get("Price") is not None else r.get("ValuePerShare", 0)
            price = float(price) if price is not None else 0.0

            # Total Value calculation
            total_val = r.get("TotalDealValue") if "TotalDealValue" in r and r.get("TotalDealValue") is not None else None
            if total_val is not None:
                total_val = float(total_val)
            else:
                total_val = qty * price if qty and price else 0.0

            client_name = str(r.get("ClientName") or "Unknown").strip()

            normalized_rows.append({
                "Date": date_val,
                "Deal Type": deal_type,
                "Exchange": r.get("ExchangeName", ""),
                "Security Name": r.get("SecurityName", ""),
                "Client Name": client_name,
                "Action": action,
                "Quantity": qty,
                "Price (₹)": price,
                "Total Value (₹)": total_val,
                "Mode / Description": r.get("DealModeDescription") or r.get("DealMode") or r.get("DealTypeName") or ""
            })

    return pd.DataFrame(normalized_rows)


def build_consolidated_by_security(consolidated_df: pd.DataFrame) -> pd.DataFrame:
    """
    Groups consolidated deals by Date, Category (Deal Type), and Security Name,
    summarizing Total Buy Quantity/Value, Total Sell Quantity/Value, Net Position,
    Deal Count, and Clients Involved.
    """
    if consolidated_df.empty:
        return pd.DataFrame()

    def summarize_security(g):
        buy_mask = g["Action"] == "BUY"
        sell_mask = g["Action"] == "SELL"

        buy_qty = g.loc[buy_mask, "Quantity"].sum()
        buy_val = g.loc[buy_mask, "Total Value (₹)"].sum()

        sell_qty = g.loc[sell_mask, "Quantity"].sum()
        sell_val = g.loc[sell_mask, "Total Value (₹)"].sum()

        net_qty = buy_qty - sell_qty
        net_val = buy_val - sell_val
        total_deals = len(g)

        clients = sorted(list(g["Client Name"].dropna().unique()))
        clients_str = ", ".join(clients)

        return pd.Series({
            "Total Buy Quantity": buy_qty,
            "Total Buy Value (₹)": buy_val,
            "Total Sell Quantity": sell_qty,
            "Total Sell Value (₹)": sell_val,
            "Net Quantity": net_qty,
            "Net Value (₹)": net_val,
            "Total Deals Count": total_deals,
            "Clients Involved": clients_str
        })

    grouped_df = consolidated_df.groupby(["Date", "Deal Type", "Security Name"], as_index=False).apply(summarize_security, include_groups=False)
    if not grouped_df.empty:
        grouped_df.sort_values(by=["Date", "Deal Type", "Security Name"], ascending=[False, True, True], inplace=True)
        grouped_df.reset_index(drop=True, inplace=True)

    return grouped_df


def save_workbook(raw_data_dict: Dict[str, List[Dict[str, Any]]], output_filename: str = EXCEL_FILENAME):
    """
    Saves the multi-sheet Excel file containing:
    1. Consolidated Deals (Grouped by Security Name for each category)
    2. Consolidated All Trades (Detailed list of all individual trades)
    3. Block Deals (Filtered raw data)
    4. Bulk Deals (Filtered raw data)
    5. Insider Trading (Filtered raw data)
    6. SAST Deals (Filtered raw data)
    """
    # Check if there is any data to write
    has_data = any(len(records) > 0 for records in raw_data_dict.values())
    if not has_data:
        print("No records fetched in this run to generate Excel report.")
        return

    print(f"\nBuilding Consolidated Data & Grouped Summaries...")

    # Build consolidated normalized dataframe
    consolidated_df = build_consolidated_normalized_dataframe(raw_data_dict)

    # Build Consolidated Deals grouped by Security Name for each category
    consolidated_grouped_df = build_consolidated_by_security(consolidated_df)

    print(f"Writing Excel workbook: '{output_filename}'...")

    with pd.ExcelWriter(output_filename, engine="openpyxl") as writer:
        # Sheet 1: Consolidated Deals (Grouped by Security Name per category)
        if not consolidated_grouped_df.empty:
            consolidated_grouped_df.to_excel(writer, sheet_name="Consolidated Deals", index=False)
            print(f"  - Sheet 'Consolidated Deals': {len(consolidated_grouped_df)} securities grouped by category written.")

        # Sheet 2: Consolidated All Trades (Detailed trades log)
        if not consolidated_df.empty:
            consolidated_df.to_excel(writer, sheet_name="Consolidated All Trades", index=False)
            print(f"  - Sheet 'Consolidated All Trades': {len(consolidated_df)} total individual trades written.")

        # Sheets 3-6: Cleaned Raw Data for each deal type
        for sheet_name, records in raw_data_dict.items():
            if records:
                clean_df = clean_raw_dataframe(records)
                clean_df.to_excel(writer, sheet_name=sheet_name, index=False)
                print(f"  - Sheet '{sheet_name}': {len(clean_df)} raw rows written.")

    print(f"\nSuccessfully created multi-sheet Excel report: '{output_filename}'!")


def parse_args():
    parser = argparse.ArgumentParser(
        description="StockEdge Insider Trading & Deals Extractor with PostgreSQL Ingestion & Deduplication"
    )
    parser.add_argument(
        "--init-db",
        action="store_true",
        help="Initialize database schema, tables, indexes, and views, then exit",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="Maximum pages to fetch per API endpoint (default: None for full pagination until DB match)",
    )
    parser.add_argument(
        "--category",
        type=str,
        choices=["insider", "sast", "block", "bulk", "all"],
        default="all",
        help="Specific deal category to extract (default: all)",
    )
    parser.add_argument(
        "--full-sync",
        action="store_true",
        help="Run full historical sync without stopping early on existing database records",
    )
    parser.add_argument(
        "--no-db",
        action="store_true",
        help="Disable PostgreSQL database storage (export only)",
    )
    parser.add_argument(
        "--no-excel",
        action="store_true",
        help="Disable Excel workbook export (database ingestion only)",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=PAGE_SIZE,
        help=f"Number of records per API page request (default: {PAGE_SIZE})",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    db = None
    if not args.no_db:
        try:
            db = DealsDatabase()
            if args.init_db:
                db.init_schema()
                print("StockEdge deals database schema initialized successfully.")
                return
            db.init_schema()
        except Exception as e:
            logger.error(f"Could not connect or initialize PostgreSQL schema: {e}")
            logger.info("Proceeding without database storage. Verify your PostgreSQL configuration in .env.")
            db = None

    if args.init_db and args.no_db:
        print("Cannot initialize DB when --no-db is passed.")
        return

    # Filter API configurations based on --category
    configs_to_run = API_CONFIGS
    if args.category != "all":
        configs_to_run = [c for c in API_CONFIGS if c["key"] == args.category]

    raw_data_dict = {}
    incremental = not args.full_sync

    for config in configs_to_run:
        sheet_name = config["sheet_name"]
        records = fetch_api_data(
            api_config=config,
            db=db,
            page_size=args.page_size,
            delay_seconds=DELAY_SECONDS,
            timeout=REQUEST_TIMEOUT,
            lang=LANG,
            max_pages=args.max_pages,
            incremental=incremental,
            save_to_db=(not args.no_db and db is not None)
        )
        raw_data_dict[sheet_name] = records

    # Save Excel report if not disabled
    if not args.no_excel:
        save_workbook(raw_data_dict)


if __name__ == "__main__":
    main()
