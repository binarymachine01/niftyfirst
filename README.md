# Market Data Ingestion & Extraction Suite

A production-grade Python repository for downloading, parsing, extracting, and scheduling financial market datasets (NSE Bhavcopy EOD data, Insider Trading & Deals, and future market data sources).

---

## Central Common Architecture

All scripts are unified under a shared core library (`scripts/common/`) and accessed through a single entrypoint CLI (`run.py`):

```
NiftyFirst/
├── run.py                             # Central CLI entrypoint & dispatcher for all scripts
├── .env                               # Database credentials & global environment variables
├── .env.example                       # Template for environment variables
├── requirements.txt                   # Python project dependencies
├── README.md                          # Project documentation
├── downloads/                         # Output folder for raw CSVs, Zips & Excel reports
├── logs/                              # Execution logs
└── scripts/
    ├── __init__.py
    ├── common/                        # Common Shared Library across all scripts
    │   ├── __init__.py                # Base paths, .env loader, DB config & logger setup
    │   ├── http_client.py             # Reusable HTTP client with browser spoofing & retry logic
    │   └── runner.py                  # Dynamic script registry & execution manager
    │
    ├── nse_eod/                       # NSE EOD Bhavcopy Ingestion Pipeline
    │   ├── __init__.py
    │   ├── config.py                  # Uses scripts.common + NSE URL templates
    │   ├── database.py                # PostgreSQL schema management & bulk upsert engine
    │   ├── downloader.py              # NSE download client with retry & zip extraction
    │   ├── parser.py                  # Data sanitization, header normalization & validation
    │   └── main.py                    # Pipeline execution script
    │
    └── insider_data_extractor/        # Insider Trading & Deals Extractor
        ├── __init__.py
        └── stockedge_deals_extractor.py # Uses scripts.common to export deals to Excel
```

---

## Installation & Setup

### 1. Create Virtual Environment & Install Dependencies

```bash
# Create virtual environment
python -m venv .venv

# Activate virtual environment
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

# Install required packages
pip install -r requirements.txt
```

### 2. Configure Environment Variables

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Set your PostgreSQL credentials (used by the NSE EOD pipeline):

```ini
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nse_market_data
DB_USER=postgres
DB_PASSWORD=your_secure_password

# Or provide a single connection string:
# DATABASE_URL=postgresql://postgres:your_secure_password@localhost:5432/nse_market_data
```

Ensure the database `nse_market_data` exists in PostgreSQL:
```sql
CREATE DATABASE nse_market_data;
```

---

## 🎯 Unified Script Execution via `run.py`

You can access, run, or list all scripts through the central `run.py` CLI:

### 1. List All Available Scripts & Schedules
```bash
python run.py list
```

### 2. Run NSE EOD Ingestion Pipeline (`nse_eod`)
```bash
# Download today's data (Cash Market, Indices, F&O)
python run.py nse_eod --today

# Download for a specific date
python run.py nse_eod --date 2024-08-20

# Backfill a historical date range
python run.py nse_eod --from 2024-08-01 --to 2024-08-20

# Download specific segments only (cm = Equities, indices = Indices, fo = Derivatives)
python run.py nse_eod --date 2024-08-20 --segment cm

# Initialize database schema only
python run.py nse_eod --init-db
```

### 3. Run Insider Data & Deals Extractor (`insider_data_extractor`)
```bash
# Daily incremental run (checks DB for existing IDs, skips duplicates & stops early):
python run.py insider_data_extractor

# Initialize insider deals database tables, indexes & view only:
python run.py insider_data_extractor --init-db

# Run full historical backfill / sync (does not stop on existing IDs):
python run.py insider_data_extractor --full-sync

# Extract specific deal category (choices: insider, sast, block, bulk, all):
python run.py insider_data_extractor --category insider

# Custom page limit:
python run.py insider_data_extractor --max-pages 5

# Export Excel only (skip DB ingestion):
python run.py insider_data_extractor --no-db

# DB ingestion only (skip Excel file generation):
python run.py insider_data_extractor --no-excel
```
*(Extracts Block, Bulk, Insider Trading, and SAST deals into PostgreSQL and saves multi-sheet Excel report to `downloads/stockedge_all_deals.xlsx`)*

### 4. Run All Registered Scripts Sequentially
```bash
python run.py all
```

---

## 🛠️ Adding Future Scripts & Pipelines

When you add new scripts in the future:

### Step 1: Create script folder under `scripts/`
Example: `scripts/fii_dii/main.py`

```python
import sys
from pathlib import Path

# Add root directory to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Import shared configs, logger, and http client
from scripts.common import BASE_DIR, DOWNLOADS_DIR, setup_logger
from scripts.common.http_client import HttpClient

logger = setup_logger("FII_DII_Pipeline")
http = HttpClient()

def main():
    logger.info("Extracting FII/DII data...")
    # Your extraction logic here

if __name__ == "__main__":
    main()
```

### Step 2: Register in `scripts/common/runner.py`
Add your new script to `SCRIPT_REGISTRY`:

```python
"fii_dii": {
    "name": "FII / DII Flow Extractor",
    "script_path": BASE_DIR / "scripts" / "fii_dii" / "main.py",
    "description": "Extracts daily institutional flow data",
    "default_args": [],
    "schedule_cron": "00 20 * * 1-5",
},
```

Now your script is immediately accessible via:
```bash
python run.py fii_dii
```

---

## ⏰ Automated Scheduling

            ### Linux / macOS Cron Jobs

```bash
# Run all daily pipelines at 20:30 IST on weekdays
30 20 * * 1-5 cd /path/to/NiftyFirst && .venv/bin/python run.py all >> logs/daily_sync.log 2>&1

# Or run individual scripts:
# 30 20 * * 1-5 cd /path/to/NiftyFirst && .venv/bin/python run.py nse_eod --today >> logs/nse_eod.log 2>&1
# 00 21 * * 1-5 cd /path/to/NiftyFirst && .venv/bin/python run.py insider_data_extractor >> logs/insider_deals.log 2>&1
```

### Windows Task Scheduler (PowerShell)

```powershell
# Schedule unified run for all pipelines
$Action = New-ScheduledTaskAction -Execute "E:\Workspace\NiftyFirst\.venv\Scripts\python.exe" -Argument "run.py all" -WorkingDirectory "E:\Workspace\NiftyFirst"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 8:30PM
Register-ScheduledTask -TaskName "Daily_Market_Data_Sync" -Action $Action -Trigger $Trigger
```
