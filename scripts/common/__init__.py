"""
Common shared module for all data extraction and ingestion scripts.
Provides centralized path configuration, environment loading, HTTP utilities, and logging.
"""

import os
import sys
import logging
from pathlib import Path
from dotenv import load_dotenv

# ==============================================================================
# BASE PROJECT DIRECTORIES & ENVIRONMENT
# ==============================================================================
# Root project directory
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Load environment variables from .env located at root
load_dotenv(BASE_DIR / ".env")
load_dotenv()

# Common folders
DOWNLOADS_DIR = Path(os.getenv("DOWNLOADS_DIR", BASE_DIR / "downloads"))
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

LOGS_DIR = Path(os.getenv("LOGS_DIR", BASE_DIR / "logs"))
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# Database Configuration (PostgreSQL)
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "nse_market_data")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DATABASE_URL = os.getenv("DATABASE_URL")

# Request & Downloader Configuration
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "30"))
RETRY_COUNT = int(os.getenv("RETRY_COUNT", "3"))
RETRY_DELAY = int(os.getenv("RETRY_DELAY", "2"))

# Standard Browser Headers
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/json",
    "Accept-Language": "en-US,en;q=0.9",
    "Connection": "keep-alive",
}

# ==============================================================================
# LOGGING SETUP
# ==============================================================================
def setup_logger(name: str, log_file: str = None, level: int = logging.INFO) -> logging.Logger:
    """Configures a standardized logger with console and optional file handlers."""
    logger = logging.getLogger(name)
    logger.setLevel(level)

    # Avoid duplicate handlers if logger already initialized
    if not logger.handlers:
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        )

        # Console handler
        ch = logging.StreamHandler(sys.stdout)
        ch.setFormatter(formatter)
        logger.addHandler(ch)

        # Optional file handler
        if log_file:
            log_path = LOGS_DIR / log_file
            fh = logging.FileHandler(log_path, encoding="utf-8")
            fh.setFormatter(formatter)
            logger.addHandler(fh)

    return logger
