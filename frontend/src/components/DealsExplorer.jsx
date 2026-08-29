import React, { useState, useEffect } from 'react';
import { Search, Filter, Layers, ChevronLeft, ChevronRight, RefreshCw, ArrowUpRight, ArrowDownRight, ExternalLink, Calendar, Building } from 'lucide-react';
import { api } from '../services/api';

export default function DealsExplorer() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState('all');
  const [action, setAction] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState(null);

  const fetchDeals = async () => {
    setLoading(true);
    try {
      const res = await api.getDeals({
        category: category !== 'all' ? category : undefined,
        action: action !== 'all' ? action : undefined,
        search: search.trim() || undefined,
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
      const res = await api.getDealsSummary();
      setSummary(res);
    } catch (err) {
      console.error('Failed to fetch summary:', err);
    }
  };

  useEffect(() => {
    fetchDeals();
  }, [category, action, page]);

  useEffect(() => {
    fetchSummary();
  }, []);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchDeals();
  };

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
                  setCategory(cat.deal_category);
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
      <div className="glass-panel p-6 rounded-2xl">
        {/* Controls */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-white/[0.08] mb-5">
          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
              <Layers className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              Live Market Deals & Disclosures Repository
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Showing {deals.length} of {totalCount.toLocaleString()} indexed records in Market Repository
            </p>
          </div>

          {/* Filters Form */}
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            {/* Search */}
            <div className="relative flex-1 md:w-60">
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
              <option value="all">All Categories</option>
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
              <option value="all">All Actions</option>
              <option value="BUY">BUY Only</option>
              <option value="SELL">SELL Only</option>
            </select>

            <button type="submit" className="btn-secondary text-xs py-1.5 px-3.5">
              Filter
            </button>

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
                <th className="py-3 px-3.5">Execution Mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
              {loading ? (
                <tr>
                  <td colSpan="10" className="py-14 text-center text-slate-500 dark:text-slate-400 font-sans">
                    <div className="flex items-center justify-center gap-2.5">
                      <span className="w-4 h-4 border-2 border-cyan-500 dark:border-cyan-400 border-t-transparent rounded-full animate-spin" />
                      Loading market transactions...
                    </div>
                  </td>
                </tr>
              ) : deals.length === 0 ? (
                <tr>
                  <td colSpan="10" className="py-14 text-center text-slate-500 font-sans">
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
                    <td className="py-3 px-3.5 font-sans text-slate-700 dark:text-slate-300 truncate max-w-[190px]" title={d.client_name}>
                      {d.client_name || 'N/A'}
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
                    <td className="py-3 px-3.5 font-sans text-slate-600 dark:text-slate-400 text-[11px] truncate max-w-[130px]">
                      {d.mode_description || '-'}
                    </td>
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
              Page <span className="text-slate-900 dark:text-white font-bold">{page}</span> of {totalPages} ({totalCount} total)
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
    </div>
  );
}

