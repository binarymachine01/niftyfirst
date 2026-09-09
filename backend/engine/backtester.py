"""
Quantitative Backtesting Engine for Insider Trading and Market Deals.
Simulates trading strategies against historical daily price candles in nse_equity_eod.
"""

import math
import time
import uuid
import logging
import statistics
from typing import List, Dict, Any, Optional
from datetime import datetime, date
from collections import defaultdict

try:
    from backend.database import fetch_all, fetch_one
    from backend.engine.symbol_matcher import matcher, MatchStatus
    from backend.engine import backtest_persistence
except ImportError:
    from ..database import fetch_all, fetch_one
    from .symbol_matcher import matcher, MatchStatus
    from . import backtest_persistence

from scripts.common import ENABLED_EXCHANGES

logger = logging.getLogger(__name__)


def safe_float(val: Any, default: float = 0.0) -> float:
    """Converts value to float safely."""
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


class BacktestEngine:
    """Simulates trading strategies based on Insider Trading & Large Deal signals."""

    def __init__(self):
        matcher.initialize()

    def load_deals(
        self,
        categories: List[str],
        action: str = "BUY",
        min_value_lakhs: float = 0.0,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Queries filtered deals from database view with symbol metadata."""
        query = """
        SELECT
            v.deal_category,
            v.id,
            v.symbol,
            v.trade_date,
            v.exchange_name,
            v.security_name,
            v.client_name,
            v.action,
            v.quantity,
            v.price,
            v.total_value,
            v.mode_description,
            COALESCE(i.security_slug, s.security_slug, blk.security_slug, blk2.security_slug, '') as security_slug
        FROM stockedge_all_deals_view v
        LEFT JOIN stockedge_insider_deals i ON v.id = i.id AND v.deal_category = 'Insider Trading'
        LEFT JOIN stockedge_sast_deals s ON v.id = s.id AND v.deal_category = 'SAST Deals'
        LEFT JOIN stockedge_block_deals blk ON v.id = blk.id AND v.deal_category = 'Block Deals'
        LEFT JOIN stockedge_bulk_deals blk2 ON v.id = blk2.id AND v.deal_category = 'Bulk Deals'
        WHERE UPPER(v.exchange_name) = ANY(%s)
        """
        # Exchange filtering happens BEFORE candidate generation: a deal
        # whose own exchange isn't enabled is excluded from this result set
        # entirely, so it never even reaches matcher.resolve_symbol_detailed()
        # in run_backtest() below - never filtered out afterward by its
        # resolved symbol.
        params = [ENABLED_EXCHANGES]

        if categories:
            query += " AND v.deal_category = ANY(%s)"
            params.append(categories)

        if action and action.upper() != "ALL":
            query += " AND v.action = %s"
            params.append(action.upper())

        if min_value_lakhs > 0:
            query += " AND (v.total_value >= %s OR v.total_value IS NULL)"
            params.append(min_value_lakhs * 100000)

        if start_date:
            query += " AND v.trade_date >= %s"
            params.append(start_date)

        if end_date:
            query += " AND v.trade_date <= %s"
            params.append(end_date)

        query += " ORDER BY v.trade_date ASC, v.id ASC;"

        return fetch_all(query, tuple(params))

    def load_price_history(self, symbols: List[str]) -> Dict[str, List[Dict[str, Any]]]:
        """Loads and indexes chronological price candles for target symbols."""
        if not symbols:
            return {}

        query = """
        SELECT
            symbol,
            trade_date,
            open,
            high,
            low,
            close,
            volume
        FROM nse_equity_eod
        WHERE symbol = ANY(%s)
        ORDER BY symbol, trade_date ASC;
        """
        rows = fetch_all(query, (symbols,))

        price_dict = defaultdict(list)
        for r in rows:
            price_dict[r["symbol"]].append({
                "trade_date": r["trade_date"],
                "open": safe_float(r["open"]),
                "high": safe_float(r["high"]),
                "low": safe_float(r["low"]),
                "close": safe_float(r["close"]),
                "volume": int(r["volume"] or 0),
            })
        return price_dict

    def run_backtest(
        self,
        holding_days: int = 20,
        categories: Optional[List[str]] = None,
        action: str = "BUY",
        min_value_lakhs: float = 0.0,
        stop_loss_pct: Optional[float] = None,
        take_profit_pct: Optional[float] = None,
        initial_capital: float = 1000000.0,
        position_size_pct: float = 10.0,
        max_positions: int = 10,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Executes full strategy simulation and calculates comprehensive analytics.
        """
        if categories is None:
            categories = ["Insider Trading", "SAST Deals", "Block Deals", "Bulk Deals"]

        # 1. Fetch Deals
        deals = self.load_deals(
            categories=categories,
            action=action,
            min_value_lakhs=min_value_lakhs,
            start_date=start_date,
            end_date=end_date
        )

        if not deals:
            return self._empty_results(initial_capital)

        # 2. Resolve Symbols
        # CRITICAL: only MATCHED and MANUAL_OVERRIDE mappings are eligible
        # for backtesting. LOW_CONFIDENCE and UNMATCHED deals are excluded
        # here explicitly (not merely because matcher.resolve_symbol()
        # already returns None for them) so the exclusion is visible and
        # auditable rather than silent - see symbol_mapping_audit below.
        deal_symbols = {}
        unique_symbols = set()
        status_counts = {MatchStatus.MATCHED: 0, MatchStatus.MANUAL_OVERRIDE: 0, MatchStatus.LOW_CONFIDENCE: 0, MatchStatus.UNMATCHED: 0}
        for d in deals:
            sym = d.get("symbol")
            if sym and str(sym).strip():
                sym = str(sym).upper().strip()
                status_counts[MatchStatus.MATCHED] = status_counts.get(MatchStatus.MATCHED, 0) + 1
                deal_symbols[d["id"]] = sym
                unique_symbols.add(sym)
            else:
                match = matcher.resolve_symbol_detailed(d["security_name"], d.get("security_slug"))
                status = match["match_status"]
                status_counts[status] = status_counts.get(status, 0) + 1
                if status in (MatchStatus.MATCHED, MatchStatus.MANUAL_OVERRIDE):
                    deal_symbols[d["id"]] = match["resolved_nse_symbol"]
                    unique_symbols.add(match["resolved_nse_symbol"])

        symbol_mapping_audit = {
            "total_transactions": len(deals),
            "matched": status_counts.get(MatchStatus.MATCHED, 0),
            "manual_override": status_counts.get(MatchStatus.MANUAL_OVERRIDE, 0),
            "excluded_low_confidence": status_counts.get(MatchStatus.LOW_CONFIDENCE, 0),
            "excluded_unmatched": status_counts.get(MatchStatus.UNMATCHED, 0),
        }

        if not unique_symbols:
            return self._empty_results(initial_capital, symbol_mapping_audit)

        # 3. Load Price History for matched symbols
        price_history = self.load_price_history(list(unique_symbols))

        # 4. Simulate Trades
        trades = []
        for deal in deals:
            deal_id = deal["id"]
            symbol = deal_symbols.get(deal_id)
            if not symbol or symbol not in price_history:
                continue

            candles = price_history[symbol]
            deal_date = deal["trade_date"]
            if isinstance(deal_date, str):
                deal_date = datetime.strptime(deal_date, "%Y-%m-%d").date()

            # Find candles on or after deal date
            future_candles = [c for c in candles if c["trade_date"] >= deal_date]
            if not future_candles:
                continue

            # Enter on the first trading day after deal date (or deal date if traded that day)
            entry_candle = future_candles[0]
            entry_price = entry_candle["open"] if entry_candle["open"] > 0 else entry_candle["close"]
            entry_date = entry_candle["trade_date"]

            if entry_price <= 0:
                continue

            trade_action = deal["action"]
            is_long = trade_action == "BUY"

            exit_price = entry_price
            exit_date = entry_date
            exit_reason = "Holding Period"
            holding_counter = 0

            # Scan subsequent trading days for SL, TP, or Holding period exit
            candles_after_entry = future_candles[1:]
            for idx, c in enumerate(candles_after_entry):
                holding_counter = idx + 1
                curr_high = c["high"]
                curr_low = c["low"]
                curr_close = c["close"]

                # Stop Loss check
                if stop_loss_pct is not None and stop_loss_pct > 0:
                    sl_barrier = entry_price * (1.0 - stop_loss_pct / 100.0) if is_long else entry_price * (1.0 + stop_loss_pct / 100.0)
                    if (is_long and curr_low <= sl_barrier) or (not is_long and curr_high >= sl_barrier):
                        exit_price = sl_barrier
                        exit_date = c["trade_date"]
                        exit_reason = "Stop Loss"
                        break

                # Take Profit check
                if take_profit_pct is not None and take_profit_pct > 0:
                    tp_barrier = entry_price * (1.0 + take_profit_pct / 100.0) if is_long else entry_price * (1.0 - take_profit_pct / 100.0)
                    if (is_long and curr_high >= tp_barrier) or (not is_long and curr_low <= tp_barrier):
                        exit_price = tp_barrier
                        exit_date = c["trade_date"]
                        exit_reason = "Take Profit"
                        break

                # Holding Period expiry
                if holding_counter >= holding_days:
                    exit_price = curr_close
                    exit_date = c["trade_date"]
                    exit_reason = "Holding Period"
                    break

                exit_price = curr_close
                exit_date = c["trade_date"]

            if not candles_after_entry:
                exit_reason = "Latest Available"

            # Calculate returns
            if is_long:
                pnl_pct = ((exit_price - entry_price) / entry_price) * 100.0
            else:
                pnl_pct = ((entry_price - exit_price) / entry_price) * 100.0

            trades.append({
                "deal_id": deal_id,
                "deal_category": deal["deal_category"],
                "security_name": deal["security_name"],
                "symbol": symbol,
                "client_name": deal["client_name"],
                "action": trade_action,
                "deal_date": deal_date.strftime("%Y-%m-%d") if isinstance(deal_date, (datetime, date)) else str(deal_date),
                "entry_date": entry_date.strftime("%Y-%m-%d") if isinstance(entry_date, (datetime, date)) else str(entry_date),
                "entry_price": round(entry_price, 2),
                "exit_date": exit_date.strftime("%Y-%m-%d") if isinstance(exit_date, (datetime, date)) else str(exit_date),
                "exit_price": round(exit_price, 2),
                "pnl_pct": round(pnl_pct, 2),
                "holding_days": holding_counter,
                "exit_reason": exit_reason,
                "total_deal_value": deal.get("total_value"),
            })

        if not trades:
            return self._empty_results(initial_capital, symbol_mapping_audit)

        # 5. Build Portfolio Equity Curve & Metrics
        results = self._compute_portfolio_metrics(trades, initial_capital, position_size_pct)
        results["symbol_mapping_audit"] = symbol_mapping_audit
        return results

    def _compute_portfolio_metrics(
        self,
        trades: List[Dict[str, Any]],
        initial_capital: float,
        position_size_pct: float
    ) -> Dict[str, Any]:
        """Calculates quantitative performance statistics and equity curve."""
        total_trades = len(trades)
        winning_trades = [t for t in trades if t["pnl_pct"] > 0]
        losing_trades = [t for t in trades if t["pnl_pct"] < 0]
        break_even = [t for t in trades if t["pnl_pct"] == 0]

        win_rate = (len(winning_trades) / total_trades * 100.0) if total_trades > 0 else 0.0

        pnl_values = [t["pnl_pct"] for t in trades]
        avg_pnl = sum(pnl_values) / len(pnl_values) if pnl_values else 0.0

        win_pnls = [t["pnl_pct"] for t in winning_trades]
        loss_pnls = [abs(t["pnl_pct"]) for t in losing_trades]

        avg_gain = (sum(win_pnls) / len(win_pnls)) if win_pnls else 0.0
        avg_loss = (sum(loss_pnls) / len(loss_pnls)) if loss_pnls else 0.0

        total_gain_sum = sum(win_pnls)
        total_loss_sum = sum(loss_pnls)
        profit_factor = (total_gain_sum / total_loss_sum) if total_loss_sum > 0 else (99.0 if total_gain_sum > 0 else 1.0)

        # Chronological Equity Curve simulation
        sorted_trades = sorted(trades, key=lambda x: x["entry_date"])
        equity = initial_capital
        equity_curve = [{"date": sorted_trades[0]["entry_date"], "equity": round(equity, 2), "drawdown_pct": 0.0}]

        peak_equity = equity
        max_drawdown_pct = 0.0

        for t in sorted_trades:
            # Simulated position dollar return
            pos_size = equity * (position_size_pct / 100.0)
            trade_profit = pos_size * (t["pnl_pct"] / 100.0)
            equity += trade_profit
            t["pnl_amount"] = round(trade_profit, 2)
            t["equity_after"] = round(equity, 2)

            if equity > peak_equity:
                peak_equity = equity
            dd = ((peak_equity - equity) / peak_equity * 100.0) if peak_equity > 0 else 0.0
            if dd > max_drawdown_pct:
                max_drawdown_pct = dd

            equity_curve.append({
                "date": t["exit_date"],
                "equity": round(equity, 2),
                "drawdown_pct": round(dd, 2)
            })

        total_return_pct = ((equity - initial_capital) / initial_capital * 100.0)

        # Annualized CAGR & Sharpe Ratio calculation
        try:
            d_start = datetime.strptime(sorted_trades[0]["entry_date"], "%Y-%m-%d")
            d_end = datetime.strptime(sorted_trades[-1]["exit_date"], "%Y-%m-%d")
            days_elapsed = max((d_end - d_start).days, 1)
            years = days_elapsed / 365.25
            cagr = ((equity / initial_capital) ** (1.0 / years) - 1.0) * 100.0 if (equity > 0 and years > 0.05) else total_return_pct
        except Exception:
            cagr = total_return_pct

        # Sharpe ratio calculation
        returns_series = [t["pnl_pct"] for t in trades]
        if len(returns_series) > 1:
            mean_r = sum(returns_series) / len(returns_series)
            var_r = sum((x - mean_r) ** 2 for x in returns_series) / (len(returns_series) - 1)
            std_r = math.sqrt(var_r) if var_r > 0 else 0.0001
            sharpe_ratio = (mean_r / std_r) * math.sqrt(252 / max(sorted_trades[0]["holding_days"], 1))
        else:
            sharpe_ratio = 1.0

        return {
            "summary": {
                "initial_capital": round(initial_capital, 2),
                "final_equity": round(equity, 2),
                "total_return_pct": round(total_return_pct, 2),
                "cagr_pct": round(cagr, 2),
                "total_trades": total_trades,
                "winning_trades": len(winning_trades),
                "losing_trades": len(losing_trades),
                "break_even_trades": len(break_even),
                "win_rate_pct": round(win_rate, 2),
                "profit_factor": round(profit_factor, 2),
                "avg_trade_pnl_pct": round(avg_pnl, 2),
                "avg_gain_pct": round(avg_gain, 2),
                "avg_loss_pct": round(avg_loss, 2),
                "max_drawdown_pct": round(max_drawdown_pct, 2),
                "sharpe_ratio": round(sharpe_ratio, 2),
            },
            "equity_curve": equity_curve,
            "trades": sorted_trades,
        }

    def _empty_results(self, initial_capital: float, symbol_mapping_audit: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Returns blank payload when no trades match criteria."""
        return {
            "summary": {
                "initial_capital": initial_capital,
                "final_equity": initial_capital,
                "total_return_pct": 0.0,
                "cagr_pct": 0.0,
                "total_trades": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "break_even_trades": 0,
                "win_rate_pct": 0.0,
                "profit_factor": 0.0,
                "avg_trade_pnl_pct": 0.0,
                "avg_gain_pct": 0.0,
                "avg_loss_pct": 0.0,
                "max_drawdown_pct": 0.0,
                "sharpe_ratio": 0.0,
            },
            "equity_curve": [],
            "trades": [],
            "symbol_mapping_audit": symbol_mapping_audit,
        }

    def get_data_availability(self) -> Dict[str, Any]:
        """Returns the min and max date ranges for EOD prices and deals in the database."""
        eod_row = fetch_one("SELECT MIN(trade_date) as min_date, MAX(trade_date) as max_date, COUNT(DISTINCT trade_date) as trading_days FROM nse_equity_eod;")
        deal_row = fetch_one("SELECT MIN(trade_date) as min_date, MAX(trade_date) as max_date, COUNT(*) as total_deals FROM stockedge_all_deals_view WHERE UPPER(exchange_name) = 'NSE';")

        min_eod = str(eod_row["min_date"]) if eod_row and eod_row.get("min_date") else None
        max_eod = str(eod_row["max_date"]) if eod_row and eod_row.get("max_date") else None
        min_deal = str(deal_row["min_date"]) if deal_row and deal_row.get("min_date") else None
        max_deal = str(deal_row["max_date"]) if deal_row and deal_row.get("max_date") else None

        return {
            "eod": {
                "min_date": min_eod,
                "max_date": max_eod,
                "trading_days": int(eod_row.get("trading_days") or 0) if eod_row else 0,
                "display": f"{datetime.strptime(min_eod, '%Y-%m-%d').strftime('%d-%b-%Y')} -> {datetime.strptime(max_eod, '%Y-%m-%d').strftime('%d-%b-%Y')}" if min_eod and max_eod else "No EOD Data Available"
            },
            "deals": {
                "min_date": min_deal,
                "max_date": max_deal,
                "total_deals": int(deal_row.get("total_deals") or 0) if deal_row else 0,
                "display": f"{datetime.strptime(min_deal, '%Y-%m-%d').strftime('%d-%b-%Y')} -> {datetime.strptime(max_deal, '%Y-%m-%d').strftime('%d-%b-%Y')}" if min_deal and max_deal else "No Deals Available"
            }
        }

    def run_date_range_backtest(
        self,
        from_date: str,
        to_date: str,
        deal_types: Optional[List[str]] = None,
        actions: Optional[List[str]] = None,
        exchange: str = "NSE",
        min_value_lakhs: float = 0.0,
    ) -> Dict[str, Any]:
        """
        Executes full historical deal signal backtest across a user-selected date range.
        Evaluates 1D, 5D, 10D, 20D, and 60D trading-day look-forward performance for all
        eligible deals, enforcing strict symbol governance safety.
        """
        start_time_ns = time.perf_counter_ns()
        run_id = f"btr_{uuid.uuid4().hex[:12]}"

        # 1. Validate Date Range
        try:
            d_from = datetime.strptime(from_date, "%Y-%m-%d").date()
            d_to = datetime.strptime(to_date, "%Y-%m-%d").date()
        except ValueError as e:
            raise ValueError(f"Invalid date format (must be YYYY-MM-DD): {e}")

        if d_from > d_to:
            raise ValueError(f"From Date ({from_date}) cannot be after To Date ({to_date}).")

        # Check EOD availability bounds
        availability = self.get_data_availability()
        eod_min_str = availability["eod"]["min_date"]
        eod_max_str = availability["eod"]["max_date"]

        if eod_min_str and to_date < eod_min_str:
            raise ValueError(f"Selected date range ({from_date} to {to_date}) precedes available EOD data starting {eod_min_str}.")

        categories = deal_types or ["Insider Trading", "SAST Deals", "Block Deals", "Bulk Deals"]

        # Normalize action filters
        allowed_actions = []
        if actions:
            for a in actions:
                a_up = a.strip().upper()
                if a_up in ("BUY", "SELL"):
                    allowed_actions.append(a_up)
                elif a_up in ("ALL", "BOTH"):
                    allowed_actions.extend(["BUY", "SELL"])
            allowed_actions = list(dict.fromkeys(allowed_actions))
        if not allowed_actions:
            allowed_actions = ["BUY", "SELL"]

        # 2. Query ALL deals in date range (no silent limits)
        query = """
        SELECT
            v.deal_category,
            v.id,
            v.trade_date,
            v.exchange_name,
            v.security_name,
            v.client_name,
            v.action,
            v.quantity,
            v.price,
            v.total_value,
            v.mode_description,
            COALESCE(i.security_slug, s.security_slug, blk.security_slug, blk2.security_slug, '') as security_slug
        FROM stockedge_all_deals_view v
        LEFT JOIN stockedge_insider_deals i ON v.id = i.id AND v.deal_category = 'Insider Trading'
        LEFT JOIN stockedge_sast_deals s ON v.id = s.id AND v.deal_category = 'SAST Deals'
        LEFT JOIN stockedge_block_deals blk ON v.id = blk.id AND v.deal_category = 'Block Deals'
        LEFT JOIN stockedge_bulk_deals blk2 ON v.id = blk2.id AND v.deal_category = 'Bulk Deals'
        WHERE v.trade_date >= %s AND v.trade_date <= %s
          AND v.deal_category = ANY(%s)
          AND UPPER(v.action) = ANY(%s)
          AND UPPER(v.exchange_name) = %s
        """
        params = [from_date, to_date, categories, allowed_actions, exchange.upper()]
        if min_value_lakhs > 0:
            query += " AND (v.total_value >= %s OR v.total_value IS NULL)"
            params.append(min_value_lakhs * 100000)

        query += " ORDER BY v.trade_date ASC, v.id ASC;"
        raw_deals = fetch_all(query, tuple(params))
        total_signals = len(raw_deals)

        # 3. Resolve and Validate Symbols using SymbolMatcher
        eligible_candidates = []
        excluded_records = []
        needed_symbols = set()

        for d in raw_deals:
            sec_name = d["security_name"]
            slug = d.get("security_slug")
            match = matcher.resolve_symbol_detailed(sec_name, slug)
            status = match["match_status"]
            resolved_sym = match.get("resolved_nse_symbol")

            if status in (MatchStatus.MATCHED, MatchStatus.MANUAL_OVERRIDE) and resolved_sym:
                needed_symbols.add(resolved_sym)
                eligible_candidates.append({
                    "deal": d,
                    "symbol": resolved_sym,
                    "match": match,
                })
            elif status == MatchStatus.LOW_CONFIDENCE:
                excluded_records.append({
                    "deal_id": d["id"],
                    "deal_date": str(d["trade_date"]),
                    "deal_type": d["deal_category"],
                    "action": d["action"].upper(),
                    "security_name": sec_name,
                    "client_name": d.get("client_name"),
                    "deal_value": safe_float(d.get("total_value")),
                    "reason": "LOW_CONFIDENCE_SYMBOL",
                    "match_status": status,
                    "candidate_symbol": resolved_sym,
                    "match_confidence": match.get("match_confidence", 0.0),
                })
            else:
                excluded_records.append({
                    "deal_id": d["id"],
                    "deal_date": str(d["trade_date"]),
                    "deal_type": d["deal_category"],
                    "action": d["action"].upper(),
                    "security_name": sec_name,
                    "client_name": d.get("client_name"),
                    "deal_value": safe_float(d.get("total_value")),
                    "reason": "UNMATCHED_SYMBOL",
                    "match_status": status,
                    "candidate_symbol": None,
                    "match_confidence": match.get("match_confidence", 0.0),
                })

        # 4. Batch Load EOD Price History
        price_history = self.load_price_history(list(needed_symbols))

        # 5. Calculate Look-Forward Performance (Trading Days)
        deal_results = []
        horizons = [1, 5, 10, 20, 60]

        for item in eligible_candidates:
            d = item["deal"]
            sym = item["symbol"]
            m = item["match"]

            candles = price_history.get(sym, [])
            deal_date = d["trade_date"]
            if isinstance(deal_date, str):
                deal_date = datetime.strptime(deal_date, "%Y-%m-%d").date()

            # Candles on or after deal date
            future_candles = [c for c in candles if c["trade_date"] >= deal_date]
            if not future_candles:
                excluded_records.append({
                    "deal_id": d["id"],
                    "deal_date": str(d["trade_date"]),
                    "deal_type": d["deal_category"],
                    "action": d["action"].upper(),
                    "security_name": d["security_name"],
                    "client_name": d.get("client_name"),
                    "deal_value": safe_float(d.get("total_value")),
                    "reason": "INSUFFICIENT_EOD_HISTORY",
                    "match_status": m["match_status"],
                    "candidate_symbol": sym,
                    "match_confidence": m.get("match_confidence", 1.0),
                })
                continue

            entry_candle = future_candles[0]
            entry_price = entry_candle["open"] if entry_candle["open"] > 0 else entry_candle["close"]
            if entry_price <= 0:
                excluded_records.append({
                    "deal_id": d["id"],
                    "deal_date": str(d["trade_date"]),
                    "deal_type": d["deal_category"],
                    "action": d["action"].upper(),
                    "security_name": d["security_name"],
                    "client_name": d.get("client_name"),
                    "deal_value": safe_float(d.get("total_value")),
                    "reason": "MISSING_ENTRY_PRICE",
                    "match_status": m["match_status"],
                    "candidate_symbol": sym,
                    "match_confidence": m.get("match_confidence", 1.0),
                })
                continue

            subsequent_candles = future_candles[1:]
            is_buy = d["action"].upper() == "BUY"

            returns = {}
            for h in horizons:
                raw_key = f"raw_return_{h}d"
                sig_key = f"signal_return_{h}d"
                if len(subsequent_candles) >= h:
                    target_candle = subsequent_candles[h - 1]
                    fut_price = target_candle["close"]
                    if fut_price is not None and fut_price > 0:
                        raw_ret = ((fut_price - entry_price) / entry_price) * 100.0
                        sig_ret = raw_ret if is_buy else -raw_ret
                        returns[raw_key] = round(raw_ret, 2)
                        returns[sig_key] = round(sig_ret, 2)
                    else:
                        returns[raw_key] = None
                        returns[sig_key] = None
                else:
                    returns[raw_key] = None
                    returns[sig_key] = None

            deal_results.append({
                "deal_id": d["id"],
                "deal_date": str(d["trade_date"]),
                "deal_type": d["deal_category"],
                "action": d["action"].upper(),
                "security_name": d["security_name"],
                "nse_symbol": sym,
                "company_name": m.get("company_name") or d["security_name"],
                "promoter_client": d.get("client_name"),
                "quantity": safe_float(d.get("quantity")) if d.get("quantity") is not None else None,
                "deal_price": safe_float(d.get("price")),
                "deal_value": safe_float(d.get("total_value")),
                "entry_price": round(entry_price, 2),
                "entry_date": str(entry_candle["trade_date"]),
                **returns,
                "signal_return": returns.get("signal_return_20d"),
                "match_status": m["match_status"],
                "match_confidence": m.get("match_confidence", 1.0),
                "match_method": m.get("match_method", "EXACT"),
            })

        # 6. Aggregate Statistics
        def calc_stats_for(deals_subset: List[Dict[str, Any]], h: int) -> Dict[str, Any]:
            key = f"signal_return_{h}d"
            vals = [r[key] for r in deals_subset if r.get(key) is not None]
            if not vals:
                return {
                    "total_observations": 0, "positive_count": 0, "negative_count": 0, "neutral_count": 0,
                    "win_rate": 0.0, "avg_return": 0.0, "median_return": 0.0,
                    "best_return": 0.0, "worst_return": 0.0, "pos_pct": 0.0, "neg_pct": 0.0
                }
            pos = [v for v in vals if v > 0]
            neg = [v for v in vals if v < 0]
            neu = [v for v in vals if v == 0]
            n = len(vals)
            return {
                "total_observations": n,
                "positive_count": len(pos),
                "negative_count": len(neg),
                "neutral_count": len(neu),
                "win_rate": round((len(pos) / n) * 100.0, 2),
                "avg_return": round(sum(vals) / n, 2),
                "median_return": round(statistics.median(vals), 2),
                "best_return": round(max(vals), 2),
                "worst_return": round(min(vals), 2),
                "pos_pct": round((len(pos) / n) * 100.0, 2),
                "neg_pct": round((len(neg) / n) * 100.0, 2),
            }

        horizon_performance = {f"{h}D": calc_stats_for(deal_results, h) for h in horizons}

        # Deal Type Breakdown
        deal_type_perf = {}
        for cat in categories:
            cat_deals = [r for r in deal_results if r["deal_type"] == cat]
            deal_type_perf[cat] = {
                "signal_count": len(cat_deals),
                "horizons": {f"{h}D": calc_stats_for(cat_deals, h) for h in horizons}
            }

        # BUY vs SELL Breakdown
        action_perf = {}
        for act in ["BUY", "SELL"]:
            act_deals = [r for r in deal_results if r["action"] == act]
            action_perf[act] = {
                "signal_count": len(act_deals),
                "horizons": {f"{h}D": calc_stats_for(act_deals, h) for h in horizons}
            }

        buy_signals = sum(1 for r in deal_results if r["action"] == "BUY")
        sell_signals = sum(1 for r in deal_results if r["action"] == "SELL")

        summary = {
            "total_signals": total_signals,
            "eligible_signals": len(deal_results),
            "excluded_signals": len(excluded_records),
            "buy_signals": buy_signals,
            "sell_signals": sell_signals,
            "win_rate_20d": horizon_performance["20D"]["win_rate"],
            "avg_return_20d": horizon_performance["20D"]["avg_return"],
            "win_rate_60d": horizon_performance["60D"]["win_rate"],
            "avg_return_60d": horizon_performance["60D"]["avg_return"],
            "horizon_performance": horizon_performance,
        }

        execution_time_ms = int((time.perf_counter_ns() - start_time_ns) / 1_000_000)

        run_record = {
            "run_id": run_id,
            "from_date": from_date,
            "to_date": to_date,
            "deal_types": categories,
            "actions": allowed_actions,
            "exchange": exchange.upper(),
            "min_value_lakhs": min_value_lakhs,
            "total_signals": total_signals,
            "eligible_signals": len(deal_results),
            "excluded_signals": len(excluded_records),
            "summary": summary,
            "deal_type_performance": deal_type_perf,
            "action_performance": action_perf,
            "deals": deal_results,
            "excluded_records": excluded_records,
            "execution_time_ms": execution_time_ms,
            "status": "COMPLETED",
        }

        # Persist run to DB
        try:
            backtest_persistence.save_run(run_record)
        except Exception as e:
            logger.warning(f"Could not persist backtest run {run_id}: {e}")

        return run_record


# Global singleton engine
backtester = BacktestEngine()
