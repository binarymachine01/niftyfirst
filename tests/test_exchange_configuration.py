"""
Tests for the centralized exchange configuration
(scripts/common/__init__.py:ENABLED_EXCHANGES / is_exchange_enabled).

Run with: pytest tests/test_exchange_configuration.py -v
"""

import sys
import importlib
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))


def reload_common_with_env(monkeypatch, value):
    """Reloads scripts.common with a given ENABLED_EXCHANGES env value, so
    the module-level ENABLED_EXCHANGES list reflects it for the test."""
    if value is None:
        monkeypatch.delenv("ENABLED_EXCHANGES", raising=False)
    else:
        monkeypatch.setenv("ENABLED_EXCHANGES", value)
    import scripts.common as common
    importlib.reload(common)
    return common


def test_default_is_nse_only(monkeypatch):
    common = reload_common_with_env(monkeypatch, None)
    assert common.ENABLED_EXCHANGES == ["NSE"]


def test_explicit_nse_only(monkeypatch):
    common = reload_common_with_env(monkeypatch, "NSE")
    assert common.ENABLED_EXCHANGES == ["NSE"]


def test_multiple_exchanges_parsed(monkeypatch):
    common = reload_common_with_env(monkeypatch, "NSE,BSE")
    assert common.ENABLED_EXCHANGES == ["NSE", "BSE"]


def test_whitespace_and_case_are_normalized(monkeypatch):
    common = reload_common_with_env(monkeypatch, " nse , bse ")
    assert common.ENABLED_EXCHANGES == ["NSE", "BSE"]


def test_is_exchange_enabled_matches_configured_list(monkeypatch):
    common = reload_common_with_env(monkeypatch, "NSE")
    assert common.is_exchange_enabled("NSE") is True
    assert common.is_exchange_enabled("nse") is True  # case-insensitive
    assert common.is_exchange_enabled("BSE") is False
    assert common.is_exchange_enabled(None) is False
    assert common.is_exchange_enabled("") is False


def test_bse_not_enabled_by_default(monkeypatch):
    """The CURRENT requirement: BSE must never be enabled unless explicitly configured."""
    common = reload_common_with_env(monkeypatch, None)
    assert "BSE" not in common.ENABLED_EXCHANGES
    assert common.is_exchange_enabled("BSE") is False


def test_bse_has_no_verified_api_code_yet():
    """
    Guards against ever silently guessing a StockEdge API code for BSE -
    this must be added deliberately (and verified) before BSE can be used,
    even if someone enables it via ENABLED_EXCHANGES prematurely.
    """
    import scripts.common as common
    assert "BSE" not in common.EXCHANGE_API_CODES
    assert common.EXCHANGE_API_CODES.get("NSE") == 1


def test_enabling_bse_without_a_code_causes_skip_not_crash(monkeypatch):
    """
    fetch_api_data() must skip (with a warning) rather than crash or guess
    when an enabled exchange has no EXCHANGE_API_CODES entry.
    """
    common = reload_common_with_env(monkeypatch, "NSE,BSE")
    assert "BSE" in common.ENABLED_EXCHANGES
    assert common.EXCHANGE_API_CODES.get("BSE") is None


def reload_common_with_default_exchanges_env(monkeypatch, value):
    """Like reload_common_with_env, but for DEFAULT_EXCHANGES specifically."""
    if value is None:
        monkeypatch.delenv("DEFAULT_EXCHANGES", raising=False)
        monkeypatch.delenv("DEFAULT_EXCHANGE", raising=False)
    else:
        monkeypatch.setenv("DEFAULT_EXCHANGES", value)
    import scripts.common as common
    importlib.reload(common)
    return common


def test_supported_exchanges_derived_from_api_codes():
    """SUPPORTED_EXCHANGES must never be a separately maintained list - it is exactly EXCHANGE_API_CODES.keys()."""
    import scripts.common as common
    assert common.SUPPORTED_EXCHANGES == list(common.EXCHANGE_API_CODES.keys())
    assert common.SUPPORTED_EXCHANGES == ["NSE"]


def test_is_exchange_supported(monkeypatch):
    common = reload_common_with_env(monkeypatch, "NSE,BSE")
    assert common.is_exchange_supported("NSE") is True
    assert common.is_exchange_supported("nse") is True  # case-insensitive
    # BSE may be ENABLED (misconfigured ahead of integration) without being SUPPORTED yet.
    assert common.is_exchange_supported("BSE") is False
    assert common.is_exchange_supported(None) is False


def test_default_exchanges_defaults_to_nse_only(monkeypatch):
    common = reload_common_with_default_exchanges_env(monkeypatch, None)
    assert common.DEFAULT_EXCHANGES == ["NSE"]
    assert common.DEFAULT_EXCHANGE == "NSE"


def test_default_exchanges_explicit_multi(monkeypatch):
    monkeypatch.setenv("ENABLED_EXCHANGES", "NSE,BSE")
    common = reload_common_with_default_exchanges_env(monkeypatch, "NSE,BSE")
    assert common.DEFAULT_EXCHANGES == ["NSE", "BSE"]
    assert common.DEFAULT_EXCHANGE == "NSE"


def test_default_exchanges_stays_conservative_when_only_enabled_grows(monkeypatch):
    """
    Enabling BSE alone must NOT silently widen the default selection to
    both exchanges - DEFAULT_EXCHANGES only follows ENABLED_EXCHANGES when
    neither DEFAULT_EXCHANGES nor the legacy DEFAULT_EXCHANGE is set, and
    even then only takes the first enabled exchange.
    """
    monkeypatch.setenv("ENABLED_EXCHANGES", "NSE,BSE")
    common = reload_common_with_default_exchanges_env(monkeypatch, None)
    assert common.DEFAULT_EXCHANGES == ["NSE"]


def test_legacy_default_exchange_env_still_respected(monkeypatch):
    """DEFAULT_EXCHANGE (singular) must still work for backward compatibility."""
    monkeypatch.delenv("DEFAULT_EXCHANGES", raising=False)
    monkeypatch.setenv("DEFAULT_EXCHANGE", "NSE")
    import scripts.common as common
    importlib.reload(common)
    assert common.DEFAULT_EXCHANGES == ["NSE"]
    assert common.DEFAULT_EXCHANGE == "NSE"
