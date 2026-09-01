import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Filter,
  Layers,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  ArrowUpDown,
  RotateCcw,
  Check,
  TrendingUp,
  X,
} from 'lucide-react';
import { api } from '../services/api';
import ClientDrilldownModal from './ClientDrilldownModal';

function ReactionCell({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-400 dark:text-slate-600">—</span>;
  }
  const isUp = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-bold ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {isUp ? '+' : ''}{value.toFixed(2)}%
    </span>
  );
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function DealsExplorer() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState('all');
  const [action, setAction] = useState('all');
  const [exchange, setExchange] = useState('all');
  const [availableExchanges, setAvailableExchanges] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);

  // New Feature States
  const [netBuyOnly, setNetBuyOnly] = useState(false);
  const [datePreset, setDatePreset] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustomDateModal, setShowCustomDateModal] = useState(false);
  const [sortOption, setSortOption] = useState('date_desc');

  const customModalRef = useRef(null);

  const getSortParams = () => {
    switch (sortOption) {
      case 'date_asc':
        return { sort_by: 'date', sort_order: 'asc' };
      case 'value_desc':
        return { sort_by: 'value', sort_order: 'desc' };
      case 'value_asc':
        return { sort_by: 'value', sort_order: 'asc' };
      case 'date_desc':
      default:
        return { sort_by: 'date', sort_order: 'desc' };
    }
  };

  const computeDateRange = (preset) => {
    const today = new Date();
    if (preset === 'today') {
      const todayStr = formatDate(today);
      return { start: todayStr, end: todayStr };
    } else if (preset === '7d') {
      const past = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start: formatDate(past), end: formatDate(today) };
    } else if (preset === '30d') {
      const past = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { start: formatDate(past), end: formatDate(today) };
    } else if (preset === '90d') {
      const past = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
      return { start: formatDate(past), end: formatDate(today) };
    } else if (preset === 'all') {
      return { start: '', end: '' };
    }
    return { start: startDate, end: endDate };
  };

  const handleDatePresetChange = (preset) => {
    setDatePreset(preset);
    setPage(1);
    if (preset === 'custom') {
      setShowCustomDateModal(true);
    } else {
      setShowCustomDateModal(false);
      const { start, end } = computeDateRange(preset);
      setStartDate(start);
      setEndDate(end);
    }
  };

  const applyCustomDateRange = () => {
    setStartDate(customFrom);
    setEndDate(customTo);
    setShowCustomDateModal(false);
    setPage(1);
  };

  const clearCustomDateRange = () => {
    setCustomFrom('');
    setCustomTo('');
    setStartDate('');
    setEndDate('');
    setDatePreset('all');
    setShowCustomDateModal(false);
    setPage(1);
  };

  const handleResetFilters = () => {
    setCategory('all');
    setAction('all');
    setExchange('all');
    setSearch('');
    setNetBuyOnly(false);
    setDatePreset('all');
    setStartDate('');
    setEndDate('');
    setCustomFrom('');
    setCustomTo('');
    setShowCustomDateModal(false);
    setSortOption('date_desc');
    setPage(1);
  };

  const fetchDeals = async () => {
    setLoading(true);
    try {
      const sort = getSortParams();
      const res = await api.getDeals({
        category: category !== 'all' ? category : undefined,
        action: action !== 'all' ? action : undefined,
        exchange: exchange !== 'all' ? exchange : undefined,
        search: search.trim() || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        net_buy_only: netBuyOnly,
        sort_by: sort.sort_by,
        sort_order: sort.sort_order,
        page,
        page_size: 25,
      });
      setDeals(res.deals || []);
      setTotalPages(res.total_pages || 1);
      setTotalCount(res.total_count || 0);
    } catch (err) {
      console.error('Failed to fetch deals:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await api.getDealsSummary({
        category: category !== 'all' ? category : undefined,
        action: action !== 'all' ? action : undefined,
        exchange: exchange !== 'all' ? exchange : undefined,
        search: search.trim() || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        net_buy_only: netBuyOnly,
      });
      setSummary(res);
    } catch (err) {
      console.error('Failed to fetch summary:', err);
    }
  };

  const fetchExchanges = async () => {
    try {
      const res = await api.getDealExchanges();
      const combined = Array.from(new Set([...(res.enabled_exchanges || []), ...(res.available_exchanges || [])]));
      setAvailableExchanges(combined);
    } catch (err) {
      console.error('Failed to fetch exchanges:', err);
    }
  };

  useEffect(() => {
    fetchDeals();
  }, [category, action, exchange, netBuyOnly, startDate, endDate, sortOption, page]);

  useEffect(() => {
    fetchSummary();
  }, [category, action, exchange, netBuyOnly, startDate, endDate]);

  useEffect(() => {
    fetchExchanges();
  }, []);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchDeals();
    fetchSummary();
  };

  const hasActiveFilters =
    category !== 'all' ||
    action !== 'all' ||
    exchange !== 'all' ||
    search.trim() !== '' ||
    netBuyOnly ||
    datePreset !== 'all' ||
    startDate !== '' ||
    endDate !== '' ||
    sortOption !== 'date_desc';

  return (
    <div className="space-y-6">
      {/* Category Summary Header Cards */}
      {summary && summary.by_category && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {summary.by_category.map((cat, idx) => {
            const buyRatio = cat.count > 0 ? ((cat.buy_count / cat.count) * 100).toFixed(0) : 0;
            return (
              <div
                key={idx}
                onClick={() => {
                  setCategory(cat.deal_category === category ? 'all' : cat.deal_category);
                  setPage(1);
                }}
                className={`glass-panel p-5 rounded-2xl cursor-pointer transition-all duration-200 ${
                  category === cat.deal_category
                    ? 'border-cyan-500/50 bg-cyan-500/10 shadow-lg shadow-cyan-500/10'
                    : 'hover:-translate-y-1'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {cat.deal_category}
                  </div>
                  <div className="p-2 rounded-xl bg-slate-100 dark:bg-white/[0.04] text-cyan-600 dark:text-cyan-400 border border-slate-200 dark:border-white/[0.08]">
                    <Layers className="w-4 h-4" />
                  </div>
                </div>

                <div className="text-2xl font-black font-mono text-slate-900 dark:text-white mt-1">
                  {cat.count.toLocaleString()} <span className="text-xs text-slate-500 dark:text-slate-400 font-sans font-normal">Deals</span>
                </div>

                {/* Progress bar for buy vs sell ratio */}
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">{cat.buy_count} Buys ({buyRatio}%)</span>
                    <span className="text-rose-600 dark:text-rose-400 font-bold">{cat.sell_count} Sells</span>
                  </div>
                  <div className="w-full h-1.5 bg-rose-500/20 dark:bg-rose-500/30 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 dark:bg-emerald-400 rounded-full"
                      style={{ width: `${buyRatio}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Deals Table Panel */}
      <div className="glass-panel p-6 rounded-2xl relative">
        {/* Controls Header */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-white/[0.08] mb-5">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
                <Layers className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                Live Market Deals & Disclosures Repository
              </h2>
              {netBuyOnly && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  <TrendingUp className="w-3 h-3" /> Net Buy Mode
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Showing {deals.length} of {totalCount.toLocaleString()} indexed records in Market Repository
              {startDate && endDate ? ` • Range: ${startDate} to ${endDate}` : startDate ? ` • From: ${startDate}` : endDate ? ` • To: ${endDate}` : ''}
            </p>
          </div>

          {/* Filters Form */}
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            {/* Search */}
            <div className="relative flex-1 sm:w-52">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-400" />
              <input
                type="text"
                placeholder="Search security or promoter..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="glass-input w-full pl-8 py-1.5 text-xs"
              />
            </div>

            {/* Category Filter */}
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
              className="glass-input text-xs py-1.5 font-medium"
            >
              <option value="all">All Deal Types</option>
              <option value="Insider Trading">Insider Trading</option>
              <option value="SAST Deals">SAST Deals</option>
              <option value="Block Deals">Block Deals</option>
              <option value="Bulk Deals">Bulk Deals</option>
            </select>

            {/* Action Filter */}
            <select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setPage(1);
              }}
              className="glass-input text-xs py-1.5 font-medium"
            >
              <option value="all">BUY / SELL</option>
              <option value="BUY">BUY Only</option>
              <option value="SELL">SELL Only</option>
            </select>

            {/* Exchange Filter */}
            <select
              value={exchange}
              onChange={(e) => {
                setExchange(e.target.value);
                setPage(1);
              }}
              className="glass-input text-xs py-1.5 font-medium"
            >
              <option value="all">All Exchanges</option>
              {availableExchanges.map((ex) => (
                <option key={ex} value={ex}>{ex}</option>
              ))}
            </select>

            {/* Net Buy Only Toggle Button */}
            <label
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer select-none transition-all duration-200 border ${
                netBuyOnly
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-700 dark:text-emerald-400 shadow-sm shadow-emerald-500/10'
                  : 'glass-input text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-white/20'
              }`}
            >
              <input
                type="checkbox"
                checked={netBuyOnly}
                onChange={(e) => {
                  setNetBuyOnly(e.target.checked);
                  setPage(1);
                }}
                className="rounded border-slate-300 dark:border-slate-600 text-emerald-500 focus:ring-emerald-500 w-3.5 h-3.5"
              />
              <span>Net Buy Only</span>
            </label>

            {/* Date Range Dropdown */}
            <div className="relative">
              <select
                value={datePreset}
                onChange={(e) => handleDatePresetChange(e.target.value)}
                className="glass-input text-xs py-1.5 font-medium pr-7"
              >
                <option value="all">Date Range (All)</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="90d">Last 90 Days</option>
                <option value="custom">Custom Range...</option>
              </select>
            </div>

            {/* Sort Dropdown */}
            <select
              value={sortOption}
              onChange={(e) => {
                setSortOption(e.target.value);
                setPage(1);
              }}
              className="glass-input text-xs py-1.5 font-medium"
            >
              <option value="date_desc">Date: Newest → Oldest</option>
              <option value="date_asc">Date: Oldest → Newest</option>
              <option value="value_desc">Deal Value: High → Low</option>
              <option value="value_asc">Deal Value: Low → High</option>
            </select>

            {/* Filter Submit Button */}
            <button type="submit" className="btn-secondary text-xs py-1.5 px-3.5 font-medium">
              Filter
            </button>

            {/* Clear / Reset Filters */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1 text-slate-500 hover:text-rose-500 dark:text-slate-400 dark:hover:text-rose-400"
                title="Clear all filters"
              >
                <RotateCcw className="w-3 h-3" /> Clear
              </button>
            )}

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => {
                fetchDeals();
                fetchSummary();
              }}
              className="btn-secondary p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </form>
        </div>

        {/* Custom Date Range Picker Modal / Popover */}
        {showCustomDateModal && (
          <div className="mb-5 p-4 rounded-xl glass-panel border border-cyan-500/30 bg-slate-100/90 dark:bg-[#0c1322]/90 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Calendar className="w-4 h-4 text-cyan-500" />
              <span>Select Custom Date Range:</span>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-500">From:</label>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="glass-input text-xs py-1 px-2 font-mono"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-500">To:</label>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="glass-input text-xs py-1 px-2 font-mono"
              />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={applyCustomDateRange}
                className="btn-primary text-xs py-1 px-3.5"
              >
                Apply Range
              </button>
              <button
                type="button"
                onClick={clearCustomDateRange}
                className="btn-secondary text-xs py-1 px-2.5"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setShowCustomDateModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-white/[0.08]">
              <tr>
                <th className="py-3 px-3.5">ID</th>
                <th className="py-3 px-3.5">Trade Date</th>
                <th className="py-3 px-3.5">Deal Type</th>
                <th className="py-3 px-3.5">Security / Company</th>
                <th className="py-3 px-3.5">Promoter / Client</th>
                <th className="py-3 px-3.5">Action</th>
                <th className="py-3 px-3.5 text-right">Quantity</th>
                <th className="py-3 px-3.5 text-right">Price (₹)</th>
                <th className="py-3 px-3.5 text-right">Turnover</th>
                {netBuyOnly && (
                  <th className="py-3 px-3.5 text-right text-emerald-600 dark:text-emerald-400 bg-emerald-500/5">
                    Net Buy Value
                  </th>
                )}
                <th className="py-3 px-3.5">Execution Mode</th>
                <th className="py-3 px-3.5 text-right">1D</th>
                <th className="py-3 px-3.5 text-right">5D</th>
                <th className="py-3 px-3.5 text-right">20D</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
              {loading ? (
                <tr>
                  <td colSpan={netBuyOnly ? "14" : "13"} className="py-14 text-center text-slate-500 dark:text-slate-400 font-sans">
                    <div className="flex items-center justify-center gap-2.5">
                      <span className="w-4 h-4 border-2 border-cyan-500 dark:border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      Loading market transactions...
                    </div>
                  </td>
                </tr>
              ) : deals.length === 0 ? (
                <tr>
                  <td colSpan={netBuyOnly ? "14" : "13"} className="py-14 text-center text-slate-500 font-sans">
                    No transactions found matching your filters.
                  </td>
                </tr>
              ) : (
                deals.map((d) => (
                  <tr key={`${d.deal_category}-${d.id}`} className="hover:bg-slate-100/70 dark:hover:bg-white/[0.025] transition-colors">
                    <td className="py-3 px-3.5 text-slate-500 dark:text-slate-400 font-mono text-[11px]">#{d.id}</td>
                    <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300">{d.trade_date}</td>
                    <td className="py-3 px-3.5 font-sans">
                      <span className="badge-tag">{d.deal_category}</span>
                    </td>
                    <td className="py-3 px-3.5 font-sans">
                      <div className="flex items-center gap-1.5">
                        {d.symbol && (
                          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border border-cyan-500/25">
                            {d.symbol}
                          </span>
                        )}
                        <span className="font-bold text-slate-900 dark:text-white text-xs tracking-tight">{d.security_name}</span>
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">{d.exchange_name || 'NSE'}</div>
                    </td>
                    <td className="py-3 px-3.5 font-sans truncate max-w-[190px]" title={d.client_name}>
                      {d.client_name ? (
                        <button
                          onClick={() => setSelectedClient(d.client_name)}
                          className="text-slate-700 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 underline decoration-dotted underline-offset-2 transition-colors"
                        >
                          {d.client_name}
                        </button>
                      ) : (
                        'N/A'
                      )}
                    </td>
                    <td className="py-3 px-3.5 font-sans">
                      <span className={d.action === 'BUY' ? 'badge-buy' : 'badge-sell'}>
                        {d.action}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-right text-slate-800 dark:text-slate-200">
                      {d.quantity ? Number(d.quantity).toLocaleString() : '-'}
                    </td>
                    <td className="py-3 px-3.5 text-right text-slate-800 dark:text-slate-200">
                      {d.price ? `₹${Number(d.price).toFixed(2)}` : '-'}
                    </td>
                    <td className="py-3 px-3.5 text-right text-cyan-700 dark:text-cyan-300 font-bold">
                      {d.total_value
                        ? `₹${(Number(d.total_value) >= 10000000
                            ? (Number(d.total_value) / 10000000).toFixed(2) + ' Cr'
                            : (Number(d.total_value) / 100000).toFixed(2) + ' L')}`
                        : '-'}
                    </td>
                    {netBuyOnly && (
                      <td className="py-3 px-3.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/5">
                        {d.net_buy_value !== null && d.net_buy_value !== undefined
                          ? `+₹${(Number(d.net_buy_value) >= 10000000
                              ? (Number(d.net_buy_value) / 10000000).toFixed(2) + ' Cr'
                              : (Number(d.net_buy_value) / 100000).toFixed(2) + ' L')}`
                          : '—'}
                      </td>
                    )}
                    <td className="py-3 px-3.5 font-sans text-slate-600 dark:text-slate-400 text-[11px] truncate max-w-[130px]">
                      {d.mode_description || '-'}
                    </td>
                    <td className="py-3 px-3.5 text-right"><ReactionCell value={d.price_reaction?.['1d']} /></td>
                    <td className="py-3 px-3.5 text-right"><ReactionCell value={d.price_reaction?.['5d']} /></td>
                    <td className="py-3 px-3.5 text-right"><ReactionCell value={d.price_reaction?.['20d']} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-white/[0.08] mt-4 text-xs">
            <div className="text-slate-500 dark:text-slate-400 font-mono">
              Page <span className="text-slate-900 dark:text-white font-bold">{page}</span> of {totalPages} ({totalCount.toLocaleString()} total)
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(p - 1, 1))}
                className="btn-secondary py-1.5 px-3 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                className="btn-secondary py-1.5 px-3 disabled:opacity-30"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedClient && (
        <ClientDrilldownModal clientName={selectedClient} onClose={() => setSelectedClient(null)} />
      )}
    </div>
  );
}


