"""
Tests for the System Health multi-exchange pipeline selector's request
normalization (backend/routers/system.py:_normalize_exchange_list).

Run with: pytest tests/test_multi_exchange_pipeline.py -v
"""

import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.routers.system import _normalize_exchange_list


def test_normalizes_case():
    assert _normalize_exchange_list(["nse"]) == ["NSE"]


def test_strips_whitespace():
    assert _normalize_exchange_list([" NSE "]) == ["NSE"]


def test_deduplicates_preserving_order():
    assert _normalize_exchange_list(["NSE", "nse", "BSE", "NSE"]) == ["NSE", "BSE"]


def test_empty_list_stays_empty():
    """An explicitly empty selection must normalize to empty, not silently default to anything."""
    assert _normalize_exchange_list([]) == []


def test_ignores_blank_entries():
    assert _normalize_exchange_list(["NSE", "", "  ", None]) == ["NSE"]
