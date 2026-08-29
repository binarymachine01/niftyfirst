"""
Centralized Script Registry & Execution Engine.
Allows listing, running, and scheduling any registered data pipeline or extractor script.
"""

import sys
import subprocess
import argparse
from typing import Dict, List, Optional
from pathlib import Path
from . import BASE_DIR, setup_logger

logger = setup_logger("ScriptRunner")

# Registry of all scripts in the system
# Each entry defines the module path, entry point script, description, and default schedule
SCRIPT_REGISTRY = {
    "nse_eod": {
        "name": "NSE EOD Market Data Ingestion",
        "script_path": BASE_DIR / "scripts" / "nse_eod" / "main.py",
        "description": "Downloads and upserts daily NSE EOD Bhavcopy (Cash Market, Indices, F&O) into PostgreSQL",
        "default_args": ["--today"],
        "schedule_cron": "30 20 * * 1-5",  # Weekdays at 20:30 IST
    },
    "nse_deals": {
        "name": "Official NSE Insider & Deals Ingestion Pipeline",
        "script_path": BASE_DIR / "scripts" / "nse_deals" / "extractor.py",
        "description": "Extracts Insider Trading (PIT), Bulk Deals, Block Deals, and Short Selling / SAST from official NSE India APIs into PostgreSQL and Excel",
        "default_args": ["--today"],
        "schedule_cron": "00 21 * * 1-5",  # Weekdays at 21:00 IST
    },
    "web": {
        "name": "NiftyFirst Fullstack Web App (FastAPI + React)",
        "script_path": BASE_DIR / "backend" / "main.py",
        "description": "Launches the fullstack web application for quantitative insider backtesting and deals analytics",
        "default_args": [],
        "schedule_cron": "On Demand",
    },
}

# Optional convenience aliases mapping to canonical registry keys
ALIASES = {
    "nse": "nse_eod",
    "bhavcopy": "nse_eod",
    "nse_bhavcopy": "nse_eod",
    "insider": "nse_deals",
    "insider_data": "nse_deals",
    "insider_data_extractor": "nse_deals",
    "stockedge": "nse_deals",
    "deals": "nse_deals",
    "deals_extractor": "nse_deals",
    "pit": "nse_deals",
    "bulk": "nse_deals",
    "block": "nse_deals",
    "app": "web",
    "webapp": "web",
    "server": "web",
    "backend": "web",
}

def get_python_executable() -> str:
    """Returns path to virtualenv python if available, else current sys.executable."""
    venv_python_win = BASE_DIR / ".venv" / "Scripts" / "python.exe"
    venv_python_posix = BASE_DIR / ".venv" / "bin" / "python"

    if venv_python_win.exists():
        return str(venv_python_win)
    elif venv_python_posix.exists():
        return str(venv_python_posix)
    return sys.executable

def list_available_scripts():
    """Prints a formatted summary of all available scripts."""
    print("=" * 80)
    print(" [*] REGISTERED SCRIPTS & DATA PIPELINES")
    print("=" * 80)
    for key, info in SCRIPT_REGISTRY.items():
        print(f"\n[-] Key: {key}")
        print(f"    Name:        {info['name']}")
        print(f"    Description: {info['description']}")
        print(f"    Script File: {info['script_path'].relative_to(BASE_DIR)}")
        print(f"    Schedule:    {info['schedule_cron']}")
        if info['default_args']:
            print(f"    Default Args: {' '.join(info['default_args'])}")
    print("\n" + "=" * 80)
    print("Usage examples:")
    print("  python run.py nse_eod --today")
    print("  python run.py insider_data_extractor")
    print("  python run.py all")
    print("=" * 80 + "\n")

def resolve_script_key(key: str) -> Optional[str]:
    """Resolves a given script name or alias to canonical registry key."""
    key_lower = key.lower()
    if key_lower in SCRIPT_REGISTRY:
        return key_lower
    if key_lower in ALIASES:
        return ALIASES[key_lower]
    return None

def execute_script(script_key: str, extra_args: Optional[List[str]] = None) -> int:
    """Executes a registered script via subprocess using the proper Python environment."""
    canonical_key = resolve_script_key(script_key)
    if not canonical_key:
        logger.error(f"Script '{script_key}' not found in registry. Use 'python run.py list' to view available scripts.")
        return 1

    script_info = SCRIPT_REGISTRY[canonical_key]
    script_path = script_info["script_path"]

    if not script_path.exists():
        logger.error(f"Script file does not exist at: {script_path}")
        return 1

    python_bin = get_python_executable()
    args = [python_bin, str(script_path)]
    if extra_args:
        args.extend(extra_args)

    logger.info(f"Executing '{script_info['name']}'...")
    logger.info(f"Command: {' '.join(args)}")
    logger.info("-" * 60)

    try:
        process = subprocess.run(args, cwd=str(BASE_DIR))
        if process.returncode == 0:
            logger.info(f"[SUCCESS] Script '{canonical_key}' completed successfully.")
        else:
            logger.error(f"[FAILED] Script '{canonical_key}' exited with error code {process.returncode}.")
        return process.returncode
    except Exception as e:
        logger.error(f"Failed to execute '{canonical_key}': {e}", exc_info=True)
        return 1

def run_all_scripts() -> int:
    """Runs all registered scripts sequentially."""
    logger.info("Starting sequential execution of ALL registered scripts...")
    failed = []
    for key, info in SCRIPT_REGISTRY.items():
        logger.info(f"\n>>> Running pipeline: {key} ({info['name']})")
        ret = execute_script(key, info["default_args"])
        if ret != 0:
            failed.append(key)

    if failed:
        logger.error(f"Batch run finished with {len(failed)} failure(s): {', '.join(failed)}")
        return 1
    else:
        logger.info("[SUCCESS] All scripts completed successfully!")
        return 0
