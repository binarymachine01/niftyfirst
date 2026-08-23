import logging
import psycopg2
from psycopg2 import pool
from psycopg2.extras import execute_values

try:
    from .config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL
except ImportError:
    from config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL

logger = logging.getLogger(__name__)

# SQL DDL for database tables and indexes
SCHEMA_DDL = """
-- 1. Equities Cash Market (CM) EOD Table
CREATE TABLE IF NOT EXISTS nse_equity_eod (
    symbol VARCHAR(50) NOT NULL,
    series VARCHAR(10) NOT NULL,
    trade_date DATE NOT NULL,
    open NUMERIC(14, 2),
    high NUMERIC(14, 2),
    low NUMERIC(14, 2),
    close NUMERIC(14, 2),
    last NUMERIC(14, 2),
    prev_close NUMERIC(14, 2),
    volume BIGINT,
    turnover_in_lakhs NUMERIC(18, 2),
    total_trades BIGINT,
    delivery_qty BIGINT,
    delivery_pct NUMERIC(6, 2),
    isin VARCHAR(20),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (symbol, series, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_nse_equity_date ON nse_equity_eod (trade_date);
CREATE INDEX IF NOT EXISTS idx_nse_equity_symbol_date ON nse_equity_eod (symbol, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_nse_equity_isin ON nse_equity_eod (isin);

-- 2. Indices EOD Table
CREATE TABLE IF NOT EXISTS nse_indices_eod (
    index_name VARCHAR(100) NOT NULL,
    trade_date DATE NOT NULL,
    open NUMERIC(14, 2),
    high NUMERIC(14, 2),
    low NUMERIC(14, 2),
    close NUMERIC(14, 2),
    points_change NUMERIC(14, 2),
    percent_change NUMERIC(6, 2),
    volume BIGINT,
    turnover_in_cr NUMERIC(18, 2),
    pe NUMERIC(8, 2),
    pb NUMERIC(8, 2),
    div_yield NUMERIC(6, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (index_name, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_nse_indices_date ON nse_indices_eod (trade_date);
CREATE INDEX IF NOT EXISTS idx_nse_indices_name_date ON nse_indices_eod (index_name, trade_date DESC);

-- 3. Derivatives / F&O EOD Table
CREATE TABLE IF NOT EXISTS nse_fo_eod (
    instrument VARCHAR(20) NOT NULL,
    symbol VARCHAR(50) NOT NULL,
    expiry_date DATE NOT NULL,
    strike_price NUMERIC(14, 2) NOT NULL,
    option_type VARCHAR(10) NOT NULL,
    trade_date DATE NOT NULL,
    open NUMERIC(14, 2),
    high NUMERIC(14, 2),
    low NUMERIC(14, 2),
    close NUMERIC(14, 2),
    settle_price NUMERIC(14, 2),
    contracts BIGINT,
    val_in_lakhs NUMERIC(18, 2),
    open_interest BIGINT,
    change_in_oi BIGINT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (instrument, symbol, expiry_date, strike_price, option_type, trade_date)
);

CREATE INDEX IF NOT EXISTS idx_nse_fo_symbol_date ON nse_fo_eod (symbol, trade_date DESC);
CREATE INDEX IF NOT EXISTS idx_nse_fo_date ON nse_fo_eod (trade_date);
CREATE INDEX IF NOT EXISTS idx_nse_fo_expiry ON nse_fo_eod (expiry_date);
"""

class Database:
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
        """Creates and returns a psycopg2 database connection."""
        try:
            conn = psycopg2.connect(**self.connection_params)
            return conn
        except psycopg2.OperationalError as e:
            logger.error(f"Failed to connect to PostgreSQL database: {e}")
            raise

    def init_schema(self):
        """Initializes tables and indexes if they do not exist."""
        logger.info("Initializing database schema...")
        with self.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(SCHEMA_DDL)
            conn.commit()
        logger.info("Database schema initialized successfully.")

    def upsert_equity_data(self, records: list) -> int:
        """
        Bulk upserts Equity EOD records into nse_equity_eod.
        Uses ON CONFLICT DO UPDATE to ensure idempotency.
        """
        if not records:
            return 0

        query = """
        INSERT INTO nse_equity_eod (
            symbol, series, trade_date, open, high, low, close, last,
            prev_close, volume, turnover_in_lakhs, total_trades,
            delivery_qty, delivery_pct, isin, updated_at
        ) VALUES %s
        ON CONFLICT (symbol, series, trade_date) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            last = EXCLUDED.last,
            prev_close = EXCLUDED.prev_close,
            volume = EXCLUDED.volume,
            turnover_in_lakhs = EXCLUDED.turnover_in_lakhs,
            total_trades = EXCLUDED.total_trades,
            delivery_qty = EXCLUDED.delivery_qty,
            delivery_pct = EXCLUDED.delivery_pct,
            isin = EXCLUDED.isin,
            updated_at = CURRENT_TIMESTAMP;
        """

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, query, records, template="""(
                    %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, CURRENT_TIMESTAMP
                )""", page_size=2000)
            conn.commit()

        logger.info(f"Upserted {len(records)} equity records.")
        return len(records)

    def upsert_indices_data(self, records: list) -> int:
        """
        Bulk upserts Indices EOD records into nse_indices_eod.
        """
        if not records:
            return 0

        query = """
        INSERT INTO nse_indices_eod (
            index_name, trade_date, open, high, low, close,
            points_change, percent_change, volume, turnover_in_cr,
            pe, pb, div_yield, updated_at
        ) VALUES %s
        ON CONFLICT (index_name, trade_date) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            points_change = EXCLUDED.points_change,
            percent_change = EXCLUDED.percent_change,
            volume = EXCLUDED.volume,
            turnover_in_cr = EXCLUDED.turnover_in_cr,
            pe = EXCLUDED.pe,
            pb = EXCLUDED.pb,
            div_yield = EXCLUDED.div_yield,
            updated_at = CURRENT_TIMESTAMP;
        """

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, query, records, template="""(
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, CURRENT_TIMESTAMP
                )""", page_size=2000)
            conn.commit()

        logger.info(f"Upserted {len(records)} index records.")
        return len(records)

    def upsert_fo_data(self, records: list) -> int:
        """
        Bulk upserts Derivatives/F&O records into nse_fo_eod.
        """
        if not records:
            return 0

        query = """
        INSERT INTO nse_fo_eod (
            instrument, symbol, expiry_date, strike_price, option_type,
            trade_date, open, high, low, close, settle_price,
            contracts, val_in_lakhs, open_interest, change_in_oi, updated_at
        ) VALUES %s
        ON CONFLICT (instrument, symbol, expiry_date, strike_price, option_type, trade_date) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            settle_price = EXCLUDED.settle_price,
            contracts = EXCLUDED.contracts,
            val_in_lakhs = EXCLUDED.val_in_lakhs,
            open_interest = EXCLUDED.open_interest,
            change_in_oi = EXCLUDED.change_in_oi,
            updated_at = CURRENT_TIMESTAMP;
        """

        with self.get_connection() as conn:
            with conn.cursor() as cur:
                execute_values(cur, query, records, template="""(
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, CURRENT_TIMESTAMP
                )""", page_size=2000)
            conn.commit()

        logger.info(f"Upserted {len(records)} FO records.")
        return len(records)

    def get_existing_segment_count(self, trade_date, segment: str = "cm") -> int:
        """
        Checks if data for a given date already exists in the database.
        Returns the number of rows recorded for that date.
        """
        date_str = trade_date.strftime("%Y-%m-%d") if hasattr(trade_date, "strftime") else str(trade_date)
        table_map = {
            "cm": "nse_equity_eod",
            "indices": "nse_indices_eod",
            "fo": "nse_fo_eod",
        }
        table = table_map.get(segment, "nse_equity_eod")
        query = f"SELECT count(*) FROM {table} WHERE trade_date = %s;"
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(query, (date_str,))
                    row = cur.fetchone()
                    return row[0] if row else 0
        except Exception as e:
            logger.error(f"Error checking existing data for {date_str} in {table}: {e}")
            return 0

    def get_existing_dates_set(self, segment: str = "cm") -> set:
        """
        Returns a set of all trade_dates (as 'YYYY-MM-DD' strings) already extracted in the database.
        """
        table_map = {
            "cm": "nse_equity_eod",
            "indices": "nse_indices_eod",
            "fo": "nse_fo_eod",
        }
        table = table_map.get(segment, "nse_equity_eod")
        query = f"SELECT DISTINCT trade_date::text FROM {table};"
        try:
            with self.get_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(query)
                    rows = cur.fetchall()
                    return {r[0] for r in rows}
        except Exception as e:
            logger.error(f"Error fetching existing dates from {table}: {e}")
            return set()

