import logging
import math
from datetime import datetime
from typing import List, Tuple, Optional
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

def _clean_str(val) -> Optional[str]:
    """Cleans string value, strips whitespace, returns None if empty."""
    if pd.isna(val) or val is None:
        return None
    s = str(val).strip()
    return s if s != "" and s != "-" else None

def _clean_num(val) -> Optional[float]:
    """Cleans numeric value, handles NaN, infinite values, '-' representations."""
    if pd.isna(val) or val is None:
        return None
    if isinstance(val, (int, float)):
        if math.isnan(val) or math.isinf(val):
            return None
        return float(val)
    s = str(val).strip().replace(",", "")
    if s == "" or s == "-":
        return None
    try:
        f = float(s)
        return None if math.isnan(f) or math.isinf(f) else f
    except ValueError:
        return None

def _clean_int(val) -> Optional[int]:
    """Cleans integer value safely."""
    num = _clean_num(val)
    return int(num) if num is not None else None

def _parse_date(date_val, default_date: Optional[datetime] = None) -> Optional[str]:
    """Parses various date string formats to YYYY-MM-DD."""
    if pd.isna(date_val) or date_val is None:
        return default_date.strftime("%Y-%m-%d") if default_date else None
    
    s = str(date_val).strip()
    formats = [
        "%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d%b%Y",
        "%d/%m/%Y", "%Y%m%d", "%d-%b-%y"
    ]
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    
    if default_date:
        return default_date.strftime("%Y-%m-%d")
    return None

class DataParser:
    """
    Parses and standardizes raw DataFrames from NSE into clean tuples ready for PostgreSQL upsert.
    """

    @staticmethod
    def parse_equity_data(df: pd.DataFrame, target_date: datetime) -> List[Tuple]:
        """
        Parses Sec Bhavdata or CM Bhavcopy into standardized records:
        (symbol, series, trade_date, open, high, low, close, last, prev_close,
         volume, turnover_in_lakhs, total_trades, delivery_qty, delivery_pct, isin)
        """
        if df is None or df.empty:
            return []

        # Normalize column headers (uppercase and strip whitespace)
        df.columns = [str(c).strip().upper() for c in df.columns]

        records = []
        target_date_str = target_date.strftime("%Y-%m-%d")

        for _, row in df.iterrows():
            # Extract Symbol & Series
            symbol = _clean_str(row.get("SYMBOL") or row.get("TCKRSYMB"))
            series = _clean_str(row.get("SERIES") or row.get("SCTYSYMB") or "EQ")
            if not symbol:
                continue

            # Parse trade date
            raw_date = row.get("DATE1") or row.get("TRADDT") or row.get("TIMESTAMP")
            trade_date = _parse_date(raw_date, default_date=target_date) or target_date_str

            # Price fields
            open_p = _clean_num(row.get("OPEN_PRICE") or row.get("OPEN") or row.get("OPNPRIC"))
            high_p = _clean_num(row.get("HIGH_PRICE") or row.get("HIGH") or row.get("HGHPRIC"))
            low_p = _clean_num(row.get("LOW_PRICE") or row.get("LOW") or row.get("LWPRIC"))
            close_p = _clean_num(row.get("CLOSE_PRICE") or row.get("CLOSE") or row.get("CLSPRIC"))
            last_p = _clean_num(row.get("LAST_PRICE") or row.get("LAST") or row.get("LASTPRIC"))
            prev_close = _clean_num(row.get("PREV_CLOSE") or row.get("PREVCLOSE") or row.get("PRVSCLSGPRIC"))

            # Volume & turnover
            volume = _clean_int(row.get("TTL_TRD_QNTY") or row.get("TOTTRDQTY") or row.get("TTLTRADVOL"))
            turnover_lakhs = _clean_num(row.get("TURNOVER_LACS") or row.get("TOTTRDVAL") or row.get("TTLTRFVAL"))
            total_trades = _clean_int(row.get("NO_OF_TRADES") or row.get("TOTALTRADES") or row.get("TTLNBROFTXNSECTD"))

            # Delivery stats (available in sec_bhavdata_full)
            deliv_qty = _clean_int(row.get("DELIV_QTY") or row.get("DELIVERY_QTY"))
            deliv_pct = _clean_num(row.get("DELIV_PER") or row.get("DELIVERY_PCT"))

            # ISIN
            isin = _clean_str(row.get("ISIN") or row.get("FININSTRMID"))

            records.append((
                symbol,
                series,
                trade_date,
                open_p,
                high_p,
                low_p,
                close_p,
                last_p,
                prev_close,
                volume,
                turnover_lakhs,
                total_trades,
                deliv_qty,
                deliv_pct,
                isin
            ))

        logger.info(f"Parsed {len(records)} equity rows.")
        return records

    @staticmethod
    def parse_indices_data(df: pd.DataFrame, target_date: datetime) -> List[Tuple]:
        """
        Parses ind_close_all into standardized records:
        (index_name, trade_date, open, high, low, close, points_change,
         percent_change, volume, turnover_in_cr, pe, pb, div_yield)
        """
        if df is None or df.empty:
            return []

        # Normalize column headers
        df.columns = [str(c).strip().upper() for c in df.columns]

        records = []
        target_date_str = target_date.strftime("%Y-%m-%d")

        for _, row in df.iterrows():
            index_name = _clean_str(
                row.get("INDEX NAME") or row.get("INDEX_NAME") or row.get("INDEXTITLE")
            )
            if not index_name:
                continue

            raw_date = row.get("INDEX DATE") or row.get("INDEX_DATE") or row.get("TRADEDATE")
            trade_date = _parse_date(raw_date, default_date=target_date) or target_date_str

            open_p = _clean_num(row.get("OPEN INDEX VALUE") or row.get("OPEN"))
            high_p = _clean_num(row.get("HIGH INDEX VALUE") or row.get("HIGH"))
            low_p = _clean_num(row.get("LOW INDEX VALUE") or row.get("LOW"))
            close_p = _clean_num(row.get("CLOSING INDEX VALUE") or row.get("CLOSE"))
            pts_change = _clean_num(row.get("POINTS CHANGE") or row.get("PTS_CHANGE"))
            pct_change = _clean_num(row.get("CHANGE(%)") or row.get("PERCENT_CHANGE") or row.get("PER_CHANGE"))

            volume = _clean_int(row.get("VOLUME") or row.get("TOTAL_VOLUME"))
            turnover_cr = _clean_num(row.get("TURNOVER (RS. CR.)") or row.get("TURNOVER_CR") or row.get("TURNOVER"))

            pe = _clean_num(row.get("P/E") or row.get("PE"))
            pb = _clean_num(row.get("P/B") or row.get("PB"))
            div_yield = _clean_num(row.get("DIV YIELD") or row.get("DIV_YIELD"))

            records.append((
                index_name,
                trade_date,
                open_p,
                high_p,
                low_p,
                close_p,
                pts_change,
                pct_change,
                volume,
                turnover_cr,
                pe,
                pb,
                div_yield
            ))

        logger.info(f"Parsed {len(records)} index rows.")
        return records

    @staticmethod
    def parse_fo_data(df: pd.DataFrame, target_date: datetime) -> List[Tuple]:
        """
        Parses FO Bhavcopy into standardized records:
        (instrument, symbol, expiry_date, strike_price, option_type, trade_date,
         open, high, low, close, settle_price, contracts, val_in_lakhs, open_interest, change_in_oi)
        """
        if df is None or df.empty:
            return []

        df.columns = [str(c).strip().upper() for c in df.columns]
        records = []
        target_date_str = target_date.strftime("%Y-%m-%d")

        for _, row in df.iterrows():
            instrument = _clean_str(row.get("INSTRUMENT") or row.get("FININSTRMTYPE") or "FUTSTK")
            symbol = _clean_str(row.get("SYMBOL") or row.get("TCKRSYMB"))
            if not symbol or not instrument:
                continue

            raw_expiry = row.get("EXPIRY_DT") or row.get("EXPIRYDATE") or row.get("XPIRN_DT")
            expiry_date = _parse_date(raw_expiry)
            if not expiry_date:
                continue

            strike_price = _clean_num(row.get("STRIKE_PR") or row.get("STRKPRIC") or 0.0) or 0.0
            option_type = _clean_str(row.get("OPTION_TYP") or row.get("OPTNTYPE") or "XX") or "XX"

            raw_trade_date = row.get("TIMESTAMP") or row.get("TRADDT")
            trade_date = _parse_date(raw_trade_date, default_date=target_date) or target_date_str

            open_p = _clean_num(row.get("OPEN") or row.get("OPNPRIC"))
            high_p = _clean_num(row.get("HIGH") or row.get("HGHPRIC"))
            low_p = _clean_num(row.get("LOW") or row.get("LWPRIC"))
            close_p = _clean_num(row.get("CLOSE") or row.get("CLSPRIC"))
            settle_p = _clean_num(row.get("SETTLE_PR") or row.get("STTLMPRIC"))

            contracts = _clean_int(row.get("CONTRACTS") or row.get("TTLNBROFCTRCTSTRADD"))
            val_in_lakhs = _clean_num(row.get("VAL_INLAKH") or row.get("TTLTRFVAL"))
            open_interest = _clean_int(row.get("OPEN_INT") or row.get("OPNINTRST"))
            change_in_oi = _clean_int(row.get("CHG_IN_OI") or row.get("CHNGINOPNINTRST"))

            records.append((
                instrument,
                symbol,
                expiry_date,
                strike_price,
                option_type,
                trade_date,
                open_p,
                high_p,
                low_p,
                close_p,
                settle_p,
                contracts,
                val_in_lakhs,
                open_interest,
                change_in_oi
            ))

        logger.info(f"Parsed {len(records)} FO rows.")
        return records
