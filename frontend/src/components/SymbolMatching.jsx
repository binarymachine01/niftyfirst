import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert, ShieldQuestion, Search, RefreshCw, CheckCircle2, XCircle, Link2, History, X, ChevronDown, ChevronUp,
} from 'lucide-react';
import { api } from '../services/api';

const STATUS_STYLES = {
  MATCHED: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  LOW_CONFIDENCE: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  UNMATCHED: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
  MANUAL_OVERRIDE: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-black tracking-wide ${STATUS_STYLES[status] || STATUS_STYLES.UNMATCHED}`}>
      {status?.replace('_', ' ') || 'N/A'}
    </span>
  );
}

function formatValue(v) {
  if (v === null || v === undefined) return 'N/A';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 10000000) return `₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `₹${(abs / 100000).toFixed(2)} L`;
  return `₹${abs.toLocaleString('en-IN')}`;
}

function MapModal({ item, onClose, onSaved }) {
  const [candidates, setCandidates] = useState(item.candidates || []);
  const [selectedSymbol, setSelectedSymbol] = useState(item.resolved_nse_symbol || '');
  const [customSymbol, setCustomSymbol] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!item.candidates || item.candidates.length === 0) {
      api.getMatchCandidates(item.original_security_name).then((res) => setCandidates(res.candidates || [])).catch(() => {});
    }
  }, [item]);

  const handleSave = async () => {
    const symbol = (customSymbol || selectedSymbol || '').trim().toUpperCase();
    if (!symbol) {
      setError('Select a candidate or enter an NSE symbol.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createSymbolMapping({ original_security_name: item.original_security_name, resolved_nse_symbol: symbol });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save mapping.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/50 dark:bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="glass-panel relative w-full max-w-lg rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white">Map Security to NSE Symbol</h3>
          <button onClick={onClose} className="btn-secondary p-2"><X className="w-4 h-4" /></button>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mb-4">{item.original_security_name}</div>

        {error && <div className="p-3 mb-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{error}</div>}

        {candidates.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-2">Candidates</div>
            <div className="space-y-1.5">
              {candidates.map((c, i) => (
                <label key={i} className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 dark:border-white/10 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/5">
                  <span className="flex items-center gap-2 text-xs">
                    <input type="radio" name="candidate" checked={selectedSymbol === c.symbol && !customSymbol} onChange={() => { setSelectedSymbol(c.symbol); setCustomSymbol(''); }} />
                    <span className="font-mono font-bold">{c.symbol}</span>
                    <span className="text-slate-400 text-[10px]">{c.method}</span>
                  </span>
                  <span className="font-mono text-xs font-bold">{(c.confidence * 100).toFixed(0)}%</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1.5 block">Or enter NSE symbol manually</label>
          <input
            type="text"
            placeholder="e.g. RELIANCE"
            value={customSymbol}
            onChange={(e) => setCustomSymbol(e.target.value.toUpperCase())}
            className="glass-input w-full py-2 text-xs font-mono font-bold uppercase"
          />
        </div>

        <div className="flex items-center gap-2.5">
          <button onClick={handleSave} disabled={saving} className="btn-primary text-xs py-2 px-4 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save as Manual Override'}
          </button>
          <button onClick={onClose} className="btn-secondary text-xs py-2 px-4">Cancel</button>
        </div>
      </div>
    </div>
  );
}

export default function SymbolMatching() {
  const [activeTab, setActiveTab] = useState('unmatched');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mappingTarget, setMappingTarget] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [history, setHistory] = useState({});

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let res;
      if (activeTab === 'unmatched') res = await api.getUnmatchedSecurities(search);
      else if (activeTab === 'low_confidence') res = await api.getLowConfidenceSecurities(search);
      else res = await api.getAllMappings({ search: search || undefined, status: activeTab === 'all' ? undefined : activeTab.toUpperCase() });
      setRows(res.unmatched || res.low_confidence || res.mappings || []);
    } catch (err) {
      console.error('Failed to load symbol mappings:', err);
      setError('Failed to load symbol mapping data.');
    } finally {
      setLoading(false);
    }
  }, [activeTab, search]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleRemoveOverride = async (mappingId) => {
    try {
      await api.removeSymbolMapping(mappingId);
      fetchRows();
    } catch (err) {
      console.error('Failed to remove override:', err);
    }
  };

  const toggleHistory = async (row) => {
    if (expandedRow === row.mapping_id) {
      setExpandedRow(null);
      return;
    }
    setExpandedRow(row.mapping_id);
    if (!history[row.mapping_id]) {
      try {
        const res = await api.getMappingHistory(row.mapping_id);
        setHistory((prev) => ({ ...prev, [row.mapping_id]: res.history || [] }));
      } catch (err) {
        console.error('Failed to load history:', err);
      }
    }
  };

  const tabs = [
    { id: 'unmatched', label: 'Unmatched', icon: XCircle },
    { id: 'low_confidence', label: 'Low Confidence', icon: ShieldQuestion },
    { id: 'manual_override', label: 'Manual Overrides', icon: Link2 },
    { id: 'matched', label: 'Matched', icon: CheckCircle2 },
    { id: 'all', label: 'All', icon: Search },
  ];

  return (
    <div className="space-y-6">
      <div className="glass-panel p-6 rounded-2xl">
        <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
          <ShieldAlert className="w-5 h-5 text-cyan-600 dark:text-cyan-400" /> Symbol Matching
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Review and manage how insider/deal security names resolve to NSE symbols. Only MATCHED and MANUAL_OVERRIDE
          mappings are used for backtesting, Conviction scoring, screening, and Stock Intelligence.
        </p>
      </div>

      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-950/70 border border-slate-200 dark:border-white/[0.08] text-xs flex-wrap">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${activeTab === t.id ? 'bg-white dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-slate-300 dark:border-cyan-500/40' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
                >
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search security or symbol..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="glass-input w-full pl-8 py-1.5 text-xs"
              />
            </div>
            <button onClick={fetchRows} className="btn-secondary p-2"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          </div>
        </div>

        {error && <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">{error}</div>}

        {loading ? (
          <div className="py-14 text-center text-xs text-slate-500 dark:text-slate-400">
            <span className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin inline-block mr-2 align-middle" /> Loading...
          </div>
        ) : rows.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-14 text-center">No securities in this view.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Security Name</th>
                  <th className="py-2.5 px-3">Candidate Symbol</th>
                  <th className="py-2.5 px-3 text-right">Confidence</th>
                  <th className="py-2.5 px-3">Method</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Deals</th>
                  <th className="py-2.5 px-3">Latest Deal</th>
                  <th className="py-2.5 px-3 text-right">Total Value</th>
                  <th className="py-2.5 px-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
                {rows.map((r) => (
                  <React.Fragment key={r.mapping_id}>
                    <tr className="hover:bg-slate-100/70 dark:hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-sans font-bold text-slate-900 dark:text-white max-w-[220px] truncate" title={r.original_security_name}>{r.original_security_name}</td>
                      <td className="py-2.5 px-3 font-bold">{r.resolved_nse_symbol || 'N/A'}</td>
                      <td className="py-2.5 px-3 text-right">{(r.match_confidence * 100).toFixed(0)}%</td>
                      <td className="py-2.5 px-3 font-sans"><span className="badge-tag">{r.match_method}</span></td>
                      <td className="py-2.5 px-3 font-sans"><StatusBadge status={r.match_status} /></td>
                      <td className="py-2.5 px-3 text-right">{r.deal_count}</td>
                      <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{r.latest_deal_date || 'N/A'}</td>
                      <td className="py-2.5 px-3 text-right text-cyan-700 dark:text-cyan-300 font-bold">{formatValue(r.total_transaction_value)}</td>
                      <td className="py-2.5 px-3 font-sans">
                        <div className="flex items-center gap-1.5 justify-end">
                          {r.match_status !== 'MANUAL_OVERRIDE' && (
                            <button onClick={() => setMappingTarget(r)} className="btn-secondary py-1 px-2 text-[10px]">Map</button>
                          )}
                          {r.match_status === 'MANUAL_OVERRIDE' && (
                            <button onClick={() => handleRemoveOverride(r.mapping_id)} className="btn-secondary py-1 px-2 text-[10px] text-rose-600 dark:text-rose-400">Remove</button>
                          )}
                          <button onClick={() => toggleHistory(r)} className="btn-secondary p-1.5" title="History">
                            {expandedRow === r.mapping_id ? <ChevronUp className="w-3 h-3" /> : <History className="w-3 h-3" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedRow === r.mapping_id && (
                      <tr className="bg-slate-50 dark:bg-white/[0.02]">
                        <td colSpan={9} className="py-3 px-4 font-sans">
                          {!history[r.mapping_id] || history[r.mapping_id].length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">No audit history for this mapping.</p>
                          ) : (
                            <ul className="space-y-1.5 text-[11px]">
                              {history[r.mapping_id].map((h, i) => (
                                <li key={i} className="text-slate-600 dark:text-slate-400">
                                  <span className="font-mono text-slate-400">{h.changed_at}</span> — {h.previous_symbol || 'N/A'} → <span className="font-bold text-slate-800 dark:text-slate-200">{h.new_symbol || 'REMOVED'}</span>
                                  {' '}({h.previous_status || 'N/A'} → {h.new_status}) {h.changed_by ? `by ${h.changed_by}` : ''} {h.reason ? `— ${h.reason}` : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {mappingTarget && (
        <MapModal
          item={mappingTarget}
          onClose={() => setMappingTarget(null)}
          onSaved={() => { setMappingTarget(null); fetchRows(); }}
        />
      )}
    </div>
  );
}
