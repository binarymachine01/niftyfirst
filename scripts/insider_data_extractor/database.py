"""
Database Schema & Repository Layer for Insider Trading & StockEdge Deals.
Provides table initialization, duplicate detection by Deal ID, and bulk insert/upsert methods.
"""

import logging
from typing import List, Dict, Any, Set, Optional
from datetime import datetime
import psycopg2
from psycopg2.extras import execute_values

try:
    from scripts.common import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL
except ImportError:
    try:
        from ..common import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL
    except ImportError:
        import os
        DB_HOST = os.getenv("DB_HOST", "localhost")
        DB_PORT = int(os.getenv("DB_PORT", "5432"))
        DB_NAME = os.getenv("DB_NAME", "nse_market_data")
        DB_USER = os.getenv("DB_USER", "postgres")
        DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
        DATABASE_URL = os.getenv("DATABASE_URL")

logger = logging.getLogger(__name__)

# SQL DDL for database tables, indexes, and consolidated view
SCHEMA_DDL = """
-- 1. Insider Trading Deals Table
CREATE TABLE IF NOT EXISTS stockedge_insider_deals (
    id BIGINT PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_stockedge_insider_process_date ON stockedge_insider_deals (process_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_insider_txn_date ON stockedge_insider_deals (transaction_from_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_insider_security ON stockedge_insider_deals (security_name);
CREATE INDEX IF NOT EXISTS idx_stockedge_insider_client ON stockedge_insider_deals (client_name);

-- 2. SAST Deals Table
CREATE TABLE IF NOT EXISTS stockedge_sast_deals (
    id BIGINT PRIMARY KEY,
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
    holding_post_deal NUMERIC(18, 2),
    holding_post_deal_g NUMERIC(18, 2),
    sast_transaction_type INTEGER,
    deal_mode_type INTEGER,
    security_logo_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stockedge_sast_process_date ON stockedge_sast_deals (process_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_sast_txn_date ON stockedge_sast_deals (transaction_from_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_sast_security ON stockedge_sast_deals (security_name);
CREATE INDEX IF NOT EXISTS idx_stockedge_sast_client ON stockedge_sast_deals (client_name);

-- 3. Block Deals Table
CREATE TABLE IF NOT EXISTS stockedge_block_deals (
    id BIGINT PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_stockedge_block_deal_date ON stockedge_block_deals (deal_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_block_security ON stockedge_block_deals (security_name);
CREATE INDEX IF NOT EXISTS idx_stockedge_block_client ON stockedge_block_deals (client_name);

-- 4. Bulk Deals Table
CREATE TABLE IF NOT EXISTS stockedge_bulk_deals (
    id BIGINT PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_stockedge_bulk_deal_date ON stockedge_bulk_deals (deal_date DESC);
CREATE INDEX IF NOT EXISTS idx_stockedge_bulk_security ON stockedge_bulk_deals (security_name);
CREATE INDEX IF NOT EXISTS idx_stockedge_bulk_client ON stockedge_bulk_deals (client_name);

-- 5. Consolidated Unified Deals View
CREATE OR REPLACE VIEW stockedge_all_deals_view AS
SELECT
    'Insider Trading' AS deal_category,
    id,
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
    NULL::NUMERIC(18,2) AS price,
    NULL::NUMERIC(18,2) AS total_value,
    COALESCE(deal_mode_description, deal_mode) AS mode_description,
    created_at
FROM stockedge_sast_deals

UNION ALL

SELECT
    'Block Deals' AS deal_category,
    id,
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


def parse_date_str(val: Any) -> Optional[str]:
    """Extracts YYYY-MM-DD string from ISO timestamps or strings."""
    if not val:
        return None
    s = str(val).strip()
    if not s or s.lower() in ("none", "nan", "null"):
        return None
    if "T" in s:
        s = s.split("T")[0]
    return s[:10] if len(s) >= 10 else None


class DealsDatabase:
    """PostgreSQL database manager for StockEdge deals and insider data."""

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
        """Initializes tables, indexes, and views if they do not exist."""
        logger.info("Initializing StockEdge deals database schema...")
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(SCHEMA_DDL)
            conn.commit()
        logger.info("StockEdge deals database schema initialized successfully.")

    def get_existing_ids(self, table_name: str, id_list: List[int]) -> Set[int]:
        """
        Checks which IDs from the given id_list already exist in the target table.
        Used for fast duplicate detection and incremental sync stopping.
        """
        if not id_list:
            return set()

        allowed_tables = {
            "stockedge_insider_deals",
            "stockedge_sast_deals",
            "stockedge_block_deals",
            "stockedge_bulk_deals"
        }
        if table_name not in allowed_tables:
            raise ValueError(f"Invalid table name: {table_name}")

        query = f"SELECT id FROM {table_name} WHERE id = ANY(%s);"
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(query, (id_list,))
                rows = cur.fetchall()
                return {row[0] for row in rows}

    def insert_insider_deals(self, records: List[Dict[str, Any]]) -> int:
        """Bulk inserts Insider Trading deals, ignoring existing duplicates."""
        if not records:
            return 0

        rows = []
        for r in records:
            rows.append((
                r.get("ID"),
                r.get("SecurityID"),
                r.get("SecurityName"),
                r.get("SecuritySlug"),
                r.get("ExchangeName"),
                parse_date_str(r.get("ProcessDate")),
                parse_date_str(r.get("ReportedDate")),
                parse_date_str(r.get("TransactionFromDate")),
                parse_date_str(r.get("TransactionToDate")),
                r.get("ClientID"),
                r.get("ClientName"),
                r.get("PersonCategory"),
                r.get("DealTransactionType"),
                r.get("DealDirectionType"),
                r.get("DealMode"),
                r.get("DealModeDescription"),
                r.get("DealQuantity"),
                r.get("TotalDealValue"),
                r.get("ValuePerShare"),
                r.get("HoldingPostDeal"),
                r.get("HoldingPostDealG"),
                r.get("InsiderDealTransactionType"),
                r.get("DealModeType"),
                r.get("InsiderPersonType"),
                r.get("SecurityLogoUrl"),
            ))

        query = """
        INSERT INTO stockedge_insider_deals (
            id, security_id, security_name, security_slug, exchange_name,
            process_date, reported_date, transaction_from_date, transaction_to_date,
            client_id, client_name, person_category, deal_transaction_type,
            deal_direction_type, deal_mode, deal_mode_description, deal_quantity,
            total_deal_value, value_per_share, holding_post_deal, holding_post_deal_g,
            insider_deal_transaction_type, deal_mode_type, insider_person_type,
            security_logo_url
        ) VALUES %s
        ON CONFLICT (id) DO NOTHING;
        """

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, query, rows, page_size=2000)
            conn.commit()

        logger.info(f"Inserted {len(rows)} records into stockedge_insider_deals.")
        return len(rows)

    def insert_sast_deals(self, records: List[Dict[str, Any]]) -> int:
        """Bulk inserts SAST deals, ignoring existing duplicates."""
        if not records:
            return 0

        rows = []
        for r in records:
            rows.append((
                r.get("ID"),
                r.get("SecurityID"),
                r.get("SecurityName"),
                r.get("SecuritySlug"),
                r.get("ExchangeName"),
                parse_date_str(r.get("ProcessDate")),
                parse_date_str(r.get("ReportedDate")),
                parse_date_str(r.get("TransactionFromDate")),
                parse_date_str(r.get("TransactionToDate")),
                r.get("ClientID"),
                r.get("ClientName"),
                r.get("PersonCategory"),
                r.get("DealTransactionType"),
                r.get("DealDirectionType"),
                r.get("DealMode"),
                r.get("DealModeDescription"),
                r.get("DealQuantity"),
                r.get("HoldingPostDeal"),
                r.get("HoldingPostDealG"),
                r.get("SastTransactionType"),
                r.get("DealModeType"),
                r.get("SecurityLogoUrl"),
            ))

        query = """
        INSERT INTO stockedge_sast_deals (
            id, security_id, security_name, security_slug, exchange_name,
            process_date, reported_date, transaction_from_date, transaction_to_date,
            client_id, client_name, person_category, deal_transaction_type,
            deal_direction_type, deal_mode, deal_mode_description, deal_quantity,
            holding_post_deal, holding_post_deal_g, sast_transaction_type,
            deal_mode_type, security_logo_url
        ) VALUES %s
        ON CONFLICT (id) DO NOTHING;
        """

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, query, rows, page_size=2000)
            conn.commit()

        logger.info(f"Inserted {len(rows)} records into stockedge_sast_deals.")
        return len(rows)

    def insert_block_deals(self, records: List[Dict[str, Any]]) -> int:
        """Bulk inserts Block deals, ignoring existing duplicates."""
        if not records:
            return 0

        rows = []
        for r in records:
            qty = r.get("Quantity")
            price = r.get("Price")
            total_val = (qty * price) if (qty is not None and price is not None) else None

            rows.append((
                r.get("ID"),
                parse_date_str(r.get("Date")),
                r.get("DealTypeName"),
                r.get("ExchangeName"),
                r.get("SecurityID"),
                r.get("SecurityName"),
                r.get("SecuritySlug"),
                r.get("ClientID"),
                r.get("ClientName"),
                r.get("ParentClientID"),
                r.get("BuySellName"),
                qty,
                price,
                total_val,
                r.get("Important"),
                r.get("SecurityLogoUrl"),
            ))

        query = """
        INSERT INTO stockedge_block_deals (
            id, deal_date, deal_type_name, exchange_name,
            security_id, security_name, security_slug, client_id, client_name,
            parent_client_id, buy_sell, quantity, price, total_deal_value,
            important, security_logo_url
        ) VALUES %s
        ON CONFLICT (id) DO NOTHING;
        """

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, query, rows, page_size=2000)
            conn.commit()

        logger.info(f"Inserted {len(rows)} records into stockedge_block_deals.")
        return len(rows)

    def insert_bulk_deals(self, records: List[Dict[str, Any]]) -> int:
        """Bulk inserts Bulk deals, ignoring existing duplicates."""
        if not records:
            return 0

        rows = []
        for r in records:
            qty = r.get("Quantity")
            price = r.get("Price")
            total_val = (qty * price) if (qty is not None and price is not None) else None

            rows.append((
                r.get("ID"),
                parse_date_str(r.get("Date")),
                r.get("DealTypeName"),
                r.get("ExchangeName"),
                r.get("SecurityID"),
                r.get("SecurityName"),
                r.get("SecuritySlug"),
                r.get("ClientID"),
                r.get("ClientName"),
                r.get("ParentClientID"),
                r.get("BuySellName"),
                qty,
                price,
                total_val,
                r.get("Important"),
                r.get("SecurityLogoUrl"),
            ))

        query = """
        INSERT INTO stockedge_bulk_deals (
            id, deal_date, deal_type_name, exchange_name,
            security_id, security_name, security_slug, client_id, client_name,
            parent_client_id, buy_sell, quantity, price, total_deal_value,
            important, security_logo_url
        ) VALUES %s
        ON CONFLICT (id) DO NOTHING;
        """

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, query, rows, page_size=2000)
            conn.commit()

        logger.info(f"Inserted {len(rows)} records into stockedge_bulk_deals.")
        return len(rows)

    def insert_deals_by_category(self, sheet_name: str, records: List[Dict[str, Any]]) -> int:
        """Dispatches records to appropriate insert method based on sheet/category name."""
        if not records:
            return 0
        if sheet_name == "Insider Trading":
            return self.insert_insider_deals(records)
        elif sheet_name == "SAST Deals":
            return self.insert_sast_deals(records)
        elif sheet_name == "Block Deals":
            return self.insert_block_deals(records)
        elif sheet_name == "Bulk Deals":
            return self.insert_bulk_deals(records)
        else:
            logger.warning(f"Unknown deal category '{sheet_name}', skipping DB insertion.")
            return 0
