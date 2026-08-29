import React, { useState, useEffect, useCallback } from 'react';
import {
  Filter, RefreshCw, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUpRight, ArrowDownRight,
  AlertTriangle, SlidersHorizontal, ChevronDown, ChevronUp, X,
} from 'lucide-react';
import { api } from '../services/api';

const SORT_OPTIONS = [
  { field: 'conviction_score', label: 'Conviction Score' },
  { field: 'insider_value', label: 'Insider Value' },
  { field: 'insider_count', label: 'Insider Count' },
  { field: 'return_1d', label: '1D Return' },
  { field: 'return_5d', label: '5D Return' },
  { field: 'return_20d', label: '20D Return' },
  { field: 'return_3m', label: '3M Return' },
  { field: 'return_6m', label: '6M Return' },
  { field: 'week_52_position', label: '52W Position' },
  { field: 'rsi', label: 'RSI' },
  { field: 'volume_ratio', label: 'Volume Ratio' },
  { field: 'delivery_pct', label: 'Delivery %' },
  { field: 'delivery_increase', label: 'Delivery Increase' },
  { field: 'historical_win_rate', label: 'Historical Win Rate' },
  { field: 'signal_strength_rank', label: 'Signal Strength' },
];

const LOOKBACK_OPTIONS = [7, 14, 30, 60, 90, 180];
const DEAL_CATEGORIES = ['Insider Trading', 'SAST Deals', 'Block Deals', 'Bulk Deals'];

const DEFAULT_FILTERS = {
  insider: {
    buy: true,
    sell: false,
    min_transaction_value_lakhs: 0,
    min_insiders: 1,
    promoter_buying: false,
    repeat_buying: false,
    lookback_days: 30,
  },
  price: {
    return_1d_min: null, return_1d_max: null,
    return_5d_min: null, return_5d_max: null,
    return_20d_min: null, return_20d_max: null,
    return_3m_min: null, return_3m_max: null,
    return_6m_min: null, return_6m_max: null,
    week_52_position_min: null, week_52_position_max: null,
  },
  technical: {
    above_20dma: null, above_50dma: null, above_200dma: null,
    rsi_min: null, rsi_max: null,
    volume_ratio_min: null, volume_ratio_max: null,
    breakout: null,
  },
  delivery: { delivery_pct_min: null, delivery_pct_max: null, delivery_increase_min: null },
  // exchanges starts empty ("no constraint" - same as omitting the field,
  // which falls back to the backend's ENABLED_EXCHANGES default). Seeded to
  // the actual enabled list once fetched, so the checkboxes reflect reality
  // instead of hardcoding a duplicate exchange list here.
  deals: { categories: [...DEAL_CATEGORIES], exchanges: [] },
  conviction: { min_score: null, max_score: null },
  sort: { field: 'conviction_score', direction: 'desc' },
  page: 1,
  page_size: 25,
};

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function formatValue(v) {
  if (v === null || v === undefined) return 'N/A';
  const n = Number(v);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

function Pct({ value, suffix = '%' }) {
  if (value === null || value === undefined) return <span className="text-slate-400 dark:text-slate-600">N/A</span>;
  const isUp = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-bold ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {isUp ? '+' : ''}{value.toFixed(2)}{suffix}
    </span>
  );
}

const SIGNAL_STYLES = {
  'VERY STRONG': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  STRONG: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  MODERATE: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  WEAK: 'bg-slate-200 dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-white/10',
};

function SignalBadge({ tier }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-black tracking-wide ${SIGNAL_STYLES[tier] || SIGNAL_STYLES.WEAK}`}>
      {tier}
    </span>
  );
}

function MinMaxField({ label, minVal, maxVal, onMin, onMax, step = '1' }) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-slate-600 dark:text-slate-400 w-28 flex-shrink-0">{label}</label>
      <input type="number" step={step} placeholder="Min" value={minVal ?? ''} onChange={(e) => onMin(numOrNull(e.target.value))} className="glass-input w-full py-1.5 text-xs" />
      <input type="number" step={step} placeholder="Max" value={maxVal ?? ''} onChange={(e) => onMax(numOrNull(e.target.value))} className="glass-input w-full py-1.5 text-xs" />
    </div>
  );
}

export default function SmartScreener({ onInspectSymbol }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [activeSection, setActiveSection] = useState('insider');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [availableExchanges, setAvailableExchanges] = useState([]);

  const update = (group, key, value) => {
    setFilters((prev) => ({ ...prev, [group]: { ...prev[group], [key]: value } }));
  };

  const runSearch = useCallback(async (payload) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.runScreener(payload);
      setData(res);
    } catch (err) {
      console.error('Screener search failed:', err);
      setError(err.response?.data?.detail || 'Screener search failed.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runSearch(DEFAULT_FILTERS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.getScreenerOptions()
      .then((res) => {
        const enabled = res.enabled_exchanges || [];
        setAvailableExchanges(enabled);
        // Seeds the exchange checkboxes to "all enabled" by default, matching
        // the backend's own ENABLED_EXCHANGES default for an unset filter.
        setFilters((prev) => ({ ...prev, deals: { ...prev.deals, exchanges: enabled } }));
      })
      .catch((err) => console.error('Failed to fetch screener options:', err));
  }, []);

  const handleApply = () => {
    runSearch({ ...filters, page: 1 });
    setFilters((prev) => ({ ...prev, page: 1 }));
  };

  const handleReset = () => {
    const reset = { ...DEFAULT_FILTERS, deals: { ...DEFAULT_FILTERS.deals, exchanges: availableExchanges } };
    setFilters(reset);
    runSearch(reset);
  };

  const handleSort = (field) => {
    const direction = filters.sort.field === field && filters.sort.direction === 'desc' ? 'asc' : 'desc';
    const next = { ...filters, sort: { field, direction }, page: 1 };
    setFilters(next);
    runSearch(next);
  };

  const handlePage = (page) => {
    const next = { ...filters, page };
    setFilters(next);
    runSearch(next);
  };

  const toggleCategory = (cat) => {
    const current = filters.deals.categories;
    const next = current.includes(cat) ? current.filter((c) => c !== cat) : [...current, cat];
    update('deals', 'categories', next);
  };

  const toggleExchange = (ex) => {
    const current = filters.deals.exchanges;
    const next = current.includes(ex) ? current.filter((e) => e !== ex) : [...current, ex];
    update('deals', 'exchanges', next);
  };

  const sections = [
    { id: 'insider', label: 'Insider' },
    { id: 'price', label: 'Price' },
    { id: 'technical', label: 'Technical' },
    { id: 'delivery', label: 'Delivery' },
    { id: 'deals', label: 'Deals & Conviction' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-panel p-6 rounded-2xl">
        <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
          <SlidersHorizontal className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
          Smart Screener
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl">
          Rank stocks by combining insider activity, the Insider Conviction Score, price/technical confirmation, and delivery data.
          Screens stocks with insider/institutional deal activity in the selected lookback window.
        </p>
      </div>

      {/* Filter Panel */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-950/70 border border-slate-200 dark:border-white/[0.08] text-xs mb-5 w-fit flex-wrap">
          {sections.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`px-3.5 py-1.5 rounded-lg font-bold transition-all ${
                activeSection === s.id
                  ? 'bg-white dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-slate-300 dark:border-cyan-500/40 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {activeSection === 'insider' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            <div className="flex items-center gap-5">
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={filters.insider.buy} onChange={(e) => update('insider', 'buy', e.target.checked)} className="w-3.5 h-3.5" />
                Insider BUY
              </label>
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={filters.insider.sell} onChange={(e) => update('insider', 'sell', e.target.checked)} className="w-3.5 h-3.5" />
                Insider SELL
              </label>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-400 w-32 flex-shrink-0">Lookback</label>
              <select value={filters.insider.lookback_days} onChange={(e) => update('insider', 'lookback_days', Number(e.target.value))} className="glass-input text-xs py-1.5 font-medium">
                {LOOKBACK_OPTIONS.map((d) => <option key={d} value={d}>{d} Days</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-400 w-32 flex-shrink-0">Min Value (₹ Lakhs)</label>
              <input type="number" min="0" value={filters.insider.min_transaction_value_lakhs} onChange={(e) => update('insider', 'min_transaction_value_lakhs', numOrNull(e.target.value) || 0)} className="glass-input w-full py-1.5 text-xs" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-400 w-32 flex-shrink-0">Minimum Insiders</label>
              <input type="number" min="0" value={filters.insider.min_insiders} onChange={(e) => update('insider', 'min_insiders', numOrNull(e.target.value) || 0)} className="glass-input w-full py-1.5 text-xs" />
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={filters.insider.promoter_buying} onChange={(e) => update('insider', 'promoter_buying', e.target.checked)} className="w-3.5 h-3.5" />
              Promoter Buying
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={filters.insider.repeat_buying} onChange={(e) => update('insider', 'repeat_buying', e.target.checked)} className="w-3.5 h-3.5" />
              Repeat Buying
            </label>
          </div>
        )}

        {activeSection === 'price' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            <MinMaxField label="1D Return (%)" minVal={filters.price.return_1d_min} maxVal={filters.price.return_1d_max} onMin={(v) => update('price', 'return_1d_min', v)} onMax={(v) => update('price', 'return_1d_max', v)} />
            <MinMaxField label="5D Return (%)" minVal={filters.price.return_5d_min} maxVal={filters.price.return_5d_max} onMin={(v) => update('price', 'return_5d_min', v)} onMax={(v) => update('price', 'return_5d_max', v)} />
            <MinMaxField label="20D Return (%)" minVal={filters.price.return_20d_min} maxVal={filters.price.return_20d_max} onMin={(v) => update('price', 'return_20d_min', v)} onMax={(v) => update('price', 'return_20d_max', v)} />
            <MinMaxField label="3M Return (%)" minVal={filters.price.return_3m_min} maxVal={filters.price.return_3m_max} onMin={(v) => update('price', 'return_3m_min', v)} onMax={(v) => update('price', 'return_3m_max', v)} />
            <MinMaxField label="6M Return (%)" minVal={filters.price.return_6m_min} maxVal={filters.price.return_6m_max} onMin={(v) => update('price', 'return_6m_min', v)} onMax={(v) => update('price', 'return_6m_max', v)} />
            <MinMaxField label="52W Position (%)" minVal={filters.price.week_52_position_min} maxVal={filters.price.week_52_position_max} onMin={(v) => update('price', 'week_52_position_min', v)} onMax={(v) => update('price', 'week_52_position_max', v)} />
          </div>
        )}

        {activeSection === 'technical' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            <div className="flex items-center gap-5 flex-wrap">
              {[['above_20dma', 'Above 20 DMA'], ['above_50dma', 'Above 50 DMA'], ['above_200dma', 'Above 200 DMA']].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <input type="checkbox" checked={!!filters.technical[key]} onChange={(e) => update('technical', key, e.target.checked || null)} className="w-3.5 h-3.5" />
                  {label}
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={!!filters.technical.breakout} onChange={(e) => update('technical', 'breakout', e.target.checked || null)} className="w-3.5 h-3.5" />
              20-Day Breakout
            </label>
            <MinMaxField label="RSI" minVal={filters.technical.rsi_min} maxVal={filters.technical.rsi_max} onMin={(v) => update('technical', 'rsi_min', v)} onMax={(v) => update('technical', 'rsi_max', v)} />
            <MinMaxField label="Volume Ratio" minVal={filters.technical.volume_ratio_min} maxVal={filters.technical.volume_ratio_max} onMin={(v) => update('technical', 'volume_ratio_min', v)} onMax={(v) => update('technical', 'volume_ratio_max', v)} step="0.1" />
          </div>
        )}

        {activeSection === 'delivery' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
            <MinMaxField label="Delivery % " minVal={filters.delivery.delivery_pct_min} maxVal={filters.delivery.delivery_pct_max} onMin={(v) => update('delivery', 'delivery_pct_min', v)} onMax={(v) => update('delivery', 'delivery_pct_max', v)} />
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-600 dark:text-slate-400 w-32 flex-shrink-0">Delivery Increase ≥ (pts)</label>
              <input type="number" value={filters.delivery.delivery_increase_min ?? ''} onChange={(e) => update('delivery', 'delivery_increase_min', numOrNull(e.target.value))} className="glass-input w-full py-1.5 text-xs" />
            </div>
          </div>
        )}

        {activeSection === 'deals' && (
          <div className="space-y-5">
            <div>
              <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Deal Types</div>
              <div className="flex items-center gap-4 flex-wrap">
                {DEAL_CATEGORIES.map((cat) => (
                  <label key={cat} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <input type="checkbox" checked={filters.deals.categories.includes(cat)} onChange={() => toggleCategory(cat)} className="w-3.5 h-3.5" />
                    {cat}
                  </label>
                ))}
              </div>
            </div>
            {availableExchanges.length > 0 && (
              <div>
                {/* Options reflect scripts.common:ENABLED_EXCHANGES (NSE only today) */}
                <div className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2">Exchanges</div>
                <div className="flex items-center gap-4 flex-wrap">
                  {availableExchanges.map((ex) => (
                    <label key={ex} className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                      <input type="checkbox" checked={filters.deals.exchanges.includes(ex)} onChange={() => toggleExchange(ex)} className="w-3.5 h-3.5" />
                      {ex}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
              <MinMaxField label="Conviction Score" minVal={filters.conviction.min_score} maxVal={filters.conviction.max_score} onMin={(v) => update('conviction', 'min_score', v)} onMax={(v) => update('conviction', 'max_score', v)} />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2.5 mt-6 pt-4 border-t border-slate-200 dark:border-white/[0.08]">
          <button onClick={handleApply} className="btn-primary text-xs py-2 px-4.5">
            <Filter className="w-3.5 h-3.5" /> Apply Filters
          </button>
          <button onClick={handleReset} className="btn-secondary text-xs py-2 px-4">Reset</button>
          <button onClick={() => runSearch(filters)} className="btn-secondary p-2 ml-auto" title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Results */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2 font-medium">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight">
            {loading ? 'Screening...' : data ? `${data.total_count} Stock${data.total_count === 1 ? '' : 's'} Matched` : 'Results'}
            {data && <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-2">(from a universe of {data.universe_size} active symbols)</span>}
          </h3>
        </div>

        {loading ? (
          <div className="py-16 flex items-center justify-center gap-2.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="w-4 h-4 border-2 border-cyan-500 dark:border-cyan-400 border-t-transparent rounded-full animate-spin" />
            Running screener across the active symbol universe...
          </div>
        ) : !data || data.results.length === 0 ? (
          <div className="py-14 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
            <p className="font-semibold">No stocks match the selected criteria.</p>
            <p>Try relaxing one or more filters.</p>
            {data?.top_exclusion_reasons?.length > 0 && (
              <div className="max-w-md mx-auto text-left glass-panel p-4 rounded-xl mt-4">
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-2">Most Restrictive Filters</div>
                <ul className="space-y-1">
                  {data.top_exclusion_reasons.map((r, i) => (
                    <li key={i} className="flex justify-between text-[11px] text-slate-600 dark:text-slate-400">
                      <span>{r.reason}</span>
                      <span className="font-mono font-bold">{r.excluded_count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3">Rank</th>
                    <th className="py-2.5 px-3">Stock</th>
                    {[
                      ['conviction_score', 'Conviction'],
                      ['insider_value', 'Insider Value'],
                      ['insider_count', 'Insiders'],
                      ['price_momentum', 'Momentum'],
                      ['delivery_pct', 'Delivery'],
                      ['volume_ratio', 'Vol Ratio'],
                      ['historical_win_rate', 'Win Rate'],
                      ['signal_strength_rank', 'Signal'],
                    ].map(([field, label]) => (
                      <th key={field} className="py-2.5 px-3 cursor-pointer select-none text-right" onClick={() => handleSort(field)}>
                        <div className="flex items-center justify-end gap-1">
                          {label}
                          {filters.sort.field === field ? (
                            filters.sort.direction === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40" />
                          )}
                        </div>
                      </th>
                    ))}
                    <th className="py-2.5 px-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
                  {data.results.map((r) => (
                    <React.Fragment key={r.symbol}>
                      <tr className="hover:bg-slate-100/70 dark:hover:bg-white/[0.025] transition-colors">
                        <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">#{r.rank}</td>
                        <td className="py-2.5 px-3">
                          <button onClick={() => onInspectSymbol && onInspectSymbol(r.symbol)} className="font-bold text-slate-900 dark:text-white hover:text-cyan-600 dark:hover:text-cyan-400 underline decoration-dotted underline-offset-2">
                            {r.symbol}
                          </button>
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold">
                          {r.conviction_score !== null ? (
                            <span className={r.conviction_score >= 70 ? 'text-emerald-600 dark:text-emerald-400' : r.conviction_score >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}>
                              {r.conviction_score.toFixed(0)}
                            </span>
                          ) : <span className="text-slate-400 dark:text-slate-600">N/A</span>}
                        </td>
                        <td className={`py-2.5 px-3 text-right font-bold ${(r.insider_value || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {formatValue(r.insider_value)}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">{r.insider_count}</td>
                        <td className="py-2.5 px-3 text-right"><Pct value={r.price_momentum} /></td>
                        <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">{r.delivery_pct !== null ? `${r.delivery_pct.toFixed(1)}%` : 'N/A'}</td>
                        <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">{r.volume_ratio !== null ? `${r.volume_ratio.toFixed(2)}×` : 'N/A'}</td>
                        <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300">
                          {r.historical_win_rate_available ? `${r.historical_win_rate.toFixed(0)}%` : <span className="text-slate-400 dark:text-slate-600">Insufficient</span>}
                        </td>
                        <td className="py-2.5 px-3 text-right"><SignalBadge tier={r.signal_strength} /></td>
                        <td className="py-2.5 px-3 text-right">
                          <button onClick={() => setExpandedRow(expandedRow === r.symbol ? null : r.symbol)} className="btn-secondary p-1.5">
                            {expandedRow === r.symbol ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                      </tr>
                      {expandedRow === r.symbol && (
                        <tr className="bg-slate-50 dark:bg-white/[0.02]">
                          <td colSpan={10} className="py-4 px-4 font-sans">
                            <div className="flex flex-wrap items-start gap-6">
                              <div className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
                                <div>Confidence: <span className="font-bold text-slate-800 dark:text-slate-200">{r.conviction_confidence || 'N/A'}</span></div>
                                <div>1D: <Pct value={r.return_1d} /> · 5D: <Pct value={r.return_5d} /> · 20D: <Pct value={r.return_20d} /> · 3M: <Pct value={r.return_3m} /> · 6M: <Pct value={r.return_6m} /></div>
                                <div>52W Position: {r.week_52_position !== null ? `${r.week_52_position.toFixed(0)}%` : 'N/A'} · RSI: {r.rsi !== null ? r.rsi.toFixed(0) : 'N/A'} · Breakout: {r.breakout === true ? 'Yes' : r.breakout === false ? 'No' : 'N/A'}</div>
                                {r.historical_win_rate_available && (
                                  <div>Historical Win Rate: {r.historical_win_rate.toFixed(0)}% ({Math.round(r.historical_win_rate / 100 * r.historical_win_rate_sample)}/{r.historical_win_rate_sample} signals)</div>
                                )}
                              </div>
                              <div className="flex-1 min-w-[220px]">
                                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1.5">Key Reasons</div>
                                {r.signal_reasons.length === 0 ? (
                                  <p className="text-xs text-slate-500 dark:text-slate-400">No confirming evidence beyond conviction data.</p>
                                ) : (
                                  <ul className="flex flex-wrap gap-1.5">
                                    {r.signal_reasons.map((reason, i) => (
                                      <li key={i} className="badge-tag">✓ {reason}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <button onClick={() => onInspectSymbol && onInspectSymbol(r.symbol)} className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0">
                                Full Conviction Breakdown →
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {data.total_pages > 1 && (
              <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-white/[0.08] mt-4 text-xs">
                <div className="text-slate-500 dark:text-slate-400 font-mono">
                  Page <span className="text-slate-900 dark:text-white font-bold">{data.page}</span> of {data.total_pages} ({data.total_count} total)
                </div>
                <div className="flex items-center gap-2">
                  <button disabled={data.page <= 1} onClick={() => handlePage(data.page - 1)} className="btn-secondary py-1.5 px-3 disabled:opacity-30">
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </button>
                  <button disabled={data.page >= data.total_pages} onClick={() => handlePage(data.page + 1)} className="btn-secondary py-1.5 px-3 disabled:opacity-30">
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
