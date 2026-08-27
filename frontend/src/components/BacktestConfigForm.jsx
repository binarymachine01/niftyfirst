import React, { useEffect, useState } from 'react';
import { Play, Sparkles, Sliders, ShieldAlert, Target, Clock, Wallet, CheckSquare, Square, TrendingUp, ChevronDown, ChevronUp, Zap, HelpCircle } from 'lucide-react';
import { api } from '../services/api';

const ALL_CATEGORIES = [
  { name: 'Insider Trading', desc: 'Promoter & Key Executive Disclosures', color: 'text-emerald-500 dark:text-emerald-400', badge: 'SEBI PIT' },
  { name: 'SAST Deals', desc: 'Substantial Acquisition & Takeovers', color: 'text-purple-500 dark:text-purple-400', badge: 'Takeovers' },
  { name: 'Block Deals', desc: 'Institutional Exchange Block Window', color: 'text-amber-500 dark:text-amber-400', badge: 'Min ₹10Cr' },
  { name: 'Bulk Deals', desc: 'Large Market Trades (>0.5% Equity)', color: 'text-cyan-600 dark:text-cyan-400', badge: 'High Volume' },
];

export default function BacktestConfigForm({ config, setConfig, onRunBacktest, loading }) {
  const [presets, setPresets] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    api.getPresetStrategies().then((res) => {
      if (res?.presets) setPresets(res.presets);
    }).catch((err) => console.error(err));
  }, []);

  const handleCategoryToggle = (categoryName) => {
    const current = config.categories || [];
    if (current.includes(categoryName)) {
      if (current.length > 1) {
        setConfig({ ...config, categories: current.filter((c) => c !== categoryName) });
      }
    } else {
      setConfig({ ...config, categories: [...current, categoryName] });
    }
  };

  const applyPreset = (preset) => {
    setConfig({
      ...config,
      ...preset.config,
    });
  };

  return (
    <div className="glass-panel p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-white/[0.08]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/25 shadow-sm shadow-cyan-500/10">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white tracking-tight">Strategy Builder</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Configure quantitative parameters & filters</p>
          </div>
        </div>

        {/* Preset Strategies Quick Dropdown */}
        {presets.length > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-700 dark:text-amber-300 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
            <select
              onChange={(e) => {
                const found = presets.find((p) => p.id === e.target.value);
                if (found) applyPreset(found);
              }}
              defaultValue=""
              className="bg-transparent border-none text-amber-800 dark:text-amber-200 font-semibold text-xs outline-none cursor-pointer"
            >
              <option value="" disabled className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300">Strategy Templates...</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200">
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onRunBacktest();
        }}
        className="space-y-5"
      >
        {/* Deal Categories Cards */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2.5">
            Signal Deal Types ({config.categories?.length || 0} Active)
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {ALL_CATEGORIES.map((cat) => {
              const checked = config.categories?.includes(cat.name);
              return (
                <button
                  type="button"
                  key={cat.name}
                  onClick={() => handleCategoryToggle(cat.name)}
                  className={`flex items-center justify-between p-3 rounded-xl text-left border transition-all duration-200 ${
                    checked
                      ? 'bg-gradient-to-r from-cyan-500/15 to-blue-500/10 text-slate-900 dark:text-white border-cyan-500/40 shadow-sm'
                      : 'bg-slate-100/70 dark:bg-slate-900/50 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/[0.06] hover:border-slate-300 dark:hover:border-white/20 hover:text-slate-900 dark:hover:text-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {checked ? (
                      <CheckSquare className="w-4 h-4 text-cyan-600 dark:text-cyan-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-400 dark:text-slate-600 flex-shrink-0" />
                    )}
                    <div className="truncate">
                      <div className="text-xs font-bold truncate text-slate-900 dark:text-white">{cat.name}</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-500 truncate">{cat.desc}</div>
                    </div>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border flex-shrink-0 ml-2 ${
                    checked ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/30' : 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-500 border-slate-300/60 dark:border-white/5'
                  }`}>
                    {cat.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Segmented Control */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
            Trade Direction
          </label>
          <div className="grid grid-cols-3 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-950/70 border border-slate-200 dark:border-white/[0.08]">
            {[
              { id: 'BUY', label: 'BUY Only', desc: 'Long Conviction' },
              { id: 'SELL', label: 'SELL Only', desc: 'Short / Exit' },
              { id: 'ALL', label: 'BOTH (All)', desc: 'Long & Short' },
            ].map((act) => {
              const active = config.action === act.id;
              return (
                <button
                  type="button"
                  key={act.id}
                  onClick={() => setConfig({ ...config, action: act.id })}
                  className={`py-2 px-3 rounded-lg text-center transition-all ${
                    active
                      ? act.id === 'BUY'
                        ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 font-bold shadow-sm'
                        : act.id === 'SELL'
                        ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/40 font-bold shadow-sm'
                        : 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 font-bold shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 border border-transparent text-xs font-medium'
                  }`}
                >
                  <div className="text-xs">{act.label}</div>
                  <div className="text-[10px] opacity-75 font-mono">{act.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Holding Window with Quick Presets */}
        <div className="p-4 rounded-xl bg-slate-100/70 dark:bg-slate-900/60 border border-slate-200 dark:border-white/[0.06] space-y-3">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              <Clock className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> Holding Window
            </label>
            <div className="flex items-center gap-1">
              <span className="text-lg font-black font-mono text-cyan-700 dark:text-cyan-400">{config.holding_days}</span>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Trading Days</span>
            </div>
          </div>

          <input
            type="range"
            min="1"
            max="120"
            step="1"
            value={config.holding_days}
            onChange={(e) => setConfig({ ...config, holding_days: parseInt(e.target.value) })}
            className="w-full h-2 bg-slate-200 dark:bg-slate-950 rounded-lg appearance-none cursor-pointer accent-cyan-500"
          />

          {/* Quick Buttons */}
          <div className="flex items-center justify-between gap-1.5 pt-1">
            {[
              { days: 5, label: '5D (1W)' },
              { days: 10, label: '10D (2W)' },
              { days: 20, label: '20D (1M)' },
              { days: 45, label: '45D' },
              { days: 60, label: '60D (3M)' },
              { days: 90, label: '90D' },
            ].map((p) => (
              <button
                type="button"
                key={p.days}
                onClick={() => setConfig({ ...config, holding_days: p.days })}
                className={`flex-1 py-1 text-[11px] font-mono rounded-md border transition-all ${
                  config.holding_days === p.days
                    ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40 font-bold'
                    : 'bg-white dark:bg-slate-950/60 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/15'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Collapsible Advanced Risk Management */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center justify-between w-full py-2 px-3 rounded-lg bg-slate-100 dark:bg-slate-900/40 hover:bg-slate-200/70 dark:hover:bg-slate-900 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 border border-slate-200 dark:border-white/5 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
              Advanced Risk & Capital Sizing
            </span>
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>

          {showAdvanced && (
            <div className="mt-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-white/[0.08] space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" /> Stop Loss (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    placeholder="e.g. 5.0"
                    value={config.stop_loss_pct ?? ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        stop_loss_pct: e.target.value === '' ? null : parseFloat(e.target.value),
                      })
                    }
                    className="glass-input w-full font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    <Target className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" /> Take Profit (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="500"
                    step="1"
                    placeholder="e.g. 20.0"
                    value={config.take_profit_pct ?? ''}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        take_profit_pct: e.target.value === '' ? null : parseFloat(e.target.value),
                      })
                    }
                    className="glass-input w-full font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    <Wallet className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400" /> Min Value (₹ Lakhs)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    placeholder="0 (All)"
                    value={config.min_value_lakhs}
                    onChange={(e) => setConfig({ ...config, min_value_lakhs: parseFloat(e.target.value) || 0 })}
                    className="glass-input w-full font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    Position Allocation (%)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={config.position_size_pct}
                    onChange={(e) => setConfig({ ...config, position_size_pct: parseFloat(e.target.value) || 10 })}
                    className="glass-input w-full font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Submit Run Button */}
        <button
          type="submit"
          disabled={loading}
          className="btn-primary w-full py-3.5 text-sm uppercase tracking-wider disabled:opacity-50 font-bold"
        >
          {loading ? (
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-white dark:border-slate-950 border-t-transparent rounded-full animate-spin" />
              Simulating Historical Trades...
            </div>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Run Quantitative Simulation
            </>
          )}
        </button>
      </form>
    </div>
  );
}

