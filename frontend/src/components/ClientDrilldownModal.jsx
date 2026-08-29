import React, { useState, useEffect } from 'react';
import { X, User, TrendingUp, TrendingDown, Wallet, Layers } from 'lucide-react';
import { api } from '../services/api';

function formatValue(v) {
  const n = Number(v || 0);
  if (n === 0) return '₹0';
  const abs = Math.abs(n);
  if (abs >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function ClientDrilldownModal({ clientName, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!clientName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    api
      .getClientDeals(clientName)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.detail || 'Failed to load client history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientName]);

  if (!clientName) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/50 dark:bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="glass-panel relative w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 pb-4 mb-5 border-b border-slate-200 dark:border-white/[0.08]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20">
              <User className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight">
                {clientName}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Client / Promoter Transaction History
              </p>
            </div>
          </div>
          <button onClick={onClose} className="btn-secondary p-2" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading && (
          <div className="py-16 flex items-center justify-center gap-2.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="w-4 h-4 border-2 border-cyan-500 dark:border-cyan-400 border-t-transparent rounded-full animate-spin" />
            Loading client history...
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-medium">
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-6">
            {/* Summary Stat Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="metric-card glass-panel p-4 rounded-xl">
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Total Deals</div>
                <div className="text-xl font-black font-mono text-slate-900 dark:text-white">{data.summary.total_deals}</div>
              </div>
              <div className="metric-card glass-panel p-4 rounded-xl">
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Securities</div>
                <div className="text-xl font-black font-mono text-slate-900 dark:text-white">{data.summary.distinct_securities}</div>
              </div>
              <div className="metric-card glass-panel p-4 rounded-xl">
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3 text-emerald-500" /> Buy Value
                </div>
                <div className="text-lg font-black font-mono text-emerald-600 dark:text-emerald-400">{formatValue(data.summary.total_buy_value)}</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">{data.summary.buy_count} deals</div>
              </div>
              <div className="metric-card glass-panel p-4 rounded-xl">
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3 text-rose-500" /> Sell Value
                </div>
                <div className="text-lg font-black font-mono text-rose-600 dark:text-rose-400">{formatValue(data.summary.total_sell_value)}</div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">{data.summary.sell_count} deals</div>
              </div>
            </div>

            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-950/60 border border-slate-200 dark:border-white/[0.08] text-xs">
              <Wallet className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
              <span className="font-semibold text-slate-700 dark:text-slate-300">Net Position:</span>
              <span className={`font-mono font-bold ${data.summary.net_value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {data.summary.net_value >= 0 ? '+' : ''}{formatValue(data.summary.net_value)}
              </span>
              <span className="text-slate-400 dark:text-slate-600">|</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {data.by_category.map((c) => (
                  <span key={c.deal_category} className="badge-tag">{c.deal_category} ({c.count})</span>
                ))}
              </div>
            </div>

            {/* By Security Breakdown */}
            <div>
              <h3 className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" /> Breakdown by Security
              </h3>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3.5">Security</th>
                      <th className="py-2.5 px-3.5 text-right">Deals</th>
                      <th className="py-2.5 px-3.5 text-right">Net Qty</th>
                      <th className="py-2.5 px-3.5 text-right">Net Value</th>
                      <th className="py-2.5 px-3.5">Last Deal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
                    {data.by_security.map((s) => (
                      <tr key={s.security_name} className="hover:bg-slate-100/70 dark:hover:bg-white/[0.02]">
                        <td className="py-2.5 px-3.5 font-sans font-bold text-slate-900 dark:text-white">{s.security_name}</td>
                        <td className="py-2.5 px-3.5 text-right">{s.deal_count}</td>
                        <td className={`py-2.5 px-3.5 text-right font-bold ${s.net_qty >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {Number(s.net_qty).toLocaleString()}
                        </td>
                        <td className={`py-2.5 px-3.5 text-right font-bold ${s.net_value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {formatValue(s.net_value)}
                        </td>
                        <td className="py-2.5 px-3.5 text-slate-600 dark:text-slate-400">{s.last_deal_date}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Full Deal History */}
            <div>
              <h3 className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wider mb-2.5">
                Full Transaction History ({data.deals.length})
              </h3>
              <div className="overflow-x-auto max-h-72 rounded-xl border border-slate-200 dark:border-white/[0.06]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3.5">Date</th>
                      <th className="py-2.5 px-3.5">Category</th>
                      <th className="py-2.5 px-3.5">Security</th>
                      <th className="py-2.5 px-3.5">Action</th>
                      <th className="py-2.5 px-3.5 text-right">Quantity</th>
                      <th className="py-2.5 px-3.5 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
                    {data.deals.map((d) => (
                      <tr key={`${d.deal_category}-${d.id}`} className="hover:bg-slate-100/70 dark:hover:bg-white/[0.02]">
                        <td className="py-2.5 px-3.5 text-slate-700 dark:text-slate-300">{d.trade_date}</td>
                        <td className="py-2.5 px-3.5 font-sans"><span className="badge-tag">{d.deal_category}</span></td>
                        <td className="py-2.5 px-3.5 font-sans text-slate-800 dark:text-slate-200">{d.security_name}</td>
                        <td className="py-2.5 px-3.5 font-sans">
                          <span className={d.action === 'BUY' ? 'badge-buy' : 'badge-sell'}>{d.action}</span>
                        </td>
                        <td className="py-2.5 px-3.5 text-right">{d.quantity ? Number(d.quantity).toLocaleString() : '-'}</td>
                        <td className="py-2.5 px-3.5 text-right text-cyan-700 dark:text-cyan-300 font-bold">
                          {d.total_value ? formatValue(d.total_value) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
