import io
import time
import zipfile
import logging
import requests
from datetime import datetime
from typing import Optional, Tuple
import pandas as pd

try:
    from .config import (
        NSE_HEADERS,
        NSE_SEC_BHAVDATA_URL,
        NSE_UDIFF_CM_URL,
        NSE_INDICES_URL,
        NSE_UDIFF_FO_URL,
        NSE_HISTORICAL_FO_URL,
        REQUEST_TIMEOUT,
        RETRY_COUNT,
        RETRY_DELAY,
        DOWNLOAD_DIR,
    )
except ImportError:
    from config import (
        NSE_HEADERS,
        NSE_SEC_BHAVDATA_URL,
        NSE_UDIFF_CM_URL,
        NSE_INDICES_URL,
        NSE_UDIFF_FO_URL,
        NSE_HISTORICAL_FO_URL,
        REQUEST_TIMEOUT,
        RETRY_COUNT,
        RETRY_DELAY,
        DOWNLOAD_DIR,
    )

logger = logging.getLogger(__name__)

class NSEDownloader:
    """
    Handles downloading and extraction of NSE EOD reports with session management,
    retries, and cookie handling.
    """

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(NSE_HEADERS)
        self._init_session()

    def _init_session(self):
        """Initializes cookies by visiting the NSE homepage."""
        try:
            self.session.get("https://www.nseindia.com", timeout=REQUEST_TIMEOUT)
        except Exception as e:
            logger.debug(f"Initial session ping warning (non-fatal): {e}")

    def _request_with_retry(self, url: str) -> Optional[requests.Response]:
        """Performs GET request with exponential backoff retry."""
        for attempt in range(1, RETRY_COUNT + 1):
            try:
                response = self.session.get(url, timeout=REQUEST_TIMEOUT)
                if response.status_code == 200:
                    return response
                elif response.status_code == 404:
                    logger.warning(f"File not found (404) at {url}. Likely a market holiday or not yet published.")
                    return None
                else:
                    logger.warning(f"Attempt {attempt}: Received status {response.status_code} from {url}")
            except Exception as e:
                logger.warning(f"Attempt {attempt} failed for {url}: {e}")

            if attempt < RETRY_COUNT:
                time.sleep(RETRY_DELAY * attempt)

        logger.error(f"Failed to fetch {url} after {RETRY_COUNT} attempts.")
        return None

    def download_sec_bhavdata(self, target_date: datetime) -> Optional[pd.DataFrame]:
        """
        Downloads Security-wise price & delivery data (sec_bhavdata_full_DDMMYYYY.csv).
        This file contains complete cash market data including deliverable quantity & %.
        """
        date_str = target_date.strftime("%d%m%Y")
        url = NSE_SEC_BHAVDATA_URL.format(date_str=date_str)
        logger.info(f"Downloading Equities / Sec Bhavdata for {target_date.strftime('%Y-%m-%d')} from {url}...")
        
        response = self._request_with_retry(url)
        if response and response.content:
            try:
                csv_file = io.BytesIO(response.content)
                df = pd.read_csv(csv_file)
                # Save copy to download folder
                out_path = DOWNLOAD_DIR / f"sec_bhavdata_full_{date_str}.csv"
                out_path.write_bytes(response.content)
                return df
            except Exception as e:
                logger.error(f"Error parsing Sec Bhavdata CSV for {date_str}: {e}")
                return None
        return None

    def download_udiff_cm_bhavcopy(self, target_date: datetime) -> Optional[pd.DataFrame]:
        """
        Downloads UDiFF CM Bhavcopy (Zip format).
        Used as fallback or complementary source for Cash Market.
        """
        date_str = target_date.strftime("%Y%m%d")
        url = NSE_UDIFF_CM_URL.format(date_str=date_str)
        logger.info(f"Downloading UDiFF CM Bhavcopy for {target_date.strftime('%Y-%m-%d')} from {url}...")

        response = self._request_with_retry(url)
        if response and response.content:
            try:
                with zipfile.ZipFile(io.BytesIO(response.content)) as z:
                    for filename in z.namelist():
                        if filename.endswith(".csv"):
                            with z.open(filename) as f:
                                df = pd.read_csv(f)
                                return df
            except Exception as e:
                logger.error(f"Error extracting UDiFF CM Zip for {date_str}: {e}")
                return None
        return None

    def download_indices_eod(self, target_date: datetime) -> Optional[pd.DataFrame]:
        """
        Downloads All Indices EOD close data (ind_close_all_DDMMYYYY.csv).
        """
        date_str = target_date.strftime("%d%m%Y")
        url = NSE_INDICES_URL.format(date_str=date_str)
        logger.info(f"Downloading Indices data for {target_date.strftime('%Y-%m-%d')} from {url}...")

        response = self._request_with_retry(url)
        if response and response.content:
            try:
                csv_file = io.BytesIO(response.content)
                df = pd.read_csv(csv_file)
                out_path = DOWNLOAD_DIR / f"ind_close_all_{date_str}.csv"
                out_path.write_bytes(response.content)
                return df
            except Exception as e:
                logger.error(f"Error parsing Indices CSV for {date_str}: {e}")
                return None
        return None

    def download_fo_bhavcopy(self, target_date: datetime) -> Optional[pd.DataFrame]:
        """
        Downloads F&O Bhavcopy. Tries UDiFF format first, then historical format.
        """
        # Try UDiFF format
        date_str_udiff = target_date.strftime("%Y%m%d")
        url_udiff = NSE_UDIFF_FO_URL.format(date_str=date_str_udiff)
        logger.info(f"Downloading F&O Bhavcopy for {target_date.strftime('%Y-%m-%d')}...")

        response = self._request_with_retry(url_udiff)
        if response and response.content:
            try:
                with zipfile.ZipFile(io.BytesIO(response.content)) as z:
                    for filename in z.namelist():
                        if filename.endswith(".csv"):
                            with z.open(filename) as f:
                                return pd.read_csv(f)
            except Exception as e:
                logger.debug(f"UDiFF FO extraction failed: {e}")

        # Fallback to historical format
        year = target_date.strftime("%Y")
        mon = target_date.strftime("%b").upper()
        date_str_hist = target_date.strftime("%d%b%Y").upper()
        url_hist = NSE_HISTORICAL_FO_URL.format(year=year, mon=mon, date_str=date_str_hist)

        response = self._request_with_retry(url_hist)
        if response and response.content:
            try:
                with zipfile.ZipFile(io.BytesIO(response.content)) as z:
                    for filename in z.namelist():
                        if filename.endswith(".csv"):
                            with z.open(filename) as f:
                                return pd.read_csv(f)
            except Exception as e:
                logger.error(f"Historical FO extraction failed for {date_str_hist}: {e}")

        return None
