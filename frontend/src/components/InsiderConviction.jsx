import React, { useState, useEffect } from 'react';
import {
  Gauge, Search, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle,
  Info, ChevronRight, RefreshCw, ShieldCheck, ShieldAlert, ShieldQuestion,
} from 'lucide-react';
import { api } from '../services/api';

function formatValue(v) {
  if (v === null || v === undefined) return '-';
  const n = Number(v);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

function ConfidenceBadge({ tier }) {
  const styles = {
    HIGH: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    MEDIUM: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    LOW: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
  };
  const icons = { HIGH: ShieldCheck, MEDIUM: ShieldQuestion, LOW: ShieldAlert };
  const Icon = icons[tier] || ShieldQuestion;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold ${styles[tier] || styles.LOW}`}>
      <Icon className="w-3.5 h-3.5" /> {tier} CONFIDENCE
    </span>
  );
}

function ScoreGauge({ score }) {
  if (score === null || score === undefined) {
    return <div className="text-3xl font-black text-slate-400 dark:text-slate-600">N/A</div>;
  }
  const color = score >= 70 ? 'text-emerald-500 dark:text-emerald-400' : score >= 40 ? 'text-amber-500 dark:text-amber-400' : 'text-rose-500 dark:text-rose-400';
  return (
    <div className={`text-4xl font-black font-mono ${color}`}>
      {score.toFixed(0)}<span className="text-lg text-slate-400 dark:text-slate-500">/100</span>
    </div>
  );
}

export default function InsiderConviction({ initialSymbol = null }) {
  const [ranking, setRanking] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(false);

  const [symbolInput, setSymbolInput] = useState(initialSymbol || '');
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [scoreDetail, setScoreDetail] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const fetchRanking = async () => {
    setRankingLoading(true);
    try {
      const res = await api.getConvictionRanking({ limit: 25 });
      setRanking(res.ranking || []);
    } catch (err) {
      console.error('Failed to load conviction ranking:', err);
    } finally {
      setRankingLoading(false);
    }
  };

  useEffect(() => {
    fetchRanking();
  }, []);

  // Deep-link support: when arriving from the Smart Screener with a
  // pre-selected symbol, auto-run the inspection instead of duplicating
  // stock-detail UI in the screener itself.
  useEffect(() => {
    if (initialSymbol) {
      setSymbolInput(initialSymbol);
      inspectSymbol(initialSymbol);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSymbol]);

  const inspectSymbol = async (symbol) => {
    if (!symbol) return;
    const sym = symbol.trim().toUpperCase();
    setSelectedSymbol(sym);
    setDetailLoading(true);
    setDetailError(null);
    setScoreDetail(null);
    setExplanation(null);
    try {
      const [scoreRes, explRes] = await Promise.all([
        api.getConvictionScore(sym),
        api.getConvictionExplanation(sym),
      ]);
      setScoreDetail(scoreRes);
      setExplanation(explRes);
    } catch (err) {
      console.error('Failed to load conviction score:', err);
      setDetailError(err.response?.data?.detail || `Could not compute an Insider Conviction Score for '${sym}'.`);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    inspectSymbol(symbolInput);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
              <Gauge className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              Insider Conviction Engine
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-2xl">
              A transparent 0-100 score reflecting the strength of observable insider conviction based on
              available transaction and market evidence. Not a guaranteed return or prediction.
            </p>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2.5 w-full sm:w-auto">
            <input
              type="text"
              placeholder="e.g. HINDUNILVR, INFY..."
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              className="glass-input font-mono font-bold text-xs uppercase w-48 tracking-wider"
            />
            <button type="submit" className="btn-primary text-xs py-2 px-4.5">
              Score It
            </button>
          </form>
        </div>
      </div>

      {/* Ranking Table */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight">
            Top Conviction Ranking (Active Insider Activity, Last 180 Days)
          </h3>
          <button onClick={fetchRanking} className="btn-secondary p-2" title="Refresh">
            <RefreshCw className={`w-3.5 h-3.5 ${rankingLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {ranking.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
            {rankingLoading ? 'Computing conviction scores...' : 'No symbols with qualifying insider activity found in the current window.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-2.5 px-3.5">Rank</th>
                  <th className="py-2.5 px-3.5">Symbol</th>
                  <th className="py-2.5 px-3.5 text-right">Score</th>
                  <th className="py-2.5 px-3.5">Confidence</th>
                  <th className="py-2.5 px-3.5 text-right">Net Buying</th>
                  <th className="py-2.5 px-3.5">Data Coverage</th>
                  <th className="py-2.5 px-3.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
                {ranking.map((r) => (
                  <tr
                    key={r.symbol}
                    onClick={() => inspectSymbol(r.symbol)}
                    className={`cursor-pointer hover:bg-slate-100/70 dark:hover:bg-white/[0.025] transition-colors ${selectedSymbol === r.symbol ? 'bg-cyan-500/5' : ''}`}
                  >
                    <td className="py-2.5 px-3.5 text-slate-500 dark:text-slate-400">#{r.rank}</td>
                    <td className="py-2.5 px-3.5 font-bold text-slate-900 dark:text-white">{r.symbol}</td>
                    <td className="py-2.5 px-3.5 text-right font-bold">
                      <span className={r.overall_score >= 70 ? 'text-emerald-600 dark:text-emerald-400' : r.overall_score >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'}>
                        {r.overall_score?.toFixed(0)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 font-sans">
                      <ConfidenceBadge tier={r.confidence} />
                    </td>
                    <td className={`py-2.5 px-3.5 text-right font-bold ${(r.net_buying_value || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {r.net_buying_value !== null ? formatValue(r.net_buying_value) : '-'}
                    </td>
                    <td className="py-2.5 px-3.5 text-slate-600 dark:text-slate-400 font-sans">
                      {r.components_available}/{r.components_total} components
                    </td>
                    <td className="py-2.5 px-3.5 text-right">
                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 inline-block" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail Panel */}
      {detailLoading && (
        <div className="glass-panel p-10 rounded-2xl text-center text-xs text-slate-500 dark:text-slate-400">
          <span className="w-4 h-4 border-2 border-cyan-500 dark:border-cyan-400 border-t-transparent rounded-full animate-spin inline-block mr-2 align-middle" />
          Computing Insider Conviction Score for {selectedSymbol}...
        </div>
      )}

      {detailError && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2 font-medium">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {detailError}
        </div>
      )}

      {scoreDetail && explanation && !detailLoading && (
        <div className="space-y-6">
          {/* Score Header */}
          <div className="glass-panel p-6 rounded-2xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 mb-4 border-b border-slate-200 dark:border-white/[0.08]">
              <div className="flex items-center gap-5">
                <ScoreGauge score={scoreDetail.overall_score} />
                <div>
                  <div className="text-lg font-black text-slate-900 dark:text-white">{scoreDetail.symbol}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{explanation.components_summary}</div>
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                    Model {scoreDetail.model_version} · As of {scoreDetail.as_of_date}
                  </div>
                </div>
              </div>
              <ConfidenceBadge tier={scoreDetail.confidence.tier} />
            </div>

            {/* Component Breakdown */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="py-2.5 px-3.5">Component</th>
                    <th className="py-2.5 px-3.5 text-right">Score</th>
                    <th className="py-2.5 px-3.5 text-right">Configured Weight</th>
                    <th className="py-2.5 px-3.5 text-right">Normalized Weight</th>
                    <th className="py-2.5 px-3.5 text-right">Weighted Contribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
                  {Object.entries(scoreDetail.components).map(([key, c]) => (
                    <tr key={key} className={!c.available ? 'opacity-50' : ''}>
                      <td className="py-2.5 px-3.5 font-sans font-bold text-slate-900 dark:text-white">{c.label}</td>
                      <td className="py-2.5 px-3.5 text-right">{c.available ? c.score.toFixed(0) : 'N/A'}</td>
                      <td className="py-2.5 px-3.5 text-right text-slate-500 dark:text-slate-400">{c.configured_weight_pct.toFixed(0)}%</td>
                      <td className="py-2.5 px-3.5 text-right text-slate-500 dark:text-slate-400">{c.available ? `${c.normalized_weight_pct.toFixed(1)}%` : '-'}</td>
                      <td className="py-2.5 px-3.5 text-right font-bold text-cyan-700 dark:text-cyan-300">
                        {c.available ? `${c.score.toFixed(0)} × ${c.normalized_weight_pct.toFixed(1)}% = ${c.weighted_contribution.toFixed(1)}` : 'Unavailable'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Why This Score */}
          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight mb-4 flex items-center gap-2">
              <Info className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> Why This Stock Scored {scoreDetail.overall_score?.toFixed(0) ?? 'N/A'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">Positive Factors</div>
                {explanation.positive.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">No positive contributors identified.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {explanation.positive.map((p, i) => (
                      <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />
                        {p}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-2">Negative / Missing-Data Factors</div>
                {explanation.negative.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">No negative factors or missing-data flags.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {explanation.negative.map((n, i) => (
                      <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="mt-5 pt-4 border-t border-slate-200 dark:border-white/[0.08] text-[11px] text-slate-500 dark:text-slate-400 font-mono">
              {explanation.confidence_summary}
            </div>
          </div>

          {/* Supporting Transactions */}
          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight mb-4">
              Supporting Transactions ({scoreDetail.supporting_transactions.length})
            </h3>
            {scoreDetail.supporting_transactions.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">No transactions in the current lookback window.</p>
            ) : (
              <div className="overflow-x-auto max-h-80 rounded-xl border border-slate-200 dark:border-white/[0.06]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3.5">Date</th>
                      <th className="py-2.5 px-3.5">Category</th>
                      <th className="py-2.5 px-3.5">Insider / Client</th>
                      <th className="py-2.5 px-3.5">Role</th>
                      <th className="py-2.5 px-3.5">Action</th>
                      <th className="py-2.5 px-3.5 text-right">Quantity</th>
                      <th className="py-2.5 px-3.5 text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
                    {scoreDetail.supporting_transactions.map((t) => (
                      <tr key={`${t.deal_category}-${t.id}`} className="hover:bg-slate-100/70 dark:hover:bg-white/[0.02]">
                        <td className="py-2.5 px-3.5 text-slate-700 dark:text-slate-300">{t.trade_date}</td>
                        <td className="py-2.5 px-3.5 font-sans"><span className="badge-tag">{t.deal_category}</span></td>
                        <td className="py-2.5 px-3.5 font-sans text-slate-800 dark:text-slate-200 truncate max-w-[160px]" title={t.client_name}>{t.client_name || 'N/A'}</td>
                        <td className="py-2.5 px-3.5 font-sans text-slate-500 dark:text-slate-400">{t.role || 'Unavailable'}</td>
                        <td className="py-2.5 px-3.5 font-sans">
                          <span className={t.action === 'BUY' ? 'badge-buy' : 'badge-sell'}>{t.action}</span>
                        </td>
                        <td className="py-2.5 px-3.5 text-right">{t.quantity ? Number(t.quantity).toLocaleString() : '-'}</td>
                        <td className="py-2.5 px-3.5 text-right text-cyan-700 dark:text-cyan-300 font-bold">
                          {t.total_value ? formatValue(t.total_value) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-[10px] text-slate-400 dark:text-slate-600 italic px-2">{explanation.disclaimer}</p>
        </div>
      )}
    </div>
  );
}
