import os
import sys
from pathlib import Path

# Add root directory to sys.path if not present
BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Import shared base configurations
from scripts.common import (
    BASE_DIR,
    DOWNLOADS_DIR as DOWNLOAD_DIR,
    DB_HOST,
    DB_PORT,
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    DATABASE_URL,
    REQUEST_TIMEOUT,
    RETRY_COUNT,
    RETRY_DELAY,
    DEFAULT_HEADERS as NSE_HEADERS,
)

# NSE Endpoints & URL templates
# 1. Sec Bhavdata Full (Securities with Delivery data)
NSE_SEC_BHAVDATA_URL = "https://archives.nseindia.com/products/content/sec_bhavdata_full_{date_str}.csv"

# 2. UDiFF Cash Market Bhavcopy (New format zipped)
NSE_UDIFF_CM_URL = "https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{date_str}_F_0000.csv.zip"

# 3. Indices Close CSV
NSE_INDICES_URL = "https://archives.nseindia.com/content/indices/ind_close_all_{date_str}.csv"

# 4. Derivatives / F&O Bhavcopy (UDiFF zipped)
NSE_UDIFF_FO_URL = "https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{date_str}_F_0000.csv.zip"

# 5. Historical FO Bhavcopy (Old format zipped)
NSE_HISTORICAL_FO_URL = "https://archives.nseindia.com/content/historical/DERIVATIVES/{year}/{mon}/fo{date_str}bhav.csv.zip"
