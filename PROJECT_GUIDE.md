# NiftyFirst: Complete System Architecture & User Guide

**NiftyFirst** is a high-performance quantitative market data ingestion, analysis, and backtesting platform built for the Indian stock market (National Stock Exchange of India - NSE). It combines automated data pipelines, a PostgreSQL time-series warehouse, an event-driven backtesting engine for insider/institutional deals, a FastAPI REST API, and a React web interface.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Directory & File Structure](#2-directory--file-structure)
3. [Prerequisites & Environment Setup](#3-prerequisites--environment-setup)
4. [Data Ingestion Pipelines (`scripts/`)](#4-data-ingestion-pipelines)
   - [NSE EOD Bhavcopy Ingestion (`scripts/nse_eod`)](#nse-eod-bhavcopy-ingestion)
   - [StockEdge Deals & Insider Trading Extractor (`scripts/insider_data_extractor`)](#stockedge-deals--insider-trading-extractor)
   - [Central Script Runner (`run.py` & `scripts/common`)](#central-script-runner)
5. [Backend API & Quantitative Engines (`backend/`)](#5-backend-api--quantitative-engines)
   - [Quantitative Backtesting Engine (`backend/engine/backtester.py`)](#quantitative-backtesting-engine)
   - [Symbol Resolution Engine (`backend/engine/symbol_matcher.py`)](#symbol-resolution-engine)
   - [Async Task Manager (`backend/engine/task_manager.py`)](#async-task-manager)
   - [FastAPI Endpoints & Routers](#fastapi-endpoints--routers)
6. [Frontend Web Application (`frontend/`)](#6-frontend-web-application)
   - [Tabs & User Interfaces](#tabs--user-interfaces)
   - [Frontend Architecture & Component Tree](#frontend-architecture--component-tree)
7. [Database Schema Reference](#7-database-schema-reference)
8. [Quickstart & Operations Guide](#8-quickstart--operations-guide)
9. [Automated Scheduling & Production Deployment](#9-automated-scheduling--production-deployment)

---

## 1. System Architecture Overview

```mermaid
flowchart TB
    subgraph ExternalSources["External Data Sources"]
        NSE["NSE India Archive\n(Bhavcopy & Delivery Data)"]
        StockEdge["StockEdge Public API\n(Insider, SAST, Block, Bulk)"]
    end

    subgraph Ingestion["Ingestion Pipelines (scripts/)"]
        Runner["run.py / scripts/common/runner.py"]
        NSEPipeline["NSE EOD Pipeline\n(Downloader -> Parser -> DB Upsert)"]
        DealsPipeline["Deals Extractor\n(Incremental Fetcher -> DB Upsert -> Excel)"]
        Runner --> NSEPipeline
        Runner --> DealsPipeline
        NSE --> NSEPipeline
        StockEdge --> DealsPipeline
    end

    subgraph Storage["PostgreSQL Database (nse_market_data)"]
        EquityEOD[("nse_equity_eod\n(OHLCV + Delivery)")]
        IndicesEOD[("nse_indices_eod")]
        FOEOD[("nse_fo_eod")]
        InsiderDeals[("stockedge_insider_deals")]
        SASTDeals[("stockedge_sast_deals")]
        BlockDeals[("stockedge_block_deals")]
        BulkDeals[("stockedge_bulk_deals")]
        ConsolidatedView[("stockedge_all_deals_view")]

        InsiderDeals --> ConsolidatedView
        SASTDeals --> ConsolidatedView
        BlockDeals --> ConsolidatedView
        BulkDeals --> ConsolidatedView
    end

    NSEPipeline --> EquityEOD & IndicesEOD & FOEOD
    DealsPipeline --> InsiderDeals & SASTDeals & BlockDeals & BulkDeals

    subgraph BackendAPI["Backend API (backend/ - FastAPI)"]
        APIServer["FastAPI Application (backend/main.py)"]
        Backtester["BacktestEngine (backtester.py)"]
        Matcher["SymbolMatcher (symbol_matcher.py)"]
        TaskManager["TaskManager (task_manager.py)"]

        APIServer --> Backtester & Matcher & TaskManager
        Backtester --> ConsolidatedView & EquityEOD
        Matcher --> EquityEOD
        TaskManager --> Runner
    end

    subgraph FrontendApp["Frontend Dashboard (frontend/ - React + Vite + Tailwind)"]
        UI["React SPA"]
        Tab1["Backtesting Lab"]
        Tab2["Deals Explorer"]
        Tab3["Stock Inspector"]
        Tab4["System & Pipelines"]
        UI --> Tab1 & Tab2 & Tab3 & Tab4
    end

    FrontendApp <-->|REST API / Axios| BackendAPI
```

---

## 2. Directory & File Structure

```
NiftyFirst/
├── run.py                                     # Central CLI runner & process dispatcher
├── requirements.txt                           # Python dependencies
├── .env.example                               # Environment template
├── .env                                       # Local environment configuration
├── README.md                                  # Quick project summary
├── PROJECT_GUIDE.md                           # Complete architecture & operations guide
│
├── backend/                                   # FastAPI Web Application & Engines
│   ├── main.py                                # App factory, CORS, static mounting
│   ├── config.py                              # Backend configuration & environment reader
│   ├── database.py                            # Database connection pooling & query helpers
│   ├── engine/                                # Core quantitative & background engines
│   │   ├── backtester.py                      # Multi-asset quantitative backtesting engine
│   │   ├── symbol_matcher.py                  # Slug/Name -> NSE Symbol resolver
│   │   └── task_manager.py                    # Background pipeline runner & log streamer
│   └── routers/                               # API Routers
│       ├── backtest.py                        # /api/backtest (run simulation, presets)
│       ├── deals.py                           # /api/deals (search, filter, aggregate)
│       ├── stocks.py                          # /api/stocks (OHLCV candles, symbol deals)
│       └── system.py                          # /api/system (health, row counts, run scripts)
│
├── frontend/                                  # React 18 + Vite + Tailwind CSS SPA
│   ├── package.json                           # NPM dependencies (Chart.js, Lucide, Tailwind)
│   ├── vite.config.js                         # Vite build & proxy config
│   ├── tailwind.config.js                     # Tailwind CSS styling tokens
│   ├── index.html                             # Single page HTML template
│   └── src/
│       ├── main.jsx                           # React DOM mount point
│       ├── App.jsx                            # Main layout & Tab controller
│       ├── index.css                          # Custom styles & Tailwind imports
│       ├── services/
│       │   └── api.js                         # Axios API service client
│       └── components/
│           ├── Navbar.jsx                     # Header navigation & DB health indicator
│           ├── BacktestConfigForm.jsx         # Strategy parameters & preset buttons
│           ├── MetricCards.jsx                # KPI summary cards (CAGR, Sharpe, Win Rate)
│           ├── EquityCurveChart.jsx           # Portfolio Equity Curve (Chart.js)
│           ├── DrawdownChart.jsx              # Underwater Drawdown chart
│           ├── TradeLogTable.jsx              # Paginated simulated trades table
│           ├── DealsExplorer.jsx              # Deals filter & search table with stats
│           ├── StockInspector.jsx             # Stock price chart + deal overlays
│           └── SystemStatus.jsx               # DB statistics & Live Pipeline triggers
│
├── scripts/                                   # ETL & Market Ingestion Pipelines
│   ├── common/                                # Shared infrastructure for scripts
│   │   ├── __init__.py                        # Paths, logging setup, DB config
│   │   ├── http_client.py                     # Resilient HTTP client with retries
│   │   └── runner.py                          # Script registry & execution manager
│   ├── nse_eod/                               # NSE Bhavcopy Ingestion Engine
│   │   ├── config.py                          # NSE URLs, segment definitions, holidays
│   │   ├── database.py                        # DDL creation & bulk COPY/UPSERT engine
│   │   ├── downloader.py                      # Parallel downloader with Zip extraction
│   │   ├── parser.py                          # Data sanitization, delivery merge
│   │   └── main.py                            # Pipeline orchestrator
│   └── insider_data_extractor/                # StockEdge Deals Ingestion
│       ├── database.py                        # Deals DDL, indexes, and views
│       └── stockedge_deals_extractor.py       # API pagination, duplicate prevention, Excel
│
├── downloads/                                 # Storage for raw CSVs, Zips & Excel reports
└── logs/                                      # Runtime execution logs
```

---

## 3. Prerequisites & Environment Setup

### 3.1 Software Requirements
- **Python**: 3.9+ (Python 3.10 / 3.11 / 3.12 recommended)
- **PostgreSQL**: 13+ (running locally or remotely)
- **Node.js & npm**: Node 18+ (for building the frontend)

### 3.2 Python Environment Setup
```bash
# 1. Create a virtual environment
python -m venv .venv

# 2. Activate virtual environment
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

# 3. Install Python dependencies
pip install -r requirements.txt
```

### 3.3 Database Configuration
Copy `.env.example` to `.env` and fill in your PostgreSQL credentials:

```ini
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nse_market_data
DB_USER=postgres
DB_PASSWORD=your_postgres_password

# Optional: full connection string
# DATABASE_URL=postgresql://postgres:your_postgres_password@localhost:5432/nse_market_data

# API Settings
API_HOST=0.0.0.0
API_PORT=8000
```

Create the PostgreSQL database if it does not already exist:
```sql
CREATE DATABASE nse_market_data;
```

---

## 4. Data Ingestion Pipelines

All ingestion pipelines can be triggered directly from the central CLI (`run.py`) or programmatically via the web UI.

### NSE EOD Bhavcopy Ingestion
Located in [`scripts/nse_eod/`](file:///e:/Workspace/NiftyFirst/scripts/nse_eod):
- **Features**:
  - Downloads official NSE Bhavcopy files: Cash Market (`cm`), Indices (`indices`), and Derivatives / F&O (`fo`).
  - Downloads and merges security-wise delivery position reports (`delivery_qty`, `delivery_pct`).
  - Robust retry handling with session pooling and randomized user-agents.
  - High-speed PostgreSQL upserting using `execute_values` / `ON CONFLICT DO UPDATE`.
- **Execution Examples**:
  ```bash
  # Initialize tables and indexes
  python run.py nse_eod --init-db

  # Download and ingest today's data
  python run.py nse_eod --today

  # Download for a specific date (YYYY-MM-DD)
  python run.py nse_eod --date 2024-08-20

  # Historical backfill over a date range
  python run.py nse_eod --from 2024-01-01 --to 2024-08-20

  # Ingest only the Cash Market segment
  python run.py nse_eod --date 2024-08-20 --segment cm
  ```

---

### StockEdge Deals & Insider Trading Extractor
Located in [`scripts/insider_data_extractor/`](file:///e:/Workspace/NiftyFirst/scripts/insider_data_extractor):
- **Supported Categories**:
  1. **Insider Trading**: SEBI PIT disclosures (Promoter / Director / KMP transactions, market purchases, ESOPs).
  2. **SAST Deals**: Substantial Acquisition of Shares and Takeovers disclosures.
  3. **Block Deals**: Single trades > ₹5 Crore executed during dedicated 15-minute trading windows.
  4. **Bulk Deals**: Total daily trades executed by a single entity exceeding 0.5% of total company equity.
- **Key Features**:
  - **Incremental Fetching & Duplicate Prevention**: Queries existing IDs in PostgreSQL and halts early upon reaching previously ingested records.
  - **Excel Export**: Produces a clean multi-sheet workbook at `downloads/stockedge_all_deals.xlsx`.
  - **Consolidated View**: Automatically creates `stockedge_all_deals_view` unifying all four deal types for simplified quantitative analysis.
- **Execution Examples**:
  ```bash
  # Initialize database tables and consolidated view
  python run.py insider_data_extractor --init-db

  # Incremental daily run (recommended for daily sync)
  python run.py insider_data_extractor

  # Full historical backfill (crawls all available pages)
  python run.py insider_data_extractor --full-sync

  # Extract specific category only (choices: insider, sast, block, bulk, all)
  python run.py insider_data_extractor --category insider

  # Ingest into DB without exporting Excel
  python run.py insider_data_extractor --no-excel
  ```

---

### Central Script Runner
Located in [`run.py`](file:///e:/Workspace/NiftyFirst/run.py) and [`scripts/common/runner.py`](file:///e:/Workspace/NiftyFirst/scripts/common/runner.py):
- Provides unified CLI discovery and execution for all pipelines.
- **Commands**:
  ```bash
  # View all registered pipelines and schedules
  python run.py list

  # Run all registered scripts sequentially
  python run.py all

  # Launch the FastAPI backend server
  python run.py web
  ```

---

## 5. Backend API & Quantitative Engines

The backend is built with FastAPI and provides an asynchronous REST API for the frontend and external consumers.

### Quantitative Backtesting Engine
File: [`backend/engine/backtester.py`](file:///e:/Workspace/NiftyFirst/backend/engine/backtester.py)

The backtester models realistic equity portfolio simulations based on insider/deal signals:
- **Signal Matching**: When a deal occurs on date $T$, the engine resolves the target NSE symbol and identifies the entry candle at date $T+1$ (open price).
- **Execution Simulation**:
  - **Holding Period**: Exit at close price after $N$ trading days.
  - **Stop-Loss Protection**: If daily low breaches the stop-loss percentage, the position exits immediately at the stop price.
  - **Take-Profit Target**: If daily high reaches the profit target, the position exits at the target price.
  - **Portfolio Sizing**: Allocates a configurable percentage of current capital per trade with portfolio cash constraints.
- **Key Quantitative Output Metrics**:
  - Total Return (%) and CAGR (%)
  - Maximum Drawdown (%) & Drawdown Duration
  - Sharpe Ratio ($\text{Risk-Free Rate} = 6.0\%$) & Sortino Ratio
  - Profit Factor ($\frac{\text{Gross Profits}}{\text{Gross Losses}}$)
  - Win Rate (%), Total Trades, Win/Loss Counts, Average Return per Trade
  - Daily Equity Curve time series for charting

---

### Symbol Resolution Engine
File: [`backend/engine/symbol_matcher.py`](file:///e:/Workspace/NiftyFirst/backend/engine/symbol_matcher.py)

Deals from StockEdge use corporate entity names and URL slugs (e.g. `hindustan-unilever` or `Reliance Industries Limited`), while price history in `nse_equity_eod` uses NSE trading tickers (e.g. `HINDUNILVR`, `RELIANCE`).

The `SymbolMatcher` uses a four-tier fuzzy resolution algorithm:
1. **Explicit Dictionary**: Fast mapping for major conglomerates and indices.
2. **Slug Normalization**: Stripping hyphens and punctuation to match NSE symbol tokens.
3. **Corporate Suffix Stripping**: Removing `LTD`, `LIMITED`, `CORP`, `INDIA` followed by token prefix matching.
4. **LRU In-Memory Caching**: Resolves each symbol once and caches result for subsequent queries.

---

### Async Task Manager
File: [`backend/engine/task_manager.py`](file:///e:/Workspace/NiftyFirst/backend/engine/task_manager.py)

Enables users to trigger data pipelines from the web UI:
- Spawns background Python subprocesses.
- Streams stdout and stderr logs in real time.
- Keeps an execution history and provides graceful process termination.

---

### FastAPI Endpoints & Routers

| Endpoint | Method | Router | Description |
|---|---|---|---|
| `/api/health` | `GET` | Main | Health status of API server |
| `/api/backtest/run` | `POST` | `backtest` | Executes quantitative simulation with user strategy parameters |
| `/api/backtest/preset-strategies` | `GET` | `backtest` | Returns pre-built strategy templates (e.g. High-Conviction Promoter Buy) |
| `/api/deals` | `GET` | `deals` | Paginated search across `stockedge_all_deals_view` with filters |
| `/api/deals/summary` | `GET` | `deals` | Summary turnover and trade counts grouped by deal category |
| `/api/stocks/list` | `GET` | `stocks` | Auto-complete list of active NSE tickers |
| `/api/stocks/{symbol}/history` | `GET` | `stocks` | Daily OHLCV candles and delivery percentage |
| `/api/stocks/{symbol}/deals` | `GET` | `stocks` | Historical insider and block deals for the specified stock |
| `/api/system/status` | `GET` | `system` | Database connectivity, total row counts, and date ranges |
| `/api/system/scripts` | `GET` | `system` | List of runnable data pipelines |
| `/api/system/run-script` | `POST` | `system` | Trigger a pipeline in the background |
| `/api/system/tasks` | `GET` | `system` | Recent background pipeline tasks |
| `/api/system/tasks/{id}` | `GET` | `system` | Live status and terminal logs for a specific task |
| `/api/system/tasks/{id}/stop`| `POST` | `system` | Stop an active background pipeline task |

---

## 6. Frontend Web Application

The frontend is located in [`frontend/`](file:///e:/Workspace/NiftyFirst/frontend) and is built using **React 18**, **Vite**, **Tailwind CSS**, and **Chart.js**.

### Tabs & User Interfaces

```
+-----------------------------------------------------------------------------------------+
|  NIFTYFIRST  |  [Backtesting Lab]  [Deals Explorer]  [Stock Inspector]  [System Status] |
+-----------------------------------------------------------------------------------------+
```

1. **Backtesting Lab (`BacktestConfigForm`, `MetricCards`, `EquityCurveChart`, `DrawdownChart`, `TradeLogTable`)**:
   - Strategy configuration sidebar: Holding days (1-250), categories (Insider, SAST, Block, Bulk), Direction (BUY/SELL), Minimum deal value, Stop-loss %, Take-profit %, Position sizing %.
   - 1-Click Strategy Presets: *Promoter High-Conviction Long*, *Institutional Block Deal Follower*, *SAST Acquisition Swing*, *All Deals Combined*.
   - Performance KPI metrics: Net Return, CAGR, Sharpe Ratio, Sortino Ratio, Max Drawdown, Win Rate, Profit Factor.
   - Interactive Portfolio Equity Curve & Underwater Drawdown charts.
   - Complete Trade Execution Log with entry/exit dates, trade duration, entry/exit prices, return %, and P&L.

2. **Deals Explorer (`DealsExplorer`)**:
   - Live multi-category deal stream with search by company name, client name, category, and date range.
   - Category turnover breakdown cards and top traded securities.

3. **Stock Inspector (`StockInspector`)**:
   - Interactive ticker lookup.
   - Daily price chart with delivery percentage trends.
   - Historical deal overlay table displaying all promoter and institutional transactions for that stock.

4. **Database & Pipeline System (`SystemStatus`)**:
   - Live health status and row counters for `nse_equity_eod`, `stockedge_insider_deals`, `stockedge_block_deals`, etc.
   - 1-Click Pipeline Runner: Trigger NSE Bhavcopy or StockEdge crawler directly from the UI.
   - Real-time terminal log viewer with status indicators and abort buttons.

---

## 7. Database Schema Reference

### 7.1 `nse_equity_eod`
Primary table for NSE Cash Market daily Bhavcopy and delivery stats:
```sql
CREATE TABLE nse_equity_eod (
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
```

### 7.2 Deals Tables & Consolidated View
Four tables (`stockedge_insider_deals`, `stockedge_sast_deals`, `stockedge_block_deals`, `stockedge_bulk_deals`) are indexed by `trade_date`, `security_name`, and `client_name`, and unified by the database view:

```sql
CREATE OR REPLACE VIEW stockedge_all_deals_view AS
SELECT 'Insider Trading' AS deal_category, id, trade_date, exchange_name, security_name, client_name, action, quantity, price, total_value, mode_description, created_at FROM stockedge_insider_deals
UNION ALL
SELECT 'SAST Deals' AS deal_category, id, trade_date, exchange_name, security_name, client_name, action, quantity, price, total_value, mode_description, created_at FROM stockedge_sast_deals
UNION ALL
SELECT 'Block Deals' AS deal_category, id, trade_date, exchange_name, security_name, client_name, action, quantity, price, total_value, NULL AS mode_description, created_at FROM stockedge_block_deals
UNION ALL
SELECT 'Bulk Deals' AS deal_category, id, trade_date, exchange_name, security_name, client_name, action, quantity, price, total_value, NULL AS mode_description, created_at FROM stockedge_bulk_deals;
```

---

## 8. Quickstart & Operations Guide

### Step 1: Initialize Database
```bash
python run.py nse_eod --init-db
python run.py insider_data_extractor --init-db
```

### Step 2: Ingest Market Data
```bash
# Ingest recent NSE Bhavcopy data (e.g. 2024-01-01 to present)
python run.py nse_eod --from 2024-01-01 --to 2024-08-20

# Ingest StockEdge Insider & Block Deals
python run.py insider_data_extractor --full-sync
```

### Step 3: Launch Web Application
You can run the frontend in development mode or build it for production:

#### Option A: Development Mode (Vite Dev Server + FastAPI)
```bash
# Terminal 1: Start Backend API (Port 8000)
python run.py web

# Terminal 2: Start Frontend Dev Server (Port 5173)
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

#### Option B: Unified Production Mode
```bash
# 1. Build frontend bundle
cd frontend
npm run build
cd ..

# 2. Start FastAPI (serves both API and built React SPA from /dist on port 8000)
python run.py web
```
Open `http://localhost:8000` in your browser.

---

## 9. Automated Scheduling & Production Deployment

### Linux / macOS Cron Scheduling (`crontab -e`)
Run daily sync scripts automatically on weekdays after market close:
```bash
# 1. Download NSE Bhavcopy at 20:30 IST on Weekdays
30 20 * * 1-5 cd /path/to/NiftyFirst && .venv/bin/python run.py nse_eod --today >> logs/nse_eod.log 2>&1

# 2. Extract StockEdge Insider & Block Deals at 21:00 IST on Weekdays
00 21 * * 1-5 cd /path/to/NiftyFirst && .venv/bin/python run.py insider_data_extractor >> logs/insider_deals.log 2>&1

# Or run all pipelines together at 20:30 IST:
30 20 * * 1-5 cd /path/to/NiftyFirst && .venv/bin/python run.py all >> logs/daily_sync.log 2>&1
```

### Windows Task Scheduler (PowerShell)
```powershell
$Action = New-ScheduledTaskAction -Execute "E:\Workspace\NiftyFirst\.venv\Scripts\python.exe" -Argument "run.py all" -WorkingDirectory "E:\Workspace\NiftyFirst"
$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 8:30PM
Register-ScheduledTask -TaskName "NiftyFirst_Daily_Market_Sync" -Action $Action -Trigger $Trigger
```
