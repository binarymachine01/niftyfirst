import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Play, Calendar, Filter, Download, AlertTriangle, ShieldCheck, ShieldAlert,
  TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Layers, CheckSquare,
  Square, RefreshCw, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Search, Eye, X, History, BarChart3, Clock, CheckCircle2, XCircle, FileSpreadsheet
} from 'lucide-react';
import { api } from '../services/api';

const DEAL_TYPE_OPTIONS = [
  { id: 'Insider Trading', label: 'Insider', badge: 'SEBI PIT', color: 'emerald' },
  { id: 'SAST Deals', label: 'SAST', badge: 'Takeovers', color: 'purple' },
  { id: 'Block Deals', label: 'Block', badge: 'Min ₹10Cr', color: 'amber' },
  { id: 'Bulk Deals', label: 'Bulk', badge: '>0.5% Eq', color: 'cyan' },
];

function formatValue(v) {
  if (v === null || v === undefined) return '—';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 10000000) return `₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `₹${(abs / 100000).toFixed(2)} L`;
  return `₹${abs.toLocaleString('en-IN')}`;
}

function ReturnCell({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-400 font-mono text-[11px]">N/A</span>;
  }
  const n = Number(value);
  const isPos = n > 0;
  const isNeg = n < 0;
  return (
    <span className={`font-mono text-xs font-bold inline-flex items-center gap-0.5 ${
      isPos ? 'text-emerald-600 dark:text-emerald-400' : isNeg ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'
    }`}>
      {isPos ? '+' : ''}{n.toFixed(2)}%
    </span>
  );
}

export default function DateRangeBacktester() {
  // Config & Form State
  const [fromDate, setFromDate] = useState('2026-01-01');
  const [toDate, setToDate] = useState('2026-08-31');
  const [dealTypes, setDealTypes] = useState(['Insider Trading', 'SAST Deals', 'Block Deals', 'Bulk Deals']);
  const [action, setAction] = useState('BOTH'); // BUY, SELL, BOTH
  const [minValueLakhs, setMinValueLakhs] = useState(0);
  const [activePreset, setActivePreset] = useState('custom');

  // Metadata & Status State
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [runData, setRunData] = useState(null);

  // Table & Filter State
  const [tableSearch, setTableSearch] = useState('');
  const [tableCategory, setTableCategory] = useState('ALL');
  const [tableAction, setTableAction] = useState('ALL');
  const [tableReturnFilter, setTableReturnFilter] = useState('ALL'); // ALL, POSITIVE, NEGATIVE
  const [sortField, setSortField] = useState('deal_date');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Modals
  const [showExcludedModal, setShowExcludedModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 1. Fetch Data Availability on Mount
  useEffect(() => {
    api.getBacktestDataAvailability().then((res) => {
      setAvailability(res);
      if (res?.eod?.max_date) {
        // Set default To Date to latest available EOD date
        const maxD = res.eod.max_date;
        setToDate(maxD);
        // Default From Date 6 months prior
        try {
          const d = new Date(maxD);
          d.setMonth(d.getMonth() - 6);
          setFromDate(d.toISOString().slice(0, 10));
          setActivePreset('6m');
        } catch (e) {
          console.error(e);
        }
      }
    }).catch((err) => {
      console.error('Failed to load data availability:', err);
    });
  }, []);

  // Quick Preset Helper
  const applyPreset = (presetKey) => {
    setActivePreset(presetKey);
    const maxDateStr = availability?.eod?.max_date || new Date().toISOString().slice(0, 10);
    const maxDate = new Date(maxDateStr);
    setToDate(maxDateStr);

    if (presetKey === '30d') {
      const d = new Date(maxDate);
      d.setDate(d.getDate() - 30);
      setFromDate(d.toISOString().slice(0, 10));
    } else if (presetKey === '90d') {
      const d = new Date(maxDate);
      d.setDate(d.getDate() - 90);
      setFromDate(d.toISOString().slice(0, 10));
    } else if (presetKey === '6m') {
      const d = new Date(maxDate);
      d.setMonth(d.getMonth() - 6);
      setFromDate(d.toISOString().slice(0, 10));
    } else if (presetKey === '1y') {
      const d = new Date(maxDate);
      d.setFullYear(d.getFullYear() - 1);
      setFromDate(d.toISOString().slice(0, 10));
    } else if (presetKey === 'full') {
      if (availability?.eod?.min_date) {
        setFromDate(availability.eod.min_date);
      } else {
        setFromDate('2024-12-02');
      }
    }
  };

  const handleToggleDealType = (typeId) => {
    if (dealTypes.includes(typeId)) {
      if (dealTypes.length > 1) {
        setDealTypes(dealTypes.filter((t) => t !== typeId));
      }
    } else {
      setDealTypes([...dealTypes, typeId]);
    }
  };

  const handleSelectAllDealTypes = () => {
    setDealTypes(DEAL_TYPE_OPTIONS.map((t) => t.id));
  };

  const handleClearDealTypes = () => {
    setDealTypes(['Insider Trading']); // keep at least one
  };

  // Run Backtest
  const handleRunBacktest = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        from_date: fromDate,
        to_date: toDate,
        deal_types: dealTypes,
        actions: action === 'BOTH' ? ['BUY', 'SELL'] : [action],
        exchange: 'NSE',
        min_value_lakhs: parseFloat(minValueLakhs) || 0,
      };
      const res = await api.runDateRangeBacktest(payload);
      setRunData(res.data);
      setPage(1);
    } catch (err) {
      console.error('Backtest error:', err);
      setError(err.response?.data?.detail || err.message || 'Backtest execution failed.');
    } finally {
      setLoading(false);
    }
  };

  // Export handlers
  const handleExport = async (type = 'deals', format = 'csv') => {
    if (!runData?.run_id) return;
    setExporting(true);
    try {
      await api.downloadBacktestExport(runData.run_id, type, format);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  };

  // Load history runs
  const handleOpenHistory = async () => {
    setShowHistoryModal(true);
    setLoadingHistory(true);
    try {
      const res = await api.getBacktestRuns(15);
      setHistoryRuns(res.runs || []);
    } catch (err) {
      console.error('Failed to load runs:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleLoadHistoricRun = async (runId) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getBacktestRun(runId);
      setRunData(res.data);
      setFromDate(res.data.from_date);
      setToDate(res.data.to_date);
      setDealTypes(res.data.deal_types || []);
      setShowHistoryModal(false);
      setPage(1);
    } catch (err) {
      console.error('Failed to load run:', err);
      setError('Could not load prior backtest run.');
    } finally {
      setLoading(false);
    }
  };

  const [expandedRowKey, setExpandedRowKey] = useState(null);

  // Deals Filtering and Sorting
  const filteredDeals = useMemo(() => {
    if (!runData?.deals) return [];
    let items = runData.deals;

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase();
      items = items.filter(
        (d) =>
          d.security_name?.toLowerCase().includes(q) ||
          d.nse_symbol?.toLowerCase().includes(q) ||
          d.company_name?.toLowerCase().includes(q) ||
          d.underlying_deals?.some((u) => u.client_name?.toLowerCase().includes(q))
      );
    }

    if (tableCategory !== 'ALL') {
      items = items.filter((d) => d.deal_type === tableCategory);
    }

    if (tableAction !== 'ALL') {
      items = items.filter((d) => d.action === tableAction);
    }

    if (tableReturnFilter === 'POSITIVE') {
      items = items.filter((d) => d.signal_return !== null && d.signal_return > 0);
    } else if (tableReturnFilter === 'NEGATIVE') {
      items = items.filter((d) => d.signal_return !== null && d.signal_return < 0);
    }

    // Sort numerically or alphabetically
    items = [...items].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (valA === null || valA === undefined) valA = sortDir === 'asc' ? Infinity : -Infinity;
      if (valB === null || valB === undefined) valB = sortDir === 'asc' ? Infinity : -Infinity;
      if (typeof valA === 'string') {
        return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortDir === 'asc' ? valA - valB : valB - valA;
    });

    return items;
  }, [runData?.deals, tableSearch, tableCategory, tableAction, tableReturnFilter, sortField, sortDir]);

  // Total underlying transactions in filtered set
  const filteredTransactionsCount = useMemo(() => {
    return filteredDeals.reduce((sum, d) => sum + (d.transaction_count || 1), 0);
  }, [filteredDeals]);

  // Paginated Deals
  const totalPages = Math.ceil(filteredDeals.length / pageSize) || 1;
  const paginatedDeals = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredDeals.slice(start, start + pageSize);
  }, [filteredDeals, page, pageSize]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const toggleRowExpansion = (key) => {
    setExpandedRowKey((prev) => (prev === key ? null : key));
  };

  const summary = runData?.summary;
  const horizonStats = summary?.horizon_performance || {};
  const dealTypePerf = runData?.deal_type_performance || {};
  const actionPerf = runData?.action_performance || {};

  return (
    <div className="space-y-6">
      {/* 1. Header & Configuration Panel */}
      <div className="glass-panel p-6 rounded-2xl space-y-5">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30">
                <BarChart3 className="w-5 h-5" />
              </div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight">
                Full Deal Signal Backtester
              </h2>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Backtest <strong className="text-slate-700 dark:text-slate-300">every eligible insider & market deal</strong> across
              a historical date range with trading-day look-forward return analysis (1D, 5D, 10D, 20D, 60D).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenHistory}
              className="btn-secondary py-2 px-3 text-xs flex items-center gap-1.5 font-bold"
              title="View Previous Backtest Runs"
            >
              <History className="w-4 h-4" /> Run History
            </button>
            {availability?.eod && (
              <div className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-950/70 border border-slate-200 dark:border-white/[0.08] text-[11px] font-mono text-slate-500 dark:text-slate-400">
                EOD Available: <strong className="text-cyan-600 dark:text-cyan-400">{availability.eod.display}</strong>
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Date Range & Presets Row */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          {/* Quick Presets */}
          <div className="md:col-span-4 space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Date Presets
            </label>
            <div className="grid grid-cols-5 gap-1">
              {[
                { id: '30d', label: '30D' },
                { id: '90d', label: '90D' },
                { id: '6m', label: '6M' },
                { id: '1y', label: '1Y' },
                { id: 'full', label: 'Full' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`py-1.5 px-2 text-xs font-mono font-bold rounded-lg border transition-all ${
                    activePreset === p.id
                      ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40'
                      : 'bg-slate-100 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/5 hover:border-slate-300'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* From Date */}
          <div className="md:col-span-3 space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              From Date
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="glass-input w-full pl-9 py-2 text-xs font-mono font-bold"
              />
            </div>
          </div>

          {/* To Date */}
          <div className="md:col-span-3 space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              To Date
            </label>
            <div className="relative">
              <Calendar className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="glass-input w-full pl-9 py-2 text-xs font-mono font-bold"
              />
            </div>
          </div>

          {/* Run Button */}
          <div className="md:col-span-2">
            <button
              onClick={handleRunBacktest}
              disabled={loading}
              className="btn-primary w-full py-2.5 px-4 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-lg shadow-cyan-500/10 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  Run Backtest
                </>
              )}
            </button>
          </div>
        </div>

        {/* Filters Row: Deal Types, Actions, Min Value */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2">
          {/* Deal Types Selector */}
          <div className="md:col-span-6 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Signal Deal Types ({dealTypes.length} Selected)
              </label>
              <div className="flex items-center gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={handleSelectAllDealTypes}
                  className="text-cyan-600 dark:text-cyan-400 hover:underline font-semibold"
                >
                  Select All
                </button>
                <span className="text-slate-400">•</span>
                <button
                  type="button"
                  onClick={handleClearDealTypes}
                  className="text-slate-500 hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DEAL_TYPE_OPTIONS.map((t) => {
                const isSelected = dealTypes.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleToggleDealType(t.id)}
                    className={`p-2 rounded-xl text-left border transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-cyan-500/10 border-cyan-500/40 text-slate-900 dark:text-white font-bold'
                        : 'bg-slate-100/60 dark:bg-slate-900/40 border-slate-200 dark:border-white/5 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs truncate">
                      {isSelected ? (
                        <CheckSquare className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 flex-shrink-0" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                      )}
                      <span className="truncate">{t.label}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action (BUY / SELL / BOTH) */}
          <div className="md:col-span-3 space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Trade Direction
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-950/70 border border-slate-200 dark:border-white/[0.08]">
              {[
                { id: 'BUY', label: 'BUY' },
                { id: 'SELL', label: 'SELL' },
                { id: 'BOTH', label: 'BOTH' },
              ].map((act) => (
                <button
                  key={act.id}
                  type="button"
                  onClick={() => setAction(act.id)}
                  className={`py-1.5 text-xs font-bold rounded-lg transition-all ${
                    action === act.id
                      ? act.id === 'BUY'
                        ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 shadow-sm'
                        : act.id === 'SELL'
                        ? 'bg-rose-500/20 text-rose-700 dark:text-rose-400 border border-rose-500/30 shadow-sm'
                        : 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {act.label}
                </button>
              ))}
            </div>
          </div>

          {/* Min Deal Value Filter */}
          <div className="md:col-span-3 space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Min Value (₹ Lakhs)
            </label>
            <input
              type="number"
              min="0"
              step="10"
              placeholder="0 (All Value Deals)"
              value={minValueLakhs || ''}
              onChange={(e) => setMinValueLakhs(e.target.value)}
              className="glass-input w-full py-2 text-xs font-mono font-bold"
            />
          </div>
        </div>
      </div>

      {/* 2. Summary Dashboard Cards */}
      {runData && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-3">
            {/* Total Signals */}
            <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-white/[0.08]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total Signals
              </div>
              <div className="text-xl font-black font-mono mt-1 text-slate-900 dark:text-white">
                {summary?.total_signals?.toLocaleString() || 0}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">In Date Range</div>
            </div>

            {/* Eligible Signals */}
            <div className="glass-panel p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                Eligible
              </div>
              <div className="text-xl font-black font-mono mt-1 text-emerald-700 dark:text-emerald-300">
                {summary?.eligible_signals?.toLocaleString() || 0}
              </div>
              <div className="text-[10px] font-mono text-emerald-600/70 dark:text-emerald-400/70 mt-0.5">
                {summary?.total_signals > 0
                  ? `${((summary.eligible_signals / summary.total_signals) * 100).toFixed(1)}%`
                  : '0%'} Matched
              </div>
            </div>

            {/* Excluded Signals */}
            <div className="glass-panel p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  Excluded
                </div>
                {summary?.excluded_signals > 0 && (
                  <button
                    onClick={() => setShowExcludedModal(true)}
                    className="text-[10px] font-bold text-amber-600 dark:text-amber-400 hover:underline"
                  >
                    View
                  </button>
                )}
              </div>
              <div className="text-xl font-black font-mono mt-1 text-amber-700 dark:text-amber-300">
                {summary?.excluded_signals?.toLocaleString() || 0}
              </div>
              <div className="text-[10px] font-mono text-amber-600/70 dark:text-amber-400/70 mt-0.5">
                Audit Reasons
              </div>
            </div>

            {/* BUY Signals */}
            <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-white/[0.08]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                BUY Signals
              </div>
              <div className="text-xl font-black font-mono mt-1 text-emerald-600 dark:text-emerald-400">
                {summary?.buy_signals?.toLocaleString() || 0}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">Long Direction</div>
            </div>

            {/* SELL Signals */}
            <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-white/[0.08]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                SELL Signals
              </div>
              <div className="text-xl font-black font-mono mt-1 text-rose-600 dark:text-rose-400">
                {summary?.sell_signals?.toLocaleString() || 0}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">Short Direction</div>
            </div>

            {/* 20D Win Rate */}
            <div className="glass-panel p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
                20D Win Rate
              </div>
              <div className="text-xl font-black font-mono mt-1 text-cyan-700 dark:text-cyan-300">
                {summary?.win_rate_20d?.toFixed(1) || 0}%
              </div>
              <div className="text-[10px] font-mono text-cyan-600/70 dark:text-cyan-400/70 mt-0.5">
                {horizonStats['20D']?.positive_count || 0} / {horizonStats['20D']?.total_observations || 0} trades
              </div>
            </div>

            {/* Avg 20D Return */}
            <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-white/[0.08]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Avg 20D Return
              </div>
              <div className={`text-xl font-black font-mono mt-1 ${
                (summary?.avg_return_20d || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}>
                {(summary?.avg_return_20d || 0) >= 0 ? '+' : ''}{summary?.avg_return_20d?.toFixed(2) || 0}%
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">1-Month Horizon</div>
            </div>

            {/* 60D Win Rate */}
            <div className="glass-panel p-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
                60D Win Rate
              </div>
              <div className="text-xl font-black font-mono mt-1 text-cyan-700 dark:text-cyan-300">
                {summary?.win_rate_60d?.toFixed(1) || 0}%
              </div>
              <div className="text-[10px] font-mono text-cyan-600/70 dark:text-cyan-400/70 mt-0.5">
                {horizonStats['60D']?.positive_count || 0} / {horizonStats['60D']?.total_observations || 0} trades
              </div>
            </div>

            {/* Avg 60D Return */}
            <div className="glass-panel p-4 rounded-xl border border-slate-200 dark:border-white/[0.08]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Avg 60D Return
              </div>
              <div className={`text-xl font-black font-mono mt-1 ${
                (summary?.avg_return_60d || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
              }`}>
                {(summary?.avg_return_60d || 0) >= 0 ? '+' : ''}{summary?.avg_return_60d?.toFixed(2) || 0}%
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">3-Month Horizon</div>
            </div>
          </div>

          {/* 3. Performance Breakdown Section */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Horizon Performance Table */}
            <div className="lg:col-span-6 glass-panel p-5 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                  Look-Forward Horizon Performance
                </h3>
                <span className="text-[11px] font-mono text-slate-400">Trading Days</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3">Horizon</th>
                      <th className="py-2.5 px-2 text-right">Signals</th>
                      <th className="py-2.5 px-2 text-right">Win Rate</th>
                      <th className="py-2.5 px-2 text-right">Avg Return</th>
                      <th className="py-2.5 px-2 text-right">Median</th>
                      <th className="py-2.5 px-2 text-right">Best</th>
                      <th className="py-2.5 px-2 text-right">Worst</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04]">
                    {['1D', '5D', '10D', '20D', '60D'].map((h) => {
                      const stat = horizonStats[h] || {};
                      return (
                        <tr key={h} className="hover:bg-slate-100/60 dark:hover:bg-white/[0.02]">
                          <td className="py-2 px-3 font-sans font-bold text-cyan-700 dark:text-cyan-400">{h}</td>
                          <td className="py-2 px-2 text-right">{stat.total_observations?.toLocaleString() || 0}</td>
                          <td className="py-2 px-2 text-right font-bold">
                            <span className={stat.win_rate >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'}>
                              {stat.win_rate?.toFixed(1) || 0}%
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right font-bold">
                            <ReturnCell value={stat.avg_return} />
                          </td>
                          <td className="py-2 px-2 text-right"><ReturnCell value={stat.median_return} /></td>
                          <td className="py-2 px-2 text-right text-emerald-600 dark:text-emerald-400 font-bold">
                            +{stat.best_return?.toFixed(1) || 0}%
                          </td>
                          <td className="py-2 px-2 text-right text-rose-600 dark:text-rose-400 font-bold">
                            {stat.worst_return?.toFixed(1) || 0}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Deal Type & BUY/SELL Breakdowns */}
            <div className="lg:col-span-6 space-y-6">
              {/* Deal Type Table */}
              <div className="glass-panel p-5 rounded-2xl space-y-3">
                <h3 className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <Layers className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  Deal Type Performance (20D & 60D)
                </h3>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
                  <table className="w-full text-left text-xs border-collapse font-mono">
                    <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3">Deal Type</th>
                        <th className="py-2.5 px-2 text-right">Signals</th>
                        <th className="py-2.5 px-2 text-right">20D Win %</th>
                        <th className="py-2.5 px-2 text-right">20D Avg Ret</th>
                        <th className="py-2.5 px-2 text-right">60D Win %</th>
                        <th className="py-2.5 px-2 text-right">60D Avg Ret</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04]">
                      {Object.entries(dealTypePerf).map(([cat, val]) => (
                        <tr key={cat} className="hover:bg-slate-100/60 dark:hover:bg-white/[0.02]">
                          <td className="py-2 px-3 font-sans font-bold text-slate-900 dark:text-white">{cat}</td>
                          <td className="py-2 px-2 text-right">{val.signal_count}</td>
                          <td className="py-2 px-2 text-right font-bold text-emerald-600 dark:text-emerald-400">
                            {val.horizons?.['20D']?.win_rate?.toFixed(1) || 0}%
                          </td>
                          <td className="py-2 px-2 text-right">
                            <ReturnCell value={val.horizons?.['20D']?.avg_return} />
                          </td>
                          <td className="py-2 px-2 text-right font-bold text-cyan-600 dark:text-cyan-400">
                            {val.horizons?.['60D']?.win_rate?.toFixed(1) || 0}%
                          </td>
                          <td className="py-2 px-2 text-right">
                            <ReturnCell value={val.horizons?.['60D']?.avg_return} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Action Breakdown Table */}
              <div className="glass-panel p-5 rounded-2xl space-y-3">
                <h3 className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  BUY vs SELL Performance
                </h3>
                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
                  <table className="w-full text-left text-xs border-collapse font-mono">
                    <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3">Action</th>
                        <th className="py-2.5 px-2 text-right">Signals</th>
                        <th className="py-2.5 px-2 text-right">5D Win %</th>
                        <th className="py-2.5 px-2 text-right">20D Win %</th>
                        <th className="py-2.5 px-2 text-right">20D Avg Ret</th>
                        <th className="py-2.5 px-2 text-right">60D Avg Ret</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04]">
                      {['BUY', 'SELL'].map((act) => {
                        const info = actionPerf[act] || {};
                        return (
                          <tr key={act} className="hover:bg-slate-100/60 dark:hover:bg-white/[0.02]">
                            <td className="py-2 px-3 font-sans font-bold">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                                act === 'BUY' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                              }`}>
                                {act}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-right">{info.signal_count || 0}</td>
                            <td className="py-2 px-2 text-right font-bold">
                              {info.horizons?.['5D']?.win_rate?.toFixed(1) || 0}%
                            </td>
                            <td className="py-2 px-2 text-right font-bold text-cyan-600 dark:text-cyan-400">
                              {info.horizons?.['20D']?.win_rate?.toFixed(1) || 0}%
                            </td>
                            <td className="py-2 px-2 text-right font-bold">
                              <ReturnCell value={info.horizons?.['20D']?.avg_return} />
                            </td>
                            <td className="py-2 px-2 text-right font-bold">
                              <ReturnCell value={info.horizons?.['60D']?.avg_return} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Detailed Results Table */}
          <div className="glass-panel p-6 rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                  <span>Backtest Signals ({filteredDeals.length.toLocaleString()} Signals)</span>
                  <span className="text-xs font-mono font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-md">
                    {filteredTransactionsCount.toLocaleString()} Underlying Transactions
                  </span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Consolidated by Symbol + Date + Deal Type. Underlying transactions can be expanded via <strong className="text-cyan-600 dark:text-cyan-400">View Deals</strong>.
                </p>
              </div>

              {/* Table Controls: Search, Filters & Export */}
              <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                <div className="relative flex-1 sm:w-56">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search security, symbol, client..."
                    value={tableSearch}
                    onChange={(e) => { setTableSearch(e.target.value); setPage(1); }}
                    className="glass-input w-full pl-8 py-1.5 text-xs"
                  />
                </div>

                <select
                  value={tableCategory}
                  onChange={(e) => { setTableCategory(e.target.value); setPage(1); }}
                  className="glass-input py-1.5 px-2.5 text-xs cursor-pointer"
                >
                  <option value="ALL">All Categories</option>
                  <option value="Insider Trading">Insider Trading</option>
                  <option value="SAST Deals">SAST Deals</option>
                  <option value="Block Deals">Block Deals</option>
                  <option value="Bulk Deals">Bulk Deals</option>
                </select>

                <select
                  value={tableAction}
                  onChange={(e) => { setTableAction(e.target.value); setPage(1); }}
                  className="glass-input py-1.5 px-2.5 text-xs cursor-pointer"
                >
                  <option value="ALL">All Actions</option>
                  <option value="BUY">BUY Dominant</option>
                  <option value="SELL">SELL Dominant</option>
                  <option value="MIXED">MIXED (Neutral)</option>
                </select>

                <select
                  value={tableReturnFilter}
                  onChange={(e) => { setTableReturnFilter(e.target.value); setPage(1); }}
                  className="glass-input py-1.5 px-2.5 text-xs cursor-pointer"
                >
                  <option value="ALL">All Returns</option>
                  <option value="POSITIVE">20D Winners (+)</option>
                  <option value="NEGATIVE">20D Losers (-)</option>
                </select>

                {/* Export Buttons */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleExport('deals', 'csv')}
                    disabled={exporting}
                    className="btn-secondary py-1.5 px-2.5 text-xs font-bold flex items-center gap-1"
                    title="Export Consolidated Signals to CSV"
                  >
                    <Download className="w-3.5 h-3.5" /> Signals CSV
                  </button>
                  <button
                    onClick={() => handleExport('deals', 'xlsx')}
                    disabled={exporting}
                    className="btn-secondary py-1.5 px-2.5 text-xs font-bold flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
                    title="Export Consolidated Signals to Excel"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" /> Excel
                  </button>
                  <button
                    onClick={() => handleExport('transactions', 'csv')}
                    disabled={exporting}
                    className="btn-secondary py-1.5 px-2 text-xs font-medium flex items-center gap-1 text-slate-500"
                    title="Export Raw Underlying Transactions to CSV"
                  >
                    Raw Txns
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider select-none">
                  <tr>
                    <th onClick={() => handleSort('signal_date')} className="py-2.5 px-3 cursor-pointer hover:text-cyan-500">
                      Date {sortField === 'signal_date' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSort('deal_type')} className="py-2.5 px-2 cursor-pointer hover:text-cyan-500">
                      Type
                    </th>
                    <th onClick={() => handleSort('action')} className="py-2.5 px-2 cursor-pointer hover:text-cyan-500">
                      Action
                    </th>
                    <th onClick={() => handleSort('security_name')} className="py-2.5 px-3 cursor-pointer hover:text-cyan-500">
                      Security
                    </th>
                    <th onClick={() => handleSort('nse_symbol')} className="py-2.5 px-2 cursor-pointer hover:text-cyan-500">
                      Symbol
                    </th>
                    <th onClick={() => handleSort('transaction_count')} className="py-2.5 px-2 text-center cursor-pointer hover:text-cyan-500">
                      Txns {sortField === 'transaction_count' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSort('total_deal_value')} className="py-2.5 px-3 text-right cursor-pointer hover:text-cyan-500">
                      Total Value {sortField === 'total_deal_value' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSort('net_buy_value')} className="py-2.5 px-3 text-right cursor-pointer hover:text-cyan-500">
                      Net Buy {sortField === 'net_buy_value' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th onClick={() => handleSort('deal_price')} className="py-2.5 px-2 text-right cursor-pointer hover:text-cyan-500" title="Weighted Average Deal Price">
                      Deal Price
                    </th>
                    <th onClick={() => handleSort('entry_price')} className="py-2.5 px-2 text-right cursor-pointer hover:text-cyan-500" title="NSE EOD Entry Price on Signal Date">
                      EOD Entry
                    </th>
                    <th onClick={() => handleSort('raw_return_1d')} className="py-2.5 px-2 text-right cursor-pointer hover:text-cyan-500">
                      1D
                    </th>
                    <th onClick={() => handleSort('raw_return_5d')} className="py-2.5 px-2 text-right cursor-pointer hover:text-cyan-500">
                      5D
                    </th>
                    <th onClick={() => handleSort('raw_return_10d')} className="py-2.5 px-2 text-right cursor-pointer hover:text-cyan-500">
                      10D
                    </th>
                    <th onClick={() => handleSort('raw_return_20d')} className="py-2.5 px-2 text-right cursor-pointer hover:text-cyan-500">
                      20D
                    </th>
                    <th onClick={() => handleSort('raw_return_60d')} className="py-2.5 px-2 text-right cursor-pointer hover:text-cyan-500">
                      60D
                    </th>
                    <th onClick={() => handleSort('signal_return_20d')} className="py-2.5 px-3 text-right cursor-pointer hover:text-cyan-500 font-extrabold text-cyan-600 dark:text-cyan-400">
                      20D Signal Ret {sortField === 'signal_return_20d' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className="py-2.5 px-2">Match Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
                  {paginatedDeals.length === 0 ? (
                    <tr>
                      <td colSpan={17} className="py-10 text-center text-xs text-slate-500">
                        No deals match the selected criteria.
                      </td>
                    </tr>
                  ) : (
                    paginatedDeals.map((d) => {
                      const rowKey = `${d.signal_date}_${d.nse_symbol}_${d.deal_type}`;
                      const isExpanded = expandedRowKey === rowKey;
                      return (
                        <React.Fragment key={rowKey}>
                          <tr className={`hover:bg-slate-100/60 dark:hover:bg-white/[0.02] ${isExpanded ? 'bg-cyan-500/5 dark:bg-cyan-500/10' : ''}`}>
                            <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{d.signal_date || d.deal_date}</td>
                            <td className="py-2 px-2 font-sans font-bold text-slate-700 dark:text-slate-300 truncate max-w-[100px]">
                              {d.deal_type}
                            </td>
                            <td className="py-2 px-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wide ${
                                d.action === 'BUY'
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                  : d.action === 'SELL'
                                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                                  : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/30'
                              }`}>
                                {d.action}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-sans font-bold text-slate-900 dark:text-white max-w-[180px] truncate" title={d.security_name}>
                              {d.security_name}
                            </td>
                            <td className="py-2 px-2 font-bold text-cyan-600 dark:text-cyan-400">
                              {d.nse_symbol}
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                onClick={() => toggleRowExpansion(rowKey)}
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition-all flex items-center justify-center gap-1 mx-auto ${
                                  d.transaction_count > 1
                                    ? 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-500/25 border border-cyan-500/30'
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                                }`}
                                title="Click to view underlying transactions"
                              >
                                <span>{d.transaction_count || 1}</span>
                                <span className="text-[9px] font-normal">{isExpanded ? '▲' : '▼'}</span>
                              </button>
                            </td>
                            <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300 font-bold">
                              {formatValue(d.total_deal_value || d.deal_value)}
                            </td>
                            <td className={`py-2 px-3 text-right font-bold ${
                              d.net_buy_value > 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : d.net_buy_value < 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-slate-500'
                            }`}>
                              {formatValue(d.net_buy_value)}
                            </td>
                            <td className="py-2 px-2 text-right text-slate-600 dark:text-slate-400">
                              {d.deal_price ? `₹${d.deal_price.toFixed(2)}` : '—'}
                            </td>
                            <td className="py-2 px-2 text-right text-slate-900 dark:text-white font-bold">
                              ₹{d.entry_price?.toFixed(2)}
                            </td>
                            <td className="py-2 px-2 text-right"><ReturnCell value={d.raw_return_1d} /></td>
                            <td className="py-2 px-2 text-right"><ReturnCell value={d.raw_return_5d} /></td>
                            <td className="py-2 px-2 text-right"><ReturnCell value={d.raw_return_10d} /></td>
                            <td className="py-2 px-2 text-right"><ReturnCell value={d.raw_return_20d} /></td>
                            <td className="py-2 px-2 text-right"><ReturnCell value={d.raw_return_60d} /></td>
                            <td className="py-2 px-3 text-right bg-cyan-500/5 font-bold">
                              <ReturnCell value={d.signal_return_20d} />
                            </td>
                            <td className="py-2 px-2 font-sans">
                              <span className="badge-tag text-[10px] font-bold">
                                {d.match_status}
                              </span>
                            </td>
                          </tr>

                          {/* Expandable Underlying Deals Sub-table */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={17} className="p-3 bg-slate-50/80 dark:bg-slate-900/60 border-y border-cyan-500/20">
                                <div className="p-3 rounded-xl bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-white/[0.08] space-y-2">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5 font-sans">
                                      <span>🔍 Underlying Raw Deals ({d.underlying_deals?.length || 0})</span>
                                      <span className="font-mono text-[11px] text-cyan-600 dark:text-cyan-400">
                                        for {d.security_name} ({d.nse_symbol}) on {d.signal_date}
                                      </span>
                                    </span>
                                    <span className="text-[11px] font-mono text-slate-500">
                                      BUY: {d.buy_transaction_count || 0} ({formatValue(d.total_buy_value)}) · SELL: {d.sell_transaction_count || 0} ({formatValue(d.total_sell_value)})
                                    </span>
                                  </div>

                                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-white/[0.06]">
                                    <table className="w-full text-left text-[11px] font-mono border-collapse">
                                      <thead className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 uppercase text-[9px] tracking-wider">
                                        <tr>
                                          <th className="py-1.5 px-2">#</th>
                                          <th className="py-1.5 px-2">Action</th>
                                          <th className="py-1.5 px-3">Client / Promoter</th>
                                          <th className="py-1.5 px-2 text-right">Quantity</th>
                                          <th className="py-1.5 px-2 text-right">Trade Price</th>
                                          <th className="py-1.5 px-3 text-right">Value</th>
                                          <th className="py-1.5 px-2">Mode</th>
                                          <th className="py-1.5 px-2">Exch</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04]">
                                        {(d.underlying_deals || []).map((ud, idx) => (
                                          <tr key={ud.id || idx} className="hover:bg-slate-100/60 dark:hover:bg-white/[0.02]">
                                            <td className="py-1.5 px-2 text-slate-400">{idx + 1}</td>
                                            <td className="py-1.5 px-2">
                                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black ${
                                                ud.action === 'BUY'
                                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                              }`}>
                                                {ud.action}
                                              </span>
                                            </td>
                                            <td className="py-1.5 px-3 font-sans font-medium text-slate-900 dark:text-slate-200">
                                              {ud.client_name || '—'}
                                            </td>
                                            <td className="py-1.5 px-2 text-right">{ud.quantity?.toLocaleString() || '—'}</td>
                                            <td className="py-1.5 px-2 text-right">₹{ud.price?.toFixed(2) || '—'}</td>
                                            <td className="py-1.5 px-3 text-right font-bold text-slate-800 dark:text-slate-200">
                                              {formatValue(ud.total_value)}
                                            </td>
                                            <td className="py-1.5 px-2 text-slate-500 font-sans">{ud.mode_description || ud.deal_category}</td>
                                            <td className="py-1.5 px-2 text-slate-500">{ud.exchange_name || 'NSE'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination & Status Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-3 border-t border-slate-200 dark:border-white/[0.08] text-xs">
              <div className="text-slate-500 font-mono text-[11px]">
                Showing <strong>{filteredDeals.length > 0 ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, filteredDeals.length)}</strong> of <strong>{filteredDeals.length.toLocaleString()}</strong> signals ({filteredTransactionsCount.toLocaleString()} raw transactions)
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-1.5 font-mono">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(1)}
                    className="btn-secondary py-1 px-2 disabled:opacity-30"
                  >
                    <ChevronsLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    className="btn-secondary py-1 px-2.5 disabled:opacity-30 flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" /> Prev
                  </button>
                  <span className="px-3 py-1 font-bold text-slate-800 dark:text-slate-200">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                    className="btn-secondary py-1 px-2.5 disabled:opacity-30 flex items-center gap-1"
                  >
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage(totalPages)}
                    className="btn-secondary py-1 px-2 disabled:opacity-30"
                  >
                    <ChevronsRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Excluded Records Modal */}
      {showExcludedModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setShowExcludedModal(false)} />
          <div className="glass-panel relative w-full max-w-4xl rounded-2xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-white/[0.08]">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-500" />
                  Excluded Records Audit ({runData?.excluded_records?.length || 0})
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Deals excluded from performance calculation due to strict governance rules (never silently matched).
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExport('excluded', 'csv')}
                  className="btn-secondary py-1 px-2.5 text-xs font-bold flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </button>
                <button onClick={() => setShowExcludedModal(false)} className="btn-secondary p-1.5">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 rounded-xl border border-slate-200 dark:border-white/[0.06]">
              <table className="w-full text-left text-xs border-collapse font-mono">
                <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-2">Type</th>
                    <th className="py-2.5 px-3">Security Name</th>
                    <th className="py-2.5 px-2">Candidate</th>
                    <th className="py-2.5 px-2">Match Status</th>
                    <th className="py-2.5 px-3">Exclusion Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04]">
                  {(runData?.excluded_records || []).map((ex, idx) => (
                    <tr key={idx} className="hover:bg-slate-100/50 dark:hover:bg-white/[0.02]">
                      <td className="py-2 px-3 text-slate-400">{ex.deal_date}</td>
                      <td className="py-2 px-2 font-sans font-bold">{ex.deal_type}</td>
                      <td className="py-2 px-3 font-sans font-bold text-slate-900 dark:text-white truncate max-w-[200px]" title={ex.security_name}>
                        {ex.security_name}
                      </td>
                      <td className="py-2 px-2 text-cyan-600 dark:text-cyan-400 font-bold">{ex.candidate_symbol || '—'}</td>
                      <td className="py-2 px-2">
                        <span className="badge-tag text-[10px]">{ex.match_status}</span>
                      </td>
                      <td className="py-2 px-3 font-bold text-amber-600 dark:text-amber-400">
                        {ex.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setShowHistoryModal(false)} />
          <div className="glass-panel relative w-full max-w-3xl rounded-2xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-white/[0.08]">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <History className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                  Past Backtest Executions
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Reload previously executed historical backtests.
                </p>
              </div>
              <button onClick={() => setShowHistoryModal(false)} className="btn-secondary p-1.5">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 rounded-xl border border-slate-200 dark:border-white/[0.06]">
              {loadingHistory ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  <RefreshCw className="w-4 h-4 animate-spin inline-block mr-2" /> Loading history...
                </div>
              ) : historyRuns.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No previous backtest runs recorded yet.
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3">Run Date</th>
                      <th className="py-2.5 px-3">Range</th>
                      <th className="py-2.5 px-2 text-right">Signals</th>
                      <th className="py-2.5 px-2 text-right">20D Win %</th>
                      <th className="py-2.5 px-2 text-right">Avg Return</th>
                      <th className="py-2.5 px-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04]">
                    {historyRuns.map((r) => (
                      <tr key={r.run_id} className="hover:bg-slate-100/50 dark:hover:bg-white/[0.02]">
                        <td className="py-2 px-3 text-slate-500">{r.created_at?.slice(0, 16)}</td>
                        <td className="py-2 px-3 font-bold text-slate-800 dark:text-slate-200">
                          {r.from_date} → {r.to_date}
                        </td>
                        <td className="py-2 px-2 text-right">{r.eligible_signals} / {r.total_signals}</td>
                        <td className="py-2 px-2 text-right font-bold text-emerald-600 dark:text-emerald-400">
                          {r.summary?.win_rate_20d?.toFixed(1) || 0}%
                        </td>
                        <td className="py-2 px-2 text-right">
                          <ReturnCell value={r.summary?.avg_return_20d} />
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => handleLoadHistoricRun(r.run_id)}
                            className="btn-secondary py-1 px-2.5 text-[11px] font-bold"
                          >
                            Load
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
