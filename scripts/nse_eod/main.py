import argparse
import logging
import sys
from datetime import datetime, timedelta
from typing import List
from pathlib import Path

# Ensure script directory is in sys.path when executed directly
_script_dir = Path(__file__).resolve().parent
if str(_script_dir) not in sys.path:
    sys.path.insert(0, str(_script_dir))

try:
    from .database import Database
    from .downloader import NSEDownloader
    from .parser import DataParser
except ImportError:
    from database import Database
    from downloader import NSEDownloader
    from parser import DataParser

# Configure standard logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("NSE_EOD_Pipeline")

def process_date(target_date: datetime, segments: List[str], db: Database, downloader: NSEDownloader, force: bool = False):
    """Processes all requested segments for a single trading date."""
    date_str = target_date.strftime("%Y-%m-%d")
    weekday = target_date.strftime("%A")

    if target_date.weekday() >= 5:  # Saturday or Sunday
        logger.info(f"Skipping {date_str} ({weekday}) - Weekend.")
        return

    logger.info(f"==================================================")
    logger.info(f"Checking / Processing NSE EOD data for {date_str} ({weekday})")
    logger.info(f"==================================================")

    # Check which segments already exist in DB to avoid redundant downloads & processing
    segments_to_process = []
    for seg in segments:
        count = db.get_existing_segment_count(target_date, seg)
        if count > 0 and not force:
            logger.info(f"-> [{seg.upper()}] Date {date_str} already exists in DB ({count} rows). Skipping to avoid duplicates.")
        else:
            segments_to_process.append(seg)

    if not segments_to_process:
        logger.info(f"All requested segments for {date_str} already exist in DB. Skipped duplicate processing (use --force to re-download).")
        return

    # 1. Equity / Cash Market Segment
    if "cm" in segments_to_process:
        try:
            # Try Sec Bhavdata first (has delivery stats)
            df_equity = downloader.download_sec_bhavdata(target_date)
            if df_equity is None or df_equity.empty:
                logger.info(f"Sec Bhavdata not found for {date_str}, attempting UDiFF Bhavcopy fallback...")
                df_equity = downloader.download_udiff_cm_bhavcopy(target_date)

            if df_equity is not None and not df_equity.empty:
                records = DataParser.parse_equity_data(df_equity, target_date)
                if records:
                    count = db.upsert_equity_data(records)
                    logger.info(f"-> Successfully saved {count} equity records for {date_str}")
            else:
                logger.warning(f"No equity data available for {date_str} (Market Holiday / Data Not Published)")
        except Exception as e:
            logger.error(f"Error processing Equity data for {date_str}: {e}", exc_info=True)

    # 2. Indices Segment
    if "indices" in segments_to_process:
        try:
            df_indices = downloader.download_indices_eod(target_date)
            if df_indices is not None and not df_indices.empty:
                records = DataParser.parse_indices_data(df_indices, target_date)
                if records:
                    count = db.upsert_indices_data(records)
                    logger.info(f"-> Successfully saved {count} index records for {date_str}")
            else:
                logger.warning(f"No indices data available for {date_str}")
        except Exception as e:
            logger.error(f"Error processing Indices data for {date_str}: {e}", exc_info=True)

    # 3. Derivatives / F&O Segment
    if "fo" in segments_to_process:
        try:
            df_fo = downloader.download_fo_bhavcopy(target_date)
            if df_fo is not None and not df_fo.empty:
                records = DataParser.parse_fo_data(df_fo, target_date)
                if records:
                    count = db.upsert_fo_data(records)
                    logger.info(f"-> Successfully saved {count} F&O records for {date_str}")
            else:
                logger.warning(f"No F&O data available for {date_str}")
        except Exception as e:
            logger.error(f"Error processing F&O data for {date_str}: {e}", exc_info=True)

def generate_date_range(start_date: datetime, end_date: datetime) -> List[datetime]:
    """Generates a list of datetimes between start_date and end_date inclusive."""
    dates = []
    curr = start_date
    while curr <= end_date:
        dates.append(curr)
        curr += timedelta(days=1)
    return dates

def parse_args():
    parser = argparse.ArgumentParser(
        description="NSE EOD Bhavcopy Downloader and PostgreSQL Storage Pipeline"
    )
    parser.add_argument(
        "--init-db",
        action="store_true",
        help="Initialize database schema and exit",
    )
    parser.add_argument(
        "--date",
        type=str,
        help="Target date in YYYY-MM-DD or DD-MM-YYYY format",
    )
    parser.add_argument(
        "--from",
        dest="from_date",
        type=str,
        help="Start date for backfill in YYYY-MM-DD or DD-MM-YYYY format",
    )
    parser.add_argument(
        "--to",
        dest="to_date",
        type=str,
        help="End date for backfill in YYYY-MM-DD or DD-MM-YYYY format (defaults to today if omitted)",
    )
    parser.add_argument(
        "--today",
        action="store_true",
        help="Download today's EOD data",
    )
    parser.add_argument(
        "--segment",
        type=str,
        choices=["cm", "indices", "fo", "all"],
        default="all",
        help="Segment to download (cm = Equities/Cash Market, indices = Indices, fo = Derivatives, all = All). Default: all",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-download and overwrite existing database records even if date already exists",
    )
    return parser.parse_args()

def parse_date_arg(date_str: str) -> datetime:
    """Parses date string from CLI argument."""
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(date_str, fmt)
        except ValueError:
            continue
    raise ValueError(f"Unable to parse date: {date_str}. Expected formats: YYYY-MM-DD or DD-MM-YYYY")

def main():
    args = parse_args()
    db = Database()

    # Schema Initialization
    if args.init_db:
        db.init_schema()
        print("Database schema initialized successfully.")
        return

    # Auto initialize schema on execution
    try:
        db.init_schema()
    except Exception as e:
        logger.error(f"Could not connect or initialize PostgreSQL schema: {e}")
        logger.info("Please verify your PostgreSQL connection settings in .env or provide DATABASE_URL.")
        sys.exit(1)

    downloader = NSEDownloader()
    segments = [args.segment] if args.segment != "all" else ["cm", "indices", "fo"]
    force = args.force

    if args.today:
        process_date(datetime.now(), segments, db, downloader, force=force)
    elif args.date:
        target_date = parse_date_arg(args.date)
        process_date(target_date, segments, db, downloader, force=force)
    elif args.from_date:
        start_date = parse_date_arg(args.from_date)
        end_date = parse_date_arg(args.to_date) if args.to_date else datetime.now()
        if start_date > end_date:
            logger.error(f"--from date ({start_date}) cannot be after --to date ({end_date})")
            sys.exit(1)

        dates = generate_date_range(start_date, end_date)
        logger.info(f"Starting batch backfill for {len(dates)} days (from {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')})...")
        for d in dates:
            process_date(d, segments, db, downloader, force=force)
    else:
        logger.info("No date specified. Defaulting to today's date.")
        process_date(datetime.now(), segments, db, downloader, force=force)

if __name__ == "__main__":
    main()
