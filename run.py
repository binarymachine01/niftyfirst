#!/usr/bin/env python
"""
Main Entrypoint & Command Dispatcher for all scripts and data pipelines.

Usage:
    python run.py --list                        # List all available scripts
    python run.py nse_eod --today               # Run NSE EOD Bhavcopy pipeline
    python run.py insider_data_extractor        # Run Insider Trading & Deals extractor
    python run.py all                           # Run all registered scripts in sequence
"""

import sys
from pathlib import Path

# Ensure root is in sys.path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from scripts.common.runner import (
    SCRIPT_REGISTRY,
    list_available_scripts,
    execute_script,
    run_all_scripts,
)

def main():
    args = sys.argv[1:]

    if not args or args[0] in ("-h", "--help", "help"):
        print("Usage:")
        print("  python run.py <script_name> [options...]")
        print("  python run.py list")
        print("  python run.py all")
        print("\nRun 'python run.py list' to see all registered scripts.")
        sys.exit(0)

    command = args[0].lower()

    if command in ("list", "--list", "-l"):
        list_available_scripts()
        sys.exit(0)

    if command in ("all", "--all"):
        exit_code = run_all_scripts()
        sys.exit(exit_code)

    if command == "run" and len(args) > 1:
        script_name = args[1]
        extra_args = args[2:]
        exit_code = execute_script(script_name, extra_args)
        sys.exit(exit_code)

    # Direct script invocation: python run.py <script_name> [extra_args...]
    script_name = command
    extra_args = args[1:]
    exit_code = execute_script(script_name, extra_args)
    sys.exit(exit_code)

if __name__ == "__main__":
    main()
