"""
Database schema & repository layer for Official NSE Deals & Insider Trading Data.
"""

import hashlib
import logging
from typing import List, Dict, Any, Set, Optional
from datetime import datetime
import psycopg2
from psycopg2.extras import execute_values

try:
    from .config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL
except ImportError:
    from scripts.nse_deals.config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL

logger = logging.getLogger(__name__)

# SQL DDL for database tables, columns, indexes, and consolidated view
SCHEMA_DDL = """
-- 1. Insider Trading Deals Table
CREATE TABLE IF NOT EXISTS stockedge_insider_deals (
    id BIGINT PRIMARY KEY,
    symbol VARCHAR(50),
    security_id INTEGER,
    security_name VARCHAR(255),
    security_slug VARCHAR(255),
    exchange_name VARCHAR(50),
    process_date DATE,
    reported_date DATE,
    transaction_from_date DATE,
    transaction_to_date DATE,
    client_id INTEGER,
    client_name VARCHAR(255),
    person_category VARCHAR(100),
    deal_transaction_type VARCHAR(50),
    deal_direction_type VARCHAR(50),
    deal_mode VARCHAR(100),
    deal_mode_description VARCHAR(255),
    deal_quantity NUMERIC(18, 2),
    total_deal_value NUMERIC(18, 2),
    value_per_share NUMERIC(18, 2),
    holding_post_deal NUMERIC(18, 2),
    holding_post_deal_g NUMERIC(18, 2),
    insider_deal_transaction_type INTEGER,
    deal_mode_type INTEGER,
    insider_person_type INTEGER,
    security_logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE stockedge_insider_deals ADD COLUMN IF NOT EXISTS symbol VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_stockedge_insider_symbol ON stockedge_insider_deals (symbol);
CREATE INDEX IF NOT EXISTS idx_stockedge_insider_process_date ON stockedge_insider_deals (process_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_insider_txn_date ON stockedge_insider_deals (transaction_from_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_insider_security ON stockedge_insider_deals (security_name);
CREATE INDEX IF NOT EXISTS idx_stockedge_insider_client ON stockedge_insider_deals (client_name);

-- 2. SAST / Regulatory Deals Table
CREATE TABLE IF NOT EXISTS stockedge_sast_deals (
    id BIGINT PRIMARY KEY,
    symbol VARCHAR(50),
    security_id INTEGER,
    security_name VARCHAR(255),
    security_slug VARCHAR(255),
    exchange_name VARCHAR(50),
    process_date DATE,
    reported_date DATE,
    transaction_from_date DATE,
    transaction_to_date DATE,
    client_id INTEGER,
    client_name VARCHAR(255),
    person_category VARCHAR(100),
    deal_transaction_type VARCHAR(50),
    deal_direction_type VARCHAR(50),
    deal_mode VARCHAR(100),
    deal_mode_description VARCHAR(255),
    deal_quantity NUMERIC(18, 2),
    total_deal_value NUMERIC(18, 2),
    value_per_share NUMERIC(18, 2),
    holding_post_deal NUMERIC(18, 2),
    holding_post_deal_g NUMERIC(18, 2),
    sast_transaction_type INTEGER,
    deal_mode_type INTEGER,
    security_logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE stockedge_sast_deals ADD COLUMN IF NOT EXISTS symbol VARCHAR(50);
ALTER TABLE stockedge_sast_deals ADD COLUMN IF NOT EXISTS total_deal_value NUMERIC(18, 2);
ALTER TABLE stockedge_sast_deals ADD COLUMN IF NOT EXISTS value_per_share NUMERIC(18, 2);
CREATE INDEX IF NOT EXISTS idx_stockedge_sast_symbol ON stockedge_sast_deals (symbol);
CREATE INDEX IF NOT EXISTS idx_stockedge_sast_process_date ON stockedge_sast_deals (process_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_sast_txn_date ON stockedge_sast_deals (transaction_from_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_sast_security ON stockedge_sast_deals (security_name);
CREATE INDEX IF NOT EXISTS idx_stockedge_sast_client ON stockedge_sast_deals (client_name);

-- 3. Block Deals Table
CREATE TABLE IF NOT EXISTS stockedge_block_deals (
    id BIGINT PRIMARY KEY,
    symbol VARCHAR(50),
    deal_date DATE,
    deal_type_name VARCHAR(50),
    exchange_name VARCHAR(50),
    security_id INTEGER,
    security_name VARCHAR(255),
    security_slug VARCHAR(255),
    client_id INTEGER,
    client_name VARCHAR(255),
    parent_client_id INTEGER,
    buy_sell VARCHAR(20),
    quantity NUMERIC(18, 2),
    price NUMERIC(18, 2),
    total_deal_value NUMERIC(18, 2),
    important BOOLEAN,
    security_logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE stockedge_block_deals ADD COLUMN IF NOT EXISTS symbol VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_stockedge_block_symbol ON stockedge_block_deals (symbol);
CREATE INDEX IF NOT EXISTS idx_stockedge_block_deal_date ON stockedge_block_deals (deal_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_block_security ON stockedge_block_deals (security_name);
CREATE INDEX IF NOT EXISTS idx_stockedge_block_client ON stockedge_block_deals (client_name);

-- 4. Bulk Deals Table
CREATE TABLE IF NOT EXISTS stockedge_bulk_deals (
    id BIGINT PRIMARY KEY,
    symbol VARCHAR(50),
    deal_date DATE,
    deal_type_name VARCHAR(50),
    exchange_name VARCHAR(50),
    security_id INTEGER,
    security_name VARCHAR(255),
    security_slug VARCHAR(255),
    client_id INTEGER,
    client_name VARCHAR(255),
    parent_client_id INTEGER,
    buy_sell VARCHAR(20),
    quantity NUMERIC(18, 2),
    price NUMERIC(18, 2),
    total_deal_value NUMERIC(18, 2),
    important BOOLEAN,
    security_logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE stockedge_bulk_deals ADD COLUMN IF NOT EXISTS symbol VARCHAR(50);
CREATE INDEX IF NOT EXISTS idx_stockedge_bulk_symbol ON stockedge_bulk_deals (symbol);
CREATE INDEX IF NOT EXISTS idx_stockedge_bulk_deal_date ON stockedge_bulk_deals (deal_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_bulk_security ON stockedge_bulk_deals (security_name);
CREATE INDEX IF NOT EXISTS idx_stockedge_bulk_client ON stockedge_bulk_deals (client_name);

-- 5. Consolidated Unified Deals View (with native symbol)
DROP VIEW IF EXISTS stockedge_all_deals_view;
CREATE VIEW stockedge_all_deals_view AS
SELECT
    'Insider Trading' AS deal_category,
    id,
    symbol,
    COALESCE(transaction_from_date, process_date, reported_date) AS trade_date,
    exchange_name,
    security_name,
    client_name,
    CASE
        WHEN UPPER(deal_transaction_type) IN ('BUY', 'BOUGHT') THEN 'BUY'
        WHEN UPPER(deal_transaction_type) IN ('SELL', 'SOLD') THEN 'SELL'
        ELSE UPPER(deal_transaction_type)
    END AS action,
    deal_quantity AS quantity,
    value_per_share AS price,
    COALESCE(total_deal_value, deal_quantity * value_per_share) AS total_value,
    COALESCE(deal_mode_description, deal_mode) AS mode_description,
    created_at
FROM stockedge_insider_deals

UNION ALL

SELECT
    'SAST Deals' AS deal_category,
    id,
    symbol,
    COALESCE(transaction_from_date, process_date, reported_date) AS trade_date,
    exchange_name,
    security_name,
    client_name,
    CASE
        WHEN UPPER(deal_transaction_type) IN ('BUY', 'BOUGHT') THEN 'BUY'
        WHEN UPPER(deal_transaction_type) IN ('SELL', 'SOLD') THEN 'SELL'
        ELSE UPPER(deal_transaction_type)
    END AS action,
    deal_quantity AS quantity,
    value_per_share AS price,
    COALESCE(total_deal_value, deal_quantity * value_per_share) AS total_value,
    COALESCE(deal_mode_description, deal_mode) AS mode_description,
    created_at
FROM stockedge_sast_deals

UNION ALL

SELECT
    'Block Deals' AS deal_category,
    id,
    symbol,
    deal_date AS trade_date,
    exchange_name,
    security_name,
    client_name,
    CASE
        WHEN UPPER(buy_sell) IN ('BUY', 'BOUGHT') THEN 'BUY'
        WHEN UPPER(buy_sell) IN ('SELL', 'SOLD') THEN 'SELL'
        ELSE UPPER(buy_sell)
    END AS action,
    quantity,
    price,
    COALESCE(total_deal_value, quantity * price) AS total_value,
    deal_type_name AS mode_description,
    created_at
FROM stockedge_block_deals

UNION ALL

SELECT
    'Bulk Deals' AS deal_category,
    id,
    symbol,
    deal_date AS trade_date,
    exchange_name,
    security_name,
    client_name,
    CASE
        WHEN UPPER(buy_sell) IN ('BUY', 'BOUGHT') THEN 'BUY'
        WHEN UPPER(buy_sell) IN ('SELL', 'SOLD') THEN 'SELL'
        ELSE UPPER(buy_sell)
    END AS action,
    quantity,
    price,
    COALESCE(total_deal_value, quantity * price) AS total_value,
    deal_type_name AS mode_description,
    created_at
FROM stockedge_bulk_deals;
"""


def generate_deal_id(*components: Any) -> int:
    """
    Generates a deterministic 63-bit integer hash ID from deal attributes
    to ensure idempotent unique primary keys across multiple extractions.
    """
    raw_str = "|".join(str(c).strip().upper() for c in components if c is not None)
    md5_hex = hashlib.md5(raw_str.encode("utf-8")).hexdigest()
    # Mask to positive 63-bit signed integer for PostgreSQL BIGINT
    return int(md5_hex[:15], 16) & 0x7FFFFFFFFFFFFFFF


def parse_date_str(val: Any) -> Optional[str]:
    """Parses date string or timestamp to standard 'YYYY-MM-DD'."""
    if not val:
        return None
    s = str(val).strip()
    if not s or s.lower() in ("none", "nan", "null", "-"):
        return None
    if "T" in s:
        s = s.split("T")[0]
    formats = ["%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%b-%y", "%d-%B-%Y"]
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return s[:10] if len(s) >= 10 else None


def safe_float(val: Any, default: Optional[float] = None) -> Optional[float]:
    """Converts value to float safely."""
    if val is None:
        return default
    s = str(val).strip().replace(",", "")
    if s in ("", "-", "None", "nan"):
        return default
    try:
        return float(s)
    except (ValueError, TypeError):
        return default


class NSEDealsDatabase:
    """PostgreSQL database manager for Official NSE Deals & Insider Data."""

    def __init__(self):
        self.connection_params = {}
        if DATABASE_URL:
            self.connection_params["dsn"] = DATABASE_URL
        else:
            self.connection_params = {
                "host": DB_HOST,
                "port": DB_PORT,
                "dbname": DB_NAME,
                "user": DB_USER,
                "password": DB_PASSWORD,
            }

    def get_connection(self):
        """Returns a psycopg2 database connection."""
        try:
            return psycopg2.connect(**self.connection_params)
        except psycopg2.OperationalError as e:
            logger.error(f"Failed to connect to PostgreSQL: {e}")
            raise

    def init_schema(self):
        """Initializes tables, columns, indexes, and views if they do not exist."""
        logger.info("Initializing NSE deals database schema...")
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(SCHEMA_DDL)
            conn.commit()
        logger.info("NSE deals database schema initialized successfully.")

    def get_existing_ids(self, table_name: str, id_list: List[int]) -> Set[int]:
        """Returns set of IDs that already exist in the database table."""
        if not id_list:
            return set()
        allowed = {
            "stockedge_insider_deals",
            "stockedge_sast_deals",
            "stockedge_block_deals",
            "stockedge_bulk_deals"
        }
        if table_name not in allowed:
            raise ValueError(f"Invalid table name: {table_name}")

        query = f"SELECT id FROM {table_name} WHERE id = ANY(%s);"
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (id_list,))
                rows = cur.fetchall()
                return {row[0] for row in rows}

    def insert_insider_deals(self, records: List[Dict[str, Any]]) -> int:
        """Bulk inserts Official NSE Insider (PIT) records."""
        if not records:
            return 0

        rows = []
        for r in records:
            # Handle native NSE PIT keys vs legacy
            symbol = r.get("symbol") or r.get("SYMBOL") or ""
            company = r.get("company") or r.get("companyName") or r.get("SecurityName") or symbol
            client_name = r.get("acqName") or r.get("ClientName") or "N/A"
            category = r.get("personCategory") or r.get("PersonCategory") or "Other"
            action = r.get("tdpTransactionType") or r.get("DealTransactionType") or "Buy"
            if str(action).upper() in ["BUY", "BOUGHT", "ACQUISITION"]:
                action = "BUY"
            elif str(action).upper() in ["SELL", "SOLD", "DISPOSAL"]:
                action = "SELL"
            else:
                action = str(action).upper()

            txn_date = parse_date_str(r.get("acqfromDt") or r.get("TransactionFromDate") or r.get("date") or r.get("broadcastDateTime"))
            reported_date = parse_date_str(r.get("intimDt") or r.get("ReportedDate"))
            process_date = parse_date_str(r.get("date") or r.get("broadcastDateTime") or r.get("ProcessDate")) or txn_date

            qty = safe_float(r.get("secAcq") or r.get("buyQuantity") or r.get("sellquantity") or r.get("deal_quantity") or r.get("DealQuantity"), 0.0)
            val = safe_float(r.get("secVal") or r.get("buyValue") or r.get("sellValue") or r.get("total_deal_value") or r.get("TotalDealValue"), 0.0)
            price = (val / qty) if (qty and qty > 0 and val and val > 0) else safe_float(r.get("value_per_share") or r.get("ValuePerShare"))

            mode = r.get("acqMode") or r.get("DealMode") or r.get("deal_mode_description") or ""

            # ID generation: use did/pid or hash
            raw_id = r.get("did") or r.get("pid") or r.get("id") or r.get("appId")
            if raw_id and str(raw_id).isdigit():
                deal_id = int(raw_id)
            else:
                deal_id = generate_deal_id("PIT", symbol, txn_date, client_name, action, qty, val)

            rows.append((
                deal_id,
                symbol.upper().strip() if symbol else None,
                None,  # security_id
                company,
                symbol.lower().strip() if symbol else None,
                "NSE",
                process_date,
                reported_date,
                txn_date,
                parse_date_str(r.get("acqtoDt") or r.get("TransactionToDate")),
                None,  # client_id
                client_name,
                category,
                action,
                action,
                mode,
                mode,
                qty,
                val,
                price,
                safe_float(r.get("afterAcqSharesNo") or r.get("HoldingPostDeal")),
                safe_float(r.get("afterAcqSharesPer") or r.get("HoldingPostDealG")),
                None,
                None,
                None,
                r.get("xbrl") or r.get("security_logo_url"),
            ))

        query = """
        INSERT INTO stockedge_insider_deals (
            id, symbol, security_id, security_name, security_slug, exchange_name,
            process_date, reported_date, transaction_from_date, transaction_to_date,
            client_id, client_name, person_category, deal_transaction_type,
            deal_direction_type, deal_mode, deal_mode_description, deal_quantity,
            total_deal_value, value_per_share, holding_post_deal, holding_post_deal_g,
            insider_deal_transaction_type, deal_mode_type, insider_person_type,
            security_logo_url
        ) VALUES %s
        ON CONFLICT (id) DO UPDATE SET
            symbol = COALESCE(EXCLUDED.symbol, stockedge_insider_deals.symbol),
            total_deal_value = EXCLUDED.total_deal_value,
            value_per_share = EXCLUDED.value_per_share,
            updated_at = CURRENT_TIMESTAMP;
        """

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, query, rows, page_size=2000)
            conn.commit()

        logger.info(f"Upserted {len(rows)} records into stockedge_insider_deals.")
        return len(rows)

    def insert_bulk_deals(self, records: List[Dict[str, Any]]) -> int:
        """Bulk inserts Official NSE Bulk Deals."""
        if not records:
            return 0

        rows = []
        for r in records:
            symbol = r.get("BD_SYMBOL") or r.get("symbol") or ""
            scrip = r.get("BD_SCRIP_NAME") or r.get("security_name") or symbol
            client = r.get("BD_CLIENT_NAME") or r.get("client_name") or "Unknown"
            deal_date = parse_date_str(r.get("BD_DT_DATE") or r.get("deal_date"))
            buy_sell = str(r.get("BD_BUY_SELL") or r.get("buy_sell") or "BUY").upper()
            qty = safe_float(r.get("BD_QTY_TRD") or r.get("quantity"), 0.0)
            price = safe_float(r.get("BD_TP_WATP") or r.get("price"), 0.0)
            total_val = (qty * price) if (qty and price) else safe_float(r.get("total_deal_value"))

            deal_id = r.get("id") or generate_deal_id("BULK", symbol, deal_date, client, buy_sell, qty, price)

            rows.append((
                deal_id,
                symbol.upper().strip() if symbol else None,
                deal_date,
                "Bulk Deal",
                "NSE",
                None,
                scrip,
                symbol.lower().strip() if symbol else None,
                None,
                client,
                None,
                buy_sell,
                qty,
                price,
                total_val,
                False,
                None,
            ))

        query = """
        INSERT INTO stockedge_bulk_deals (
            id, symbol, deal_date, deal_type_name, exchange_name,
            security_id, security_name, security_slug, client_id, client_name,
            parent_client_id, buy_sell, quantity, price, total_deal_value,
            important, security_logo_url
        ) VALUES %s
        ON CONFLICT (id) DO UPDATE SET
            symbol = COALESCE(EXCLUDED.symbol, stockedge_bulk_deals.symbol),
            total_deal_value = EXCLUDED.total_deal_value,
            price = EXCLUDED.price,
            updated_at = CURRENT_TIMESTAMP;
        """

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, query, rows, page_size=2000)
            conn.commit()

        logger.info(f"Upserted {len(rows)} records into stockedge_bulk_deals.")
        return len(rows)

    def insert_block_deals(self, records: List[Dict[str, Any]]) -> int:
        """Bulk inserts Official NSE Block Deals."""
        if not records:
            return 0

        rows = []
        for r in records:
            symbol = r.get("BD_SYMBOL") or r.get("symbol") or ""
            scrip = r.get("BD_SCRIP_NAME") or r.get("security_name") or symbol
            client = r.get("BD_CLIENT_NAME") or r.get("client_name") or "Unknown"
            deal_date = parse_date_str(r.get("BD_DT_DATE") or r.get("deal_date"))
            buy_sell = str(r.get("BD_BUY_SELL") or r.get("buy_sell") or "BUY").upper()
            qty = safe_float(r.get("BD_QTY_TRD") or r.get("quantity"), 0.0)
            price = safe_float(r.get("BD_TP_WATP") or r.get("price"), 0.0)
            total_val = (qty * price) if (qty and price) else safe_float(r.get("total_deal_value"))

            deal_id = r.get("id") or generate_deal_id("BLOCK", symbol, deal_date, client, buy_sell, qty, price)

            rows.append((
                deal_id,
                symbol.upper().strip() if symbol else None,
                deal_date,
                "Block Deal",
                "NSE",
                None,
                scrip,
                symbol.lower().strip() if symbol else None,
                None,
                client,
                None,
                buy_sell,
                qty,
                price,
                total_val,
                True,
                None,
            ))

        query = """
        INSERT INTO stockedge_block_deals (
            id, symbol, deal_date, deal_type_name, exchange_name,
            security_id, security_name, security_slug, client_id, client_name,
            parent_client_id, buy_sell, quantity, price, total_deal_value,
            important, security_logo_url
        ) VALUES %s
        ON CONFLICT (id) DO UPDATE SET
            symbol = COALESCE(EXCLUDED.symbol, stockedge_block_deals.symbol),
            total_deal_value = EXCLUDED.total_deal_value,
            price = EXCLUDED.price,
            updated_at = CURRENT_TIMESTAMP;
        """

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, query, rows, page_size=2000)
            conn.commit()

        logger.info(f"Upserted {len(rows)} records into stockedge_block_deals.")
        return len(rows)

    def insert_short_selling_or_sast(self, records: List[Dict[str, Any]]) -> int:
        """Bulk inserts Short Selling / SAST records."""
        if not records:
            return 0

        rows = []
        for r in records:
            symbol = r.get("SS_SYMBOL") or r.get("symbol") or ""
            name = r.get("SS_NAME") or r.get("security_name") or symbol
            deal_date = parse_date_str(r.get("SS_DATE") or r.get("deal_date") or r.get("transaction_from_date"))
            qty = safe_float(r.get("SS_QTY") or r.get("quantity") or r.get("deal_quantity"), 0.0)

            deal_id = r.get("id") or generate_deal_id("SHORT", symbol, deal_date, qty)

            rows.append((
                deal_id,
                symbol.upper().strip() if symbol else None,
                None,
                name,
                symbol.lower().strip() if symbol else None,
                "NSE",
                deal_date,
                deal_date,
                deal_date,
                deal_date,
                None,
                "Short Selling Window",
                "Institutional",
                "SELL",
                "SELL",
                "Short Selling",
                "Exchange Short Selling Disclosure",
                qty,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
            ))

        query = """
        INSERT INTO stockedge_sast_deals (
            id, symbol, security_id, security_name, security_slug, exchange_name,
            process_date, reported_date, transaction_from_date, transaction_to_date,
            client_id, client_name, person_category, deal_transaction_type,
            deal_direction_type, deal_mode, deal_mode_description, deal_quantity,
            total_deal_value, value_per_share, holding_post_deal, holding_post_deal_g,
            sast_transaction_type, deal_mode_type, security_logo_url
        ) VALUES %s
        ON CONFLICT (id) DO UPDATE SET
            symbol = COALESCE(EXCLUDED.symbol, stockedge_sast_deals.symbol),
            deal_quantity = EXCLUDED.deal_quantity,
            updated_at = CURRENT_TIMESTAMP;
        """

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, query, rows, page_size=2000)
            conn.commit()

        logger.info(f"Upserted {len(rows)} records into stockedge_sast_deals.")
        return len(rows)

    def insert_deals_by_category(self, category: str, records: List[Dict[str, Any]]) -> int:
        """Dispatches records to appropriate insert method."""
        if not records:
            return 0
        cat_lower = category.lower()
        if "insider" in cat_lower or "pit" in cat_lower:
            return self.insert_insider_deals(records)
        elif "block" in cat_lower:
            return self.insert_block_deals(records)
        elif "bulk" in cat_lower:
            return self.insert_bulk_deals(records)
        elif "sast" in cat_lower or "short" in cat_lower:
            return self.insert_short_selling_or_sast(records)
        else:
            logger.warning(f"Unknown deal category '{category}', skipping DB insertion.")
            return 0
