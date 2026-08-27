import React, { useState, useMemo } from 'react';
import { Search, ArrowUpRight, ArrowDownRight, Download, Filter, ArrowUpDown, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

export default function TradeLogTable({ trades }) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL'); // ALL, WIN, LOSS, SL, TP
  const [sortField, setSortField] = useState('entry_date');
  const [sortAsc, setSortAsc] = useState(false);

  if (!trades || trades.length === 0) return null;

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const filteredTrades = useMemo(() => {
    let result = trades.filter((t) => {
      const matchesSearch =
        t.symbol.toLowerCase().includes(search.toLowerCase()) ||
        t.security_name.toLowerCase().includes(search.toLowerCase()) ||
        (t.client_name && t.client_name.toLowerCase().includes(search.toLowerCase())) ||
        t.deal_category.toLowerCase().includes(search.toLowerCase());

      if (!matchesSearch) return false;

      if (activeFilter === 'WIN') return t.pnl_pct > 0;
      if (activeFilter === 'LOSS') return t.pnl_pct < 0;
      if (activeFilter === 'SL') return t.exit_reason === 'Stop Loss';
      if (activeFilter === 'TP') return t.exit_reason === 'Take Profit';
      return true;
    });

    result.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string') {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
    });

    return result;
  }, [trades, search, activeFilter, sortField, sortAsc]);

  const exportCSV = () => {
    const headers = [
      'Symbol',
      'Security Name',
      'Category',
      'Client Name',
      'Action',
      'Deal Date',
      'Entry Date',
      'Entry Price',
      'Exit Date',
      'Exit Price',
      'PnL (%)',
      'PnL (INR)',
      'Holding Days',
      'Exit Reason',
    ];
    const rows = filteredTrades.map((t) => [
      t.symbol,
      `"${t.security_name}"`,
      `"${t.deal_category}"`,
      `"${t.client_name || ''}"`,
      t.action,
      t.deal_date,
      t.entry_date,
      t.entry_price,
      t.exit_date,
      t.exit_price,
      t.pnl_pct,
      t.pnl_amount || 0,
      t.holding_days,
      t.exit_reason,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `niftyfirst_backtest_trades_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="glass-panel p-6 mt-6 rounded-2xl">
      {/* Header & Filter Controls */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-white/[0.08] mb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight">
              Trade Execution Log
            </h3>
            <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border border-cyan-500/25">
              {filteredTrades.length} of {trades.length} Deals
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Chronological trade performance breakdown</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
          {/* Quick Filter Tabs */}
          <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-950/70 border border-slate-200 dark:border-white/[0.08] text-xs">
            {[
              { id: 'ALL', label: 'All' },
              { id: 'WIN', label: 'Wins' },
              { id: 'LOSS', label: 'Losses' },
              { id: 'TP', label: 'TP Hits' },
              { id: 'SL', label: 'SL Hits' },
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
                  activeFilter === f.id
                    ? 'bg-white dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-slate-300 dark:border-cyan-500/40 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-transparent'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-400" />
            <input
              type="text"
              placeholder="Search ticker, promoter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="glass-input w-full pl-8 py-1.5 text-xs"
            />
          </div>

          {/* Export CSV Button */}
          <button onClick={exportCSV} className="btn-secondary text-xs py-2 px-3">
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-[420px] rounded-xl border border-slate-200 dark:border-white/[0.06]">
        <table className="w-full text-left text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider border-b border-slate-200 dark:border-white/[0.08]">
            <tr>
              <th className="py-3 px-3.5 cursor-pointer select-none" onClick={() => handleSort('symbol')}>
                <div className="flex items-center gap-1">
                  Ticker / Security <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-3.5">Category</th>
              <th className="py-3 px-3.5">Client / Promoter</th>
              <th className="py-3 px-3.5">Action</th>
              <th className="py-3 px-3.5 cursor-pointer select-none" onClick={() => handleSort('entry_date')}>
                <div className="flex items-center gap-1">
                  Entry Date <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-3.5">Exit Date</th>
              <th className="py-3 px-3.5 cursor-pointer select-none text-center" onClick={() => handleSort('holding_days')}>
                <div className="flex items-center justify-center gap-1">
                  Days <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-3.5 cursor-pointer select-none text-right" onClick={() => handleSort('pnl_pct')}>
                <div className="flex items-center justify-end gap-1">
                  Return (%) <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-3.5 cursor-pointer select-none text-right" onClick={() => handleSort('pnl_amount')}>
                <div className="flex items-center justify-end gap-1">
                  Simulated PnL (₹) <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-3.5">Exit Trigger</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
            {filteredTrades.map((t, idx) => {
              const isWin = t.pnl_pct > 0;
              return (
                <tr key={idx} className="hover:bg-slate-100/70 dark:hover:bg-white/[0.025] transition-colors">
                  <td className="py-3 px-3.5">
                    <div className="font-bold text-slate-900 dark:text-white text-xs tracking-tight">{t.symbol}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-sans truncate max-w-[170px]">
                      {t.security_name}
                    </div>
                  </td>
                  <td className="py-3 px-3.5 font-sans">
                    <span className="badge-tag">{t.deal_category}</span>
                  </td>
                  <td className="py-3 px-3.5 font-sans text-slate-700 dark:text-slate-300 truncate max-w-[150px]" title={t.client_name}>
                    {t.client_name || 'N/A'}
                  </td>
                  <td className="py-3 px-3.5 font-sans">
                    <span className={t.action === 'BUY' ? 'badge-buy' : 'badge-sell'}>
                      {t.action}
                    </span>
                  </td>
                  <td className="py-3 px-3.5">
                    <div className="text-slate-800 dark:text-slate-200">₹{t.entry_price.toFixed(2)}</div>
                    <div className="text-[10px] text-slate-500">{t.entry_date}</div>
                  </td>
                  <td className="py-3 px-3.5">
                    <div className="text-slate-800 dark:text-slate-200">₹{t.exit_price.toFixed(2)}</div>
                    <div className="text-[10px] text-slate-500">{t.exit_date}</div>
                  </td>
                  <td className="py-3 px-3.5 text-center text-slate-700 dark:text-slate-300 font-bold">
                    {t.holding_days}d
                  </td>
                  <td className="py-3 px-3.5 text-right font-bold text-xs">
                    <span
                      className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md ${
                        isWin ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {isWin ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      {isWin ? '+' : ''}
                      {t.pnl_pct.toFixed(2)}%
                    </span>
                  </td>
                  <td className="py-3 px-3.5 text-right">
                    <span className={`font-bold ${isWin ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {t.pnl_amount ? `${t.pnl_amount > 0 ? '+' : ''}₹${t.pnl_amount.toLocaleString('en-IN')}` : '-'}
                    </span>
                  </td>
                  <td className="py-3 px-3.5 font-sans text-slate-600 dark:text-slate-400 text-[11px]">
                    <span className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${
                      t.exit_reason === 'Take Profit'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                        : t.exit_reason === 'Stop Loss'
                        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border-slate-300 dark:border-white/5'
                    }`}>
                      {t.exit_reason}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

