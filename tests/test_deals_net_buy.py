"""
Tests for Deals Explorer Net Buy Only, Date Range Filtering, and Sorting.

Covers all 25 test cases specified in the feature specification:
1. Existing Deals Explorer without new filters
2. Net Buy ON
3. Net Buy OFF
4. BUY + Net Buy
5. SELL + Net Buy
6. Bulk Deals + Net Buy
7. Block Deals + Net Buy
8. Insider Deals + Net Buy
9. SAST Deals + Net Buy
10. NSE Exchange + Net Buy
11. Today
12. Last 7 Days
13. Last 30 Days
14. Last 90 Days
15. Custom date range
16. Deal Value ascending
17. Deal Value descending
18. Date ascending
19. Date descending
20. Search + date
21. Search + Net Buy
22. Date + Net Buy + sorting
23. Pagination with filters
24. Clear filters
25. Refresh / Summary consistency
"""

import sys
from pathlib import Path
from datetime import date, timedelta
from decimal import Decimal
import pytest

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.routers.deals import get_deals, get_deals_summary


def test_01_existing_deals_without_new_filters():
    res = get_deals(page=1, page_size=20)
    assert "deals" in res
    assert "total_count" in res
    assert "total_pages" in res
    assert res["total_count"] > 0
    assert len(res["deals"]) <= 20
    for d in res["deals"]:
        assert "id" in d
        assert "trade_date" in d
        assert "security_name" in d
        assert "action" in d
        assert "total_value" in d


def test_02_net_buy_on():
    res = get_deals(net_buy_only=True, page=1, page_size=50)
    assert res["total_count"] > 0
    for d in res["deals"]:
        assert d["net_buy_value"] is not None
        assert float(d["net_buy_value"]) > 0


def test_03_net_buy_off():
    res_on = get_deals(net_buy_only=True, page=1, page_size=10)
    res_off = get_deals(net_buy_only=False, page=1, page_size=10)
    assert res_off["total_count"] >= res_on["total_count"]
    # In Net Buy OFF, net_buy_value is None
    for d in res_off["deals"]:
        assert d.get("net_buy_value") is None


def test_04_buy_action_with_net_buy():
    res = get_deals(action="BUY", net_buy_only=True, page=1, page_size=20)
    for d in res["deals"]:
        assert d["action"] == "BUY"
        assert float(d["net_buy_value"]) > 0


def test_05_sell_action_with_net_buy():
    res = get_deals(action="SELL", net_buy_only=True, page=1, page_size=20)
    for d in res["deals"]:
        assert d["action"] == "SELL"
        # Even though individual transaction is SELL, the security's overall net buy is positive
        assert float(d["net_buy_value"]) > 0


def test_06_bulk_deals_with_net_buy():
    res = get_deals(category="Bulk Deals", net_buy_only=True, page=1, page_size=20)
    for d in res["deals"]:
        assert d["deal_category"] == "Bulk Deals"
        assert float(d["net_buy_value"]) > 0


def test_07_block_deals_with_net_buy():
    res = get_deals(category="Block Deals", net_buy_only=True, page=1, page_size=20)
    for d in res["deals"]:
        assert d["deal_category"] == "Block Deals"
        assert float(d["net_buy_value"]) > 0


def test_08_insider_deals_with_net_buy():
    res = get_deals(category="Insider Trading", net_buy_only=True, page=1, page_size=20)
    for d in res["deals"]:
        assert d["deal_category"] == "Insider Trading"
        assert float(d["net_buy_value"]) > 0


def test_09_sast_deals_with_net_buy():
    res = get_deals(category="SAST Deals", net_buy_only=True, page=1, page_size=20)
    for d in res["deals"]:
        assert d["deal_category"] == "SAST Deals"
        assert float(d["net_buy_value"]) > 0


def test_10_exchange_nse_with_net_buy():
    res = get_deals(exchange="NSE", net_buy_only=True, page=1, page_size=20)
    for d in res["deals"]:
        assert d["exchange_name"].upper() == "NSE"
        assert float(d["net_buy_value"]) > 0


def test_11_today_filter():
    today_str = date.today().strftime("%Y-%m-%d")
    res = get_deals(start_date=today_str, end_date=today_str, page=1, page_size=20)
    for d in res["deals"]:
        assert d["trade_date"] == today_str


def test_12_last_7_days_filter():
    start = (date.today() - timedelta(days=7)).strftime("%Y-%m-%d")
    end = date.today().strftime("%Y-%m-%d")
    res = get_deals(start_date=start, end_date=end, page=1, page_size=20)
    for d in res["deals"]:
        assert d["trade_date"] >= start
        assert d["trade_date"] <= end


def test_13_last_30_days_filter():
    start = (date.today() - timedelta(days=30)).strftime("%Y-%m-%d")
    end = date.today().strftime("%Y-%m-%d")
    res = get_deals(start_date=start, end_date=end, page=1, page_size=20)
    for d in res["deals"]:
        assert d["trade_date"] >= start
        assert d["trade_date"] <= end


def test_14_last_90_days_filter():
    start = (date.today() - timedelta(days=90)).strftime("%Y-%m-%d")
    end = date.today().strftime("%Y-%m-%d")
    res = get_deals(start_date=start, end_date=end, page=1, page_size=20)
    for d in res["deals"]:
        assert d["trade_date"] >= start
        assert d["trade_date"] <= end


def test_15_custom_date_range():
    start = "2026-08-01"
    end = "2026-08-31"
    res = get_deals(start_date=start, end_date=end, page=1, page_size=50)
    for d in res["deals"]:
        assert d["trade_date"] >= start
        assert d["trade_date"] <= end


def test_16_deal_value_ascending():
    res = get_deals(sort_by="value", sort_order="asc", page=1, page_size=20)
    values = [float(d["total_value"]) for d in res["deals"] if d.get("total_value") is not None]
    assert len(values) > 1
    for i in range(len(values) - 1):
        assert values[i] <= values[i + 1]


def test_17_deal_value_descending():
    res = get_deals(sort_by="value", sort_order="desc", page=1, page_size=20)
    values = [float(d["total_value"]) for d in res["deals"] if d.get("total_value") is not None]
    assert len(values) > 1
    for i in range(len(values) - 1):
        assert values[i] >= values[i + 1]


def test_18_date_ascending():
    res = get_deals(sort_by="date", sort_order="asc", page=1, page_size=20)
    dates = [d["trade_date"] for d in res["deals"] if d.get("trade_date")]
    assert len(dates) > 1
    for i in range(len(dates) - 1):
        assert dates[i] <= dates[i + 1]


def test_19_date_descending():
    res = get_deals(sort_by="date", sort_order="desc", page=1, page_size=20)
    dates = [d["trade_date"] for d in res["deals"] if d.get("trade_date")]
    assert len(dates) > 1
    for i in range(len(dates) - 1):
        assert dates[i] >= dates[i + 1]


def test_20_search_and_date():
    res = get_deals(search="Adani", start_date="2026-01-01", end_date="2026-08-31", page=1, page_size=20)
    for d in res["deals"]:
        assert "ADANI" in (d.get("security_name") or "").upper() or "ADANI" in (d.get("client_name") or "").upper() or "ADANI" in (d.get("symbol") or "").upper()
        assert d["trade_date"] >= "2026-01-01"
        assert d["trade_date"] <= "2026-08-31"


def test_21_search_and_net_buy():
    res = get_deals(search="LTD", net_buy_only=True, page=1, page_size=20)
    for d in res["deals"]:
        assert float(d["net_buy_value"]) > 0


def test_22_date_net_buy_and_sorting():
    res = get_deals(
        start_date="2026-08-01",
        end_date="2026-08-31",
        net_buy_only=True,
        sort_by="value",
        sort_order="desc",
        page=1,
        page_size=20,
    )
    values = [float(d["total_value"]) for d in res["deals"] if d.get("total_value") is not None]
    for i in range(len(values) - 1):
        assert values[i] >= values[i + 1]
    for d in res["deals"]:
        assert d["trade_date"] >= "2026-08-01"
        assert d["trade_date"] <= "2026-08-31"
        assert float(d["net_buy_value"]) > 0


def test_23_pagination_with_filters():
    res_p1 = get_deals(net_buy_only=True, page=1, page_size=10)
    res_p2 = get_deals(net_buy_only=True, page=2, page_size=10)
    assert res_p1["page"] == 1
    assert res_p2["page"] == 2
    assert res_p1["total_count"] == res_p2["total_count"]
    p1_ids = {f"{d['deal_category']}-{d['id']}" for d in res_p1["deals"]}
    p2_ids = {f"{d['deal_category']}-{d['id']}" for d in res_p2["deals"]}
    assert p1_ids.isdisjoint(p2_ids)


def test_24_clear_filters_restore_defaults():
    res_filtered = get_deals(category="Block Deals", action="BUY", net_buy_only=True)
    res_default = get_deals()
    assert res_default["total_count"] >= res_filtered["total_count"]


def test_25_summary_consistency_with_filters():
    summary_all = get_deals_summary()
    assert len(summary_all["by_category"]) == 4
    total_all = sum(c["count"] for c in summary_all["by_category"])

    summary_net_buy = get_deals_summary(net_buy_only=True)
    total_net_buy = sum(c["count"] for c in summary_net_buy["by_category"])
    assert total_all >= total_net_buy

    summary_date = get_deals_summary(start_date="2026-08-01", end_date="2026-08-31")
    total_date = sum(c["count"] for c in summary_date["by_category"])
    assert total_all >= total_date
