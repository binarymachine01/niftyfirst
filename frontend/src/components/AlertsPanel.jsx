import React, { useState, useEffect, useCallback } from 'react';
import { Bell, Plus, Trash2, CheckCheck, ChevronDown, ChevronUp, BellRing, RefreshCw } from 'lucide-react';
import { api } from '../services/api';

const CATEGORIES = ['Insider Trading', 'SAST Deals', 'Block Deals', 'Bulk Deals'];

function formatValue(v) {
  const n = Number(v || 0);
  if (n === 0) return '-';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function AlertsPanel({ onMatchesRefreshed }) {
  const [filters, setFilters] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [form, setForm] = useState({ name: '', category: '', action: '', min_value_lakhs: 0, keyword: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [filtersRes, matchesRes] = await Promise.all([api.getSavedFilters(), api.getAlertMatches()]);
      setFilters(filtersRes.filters || []);
      setResults(matchesRes.results || []);
      if (onMatchesRefreshed) onMatchesRefreshed(matchesRes.total_new_alerts || 0);
    } catch (err) {
      console.error('Failed to load alerts:', err);
      setError('Failed to load saved filters and matches.');
    } finally {
      setLoading(false);
    }
  }, [onMatchesRefreshed]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      await api.createSavedFilter({
        name: form.name.trim(),
        category: form.category || null,
        action: form.action || null,
        min_value_lakhs: Number(form.min_value_lakhs) || 0,
        keyword: form.keyword.trim() || null,
      });
      setForm({ name: '', category: '', action: '', min_value_lakhs: 0, keyword: '' });
      await refresh();
    } catch (err) {
      console.error('Failed to create filter:', err);
      setError('Failed to create saved filter.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.deleteSavedFilter(id);
      await refresh();
    } catch (err) {
      console.error('Failed to delete filter:', err);
    }
  };

  const handleAcknowledge = async (id) => {
    try {
      await api.acknowledgeFilter(id);
      await refresh();
    } catch (err) {
      console.error('Failed to acknowledge filter:', err);
    }
  };

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const totalNewAlerts = results.reduce((sum, r) => sum + (r.new_since_last_check || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
              <Bell className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              Saved Filters & Deal Alerts
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Save a deal pattern once and get flagged whenever a new matching disclosure lands
              {totalNewAlerts > 0 && (
                <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 font-bold">
                  <BellRing className="w-3 h-3" /> {totalNewAlerts} new
                </span>
              )}
            </p>
          </div>
          <button onClick={refresh} className="btn-secondary p-2" title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && (
          <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-medium">
            {error}
          </div>
        )}

        {/* Create Filter Form */}
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2.5 pt-2">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 mb-1">Filter Name</label>
            <input
              type="text"
              required
              placeholder="e.g. Big Promoter Buys"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="glass-input w-full py-1.5 text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 mb-1">Category</label>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="glass-input text-xs py-1.5 font-medium"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 mb-1">Action</label>
            <select
              value={form.action}
              onChange={(e) => setForm({ ...form, action: e.target.value })}
              className="glass-input text-xs py-1.5 font-medium"
            >
              <option value="">Any</option>
              <option value="BUY">BUY Only</option>
              <option value="SELL">SELL Only</option>
            </select>
          </div>
          <div className="w-28">
            <label className="block text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 mb-1">Min ₹ Lakhs</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.min_value_lakhs}
              onChange={(e) => setForm({ ...form, min_value_lakhs: e.target.value })}
              className="glass-input w-full py-1.5 text-xs"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 mb-1">Keyword</label>
            <input
              type="text"
              placeholder="security or client name..."
              value={form.keyword}
              onChange={(e) => setForm({ ...form, keyword: e.target.value })}
              className="glass-input w-full py-1.5 text-xs"
            />
          </div>
          <button type="submit" disabled={creating} className="btn-primary text-xs py-2 px-4 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Save Filter
          </button>
        </form>
      </div>

      {/* Saved Filters List */}
      {results.length === 0 ? (
        <div className="glass-panel p-10 rounded-2xl text-center text-xs text-slate-500 dark:text-slate-400">
          No saved filters yet. Create one above to start tracking deals that match your criteria.
        </div>
      ) : (
        <div className="space-y-4">
          {results.map((r) => {
            const f = r.filter;
            const isOpen = !!expanded[f.id];
            return (
              <div key={f.id} className="glass-panel p-5 rounded-2xl">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl border ${r.new_since_last_check > 0 ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400' : 'bg-slate-100 dark:bg-white/[0.04] border-slate-200 dark:border-white/[0.08] text-cyan-600 dark:text-cyan-400'}`}>
                      {r.new_since_last_check > 0 ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="text-sm font-extrabold text-slate-900 dark:text-white">{f.name}</div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px]">
                        <span className="badge-tag">{f.category || 'All Categories'}</span>
                        {f.action && <span className={f.action === 'BUY' ? 'badge-buy' : 'badge-sell'}>{f.action}</span>}
                        {f.min_value_lakhs > 0 && <span className="badge-tag">Min ₹{f.min_value_lakhs}L</span>}
                        {f.keyword && <span className="badge-tag">"{f.keyword}"</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-lg font-black font-mono text-slate-900 dark:text-white">{r.total_matching}</div>
                      <div className="text-[10px] uppercase text-slate-500 dark:text-slate-400 tracking-wider">Matching</div>
                    </div>
                    {r.new_since_last_check > 0 && (
                      <div className="text-right">
                        <div className="text-lg font-black font-mono text-rose-600 dark:text-rose-400">{r.new_since_last_check}</div>
                        <div className="text-[10px] uppercase text-slate-500 dark:text-slate-400 tracking-wider">New</div>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      {r.new_since_last_check > 0 && (
                        <button onClick={() => handleAcknowledge(f.id)} className="btn-secondary p-2" title="Mark as read">
                          <CheckCheck className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => toggleExpand(f.id)} className="btn-secondary p-2" title="Toggle matches">
                        {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      <button onClick={() => handleDelete(f.id)} className="btn-secondary p-2 text-rose-600 dark:text-rose-400" title="Delete filter">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-white/[0.08] overflow-x-auto rounded-xl">
                    {r.matches.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">No matching deals yet.</p>
                    ) : (
                      <table className="w-full text-left text-xs border-collapse">
                        <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                          <tr>
                            <th className="py-2 px-3">Date</th>
                            <th className="py-2 px-3">Category</th>
                            <th className="py-2 px-3">Security</th>
                            <th className="py-2 px-3">Client</th>
                            <th className="py-2 px-3">Action</th>
                            <th className="py-2 px-3 text-right">Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
                          {r.matches.map((m) => (
                            <tr key={`${m.deal_category}-${m.id}`} className={m.is_new ? 'bg-rose-500/5' : ''}>
                              <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                                {m.is_new && <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-500 mr-1.5 align-middle" />}
                                {m.trade_date}
                              </td>
                              <td className="py-2 px-3 font-sans"><span className="badge-tag">{m.deal_category}</span></td>
                              <td className="py-2 px-3 font-sans text-slate-800 dark:text-slate-200">{m.security_name}</td>
                              <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-400 truncate max-w-[150px]">{m.client_name || 'N/A'}</td>
                              <td className="py-2 px-3 font-sans"><span className={m.action === 'BUY' ? 'badge-buy' : 'badge-sell'}>{m.action}</span></td>
                              <td className="py-2 px-3 text-right text-cyan-700 dark:text-cyan-300 font-bold">{formatValue(m.total_value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
