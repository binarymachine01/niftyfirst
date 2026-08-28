import React from 'react';
import { Activity, BarChart3, Layers, Search, Sparkles, Zap, ShieldCheck, ShieldAlert, Sun, Moon, Gauge, SlidersHorizontal } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, systemStatus, theme, toggleTheme }) {
  const tabs = [
    { id: 'backtest', label: 'Backtesting Lab', icon: BarChart3, badge: 'Strategy' },
    { id: 'screener', label: 'Smart Screener', icon: SlidersHorizontal, badge: 'Discover' },
    { id: 'deals', label: 'Deals Explorer', icon: Layers, badge: 'Live Feeds' },
    { id: 'stocks', label: 'Stock Inspector', icon: Search, badge: 'OHLC' },
    { id: 'conviction', label: 'Insider Conviction', icon: Gauge, badge: 'Scoring' },
    { id: 'symbol-matching', label: 'Symbol Matching', icon: ShieldAlert, badge: 'Governance' },
    { id: 'system', label: 'System Health', icon: Activity, badge: 'Pipelines' },
  ];

  const isHealthy = systemStatus?.status === 'healthy';
  const eodCount = systemStatus?.database?.eod_rows;

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 dark:border-white/[0.08] bg-white/80 dark:bg-[#070a12]/80 backdrop-blur-2xl transition-colors duration-200 shadow-sm dark:shadow-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3.5">
          <div className="relative">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-cyan-400 via-sky-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/25 border border-white/40 dark:border-white/20">
              <Zap className="w-6 h-6 text-white dark:text-slate-950 fill-white dark:fill-slate-950" />
            </div>
            <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyan-500 border-2 border-white dark:border-[#070a12]"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xl font-black tracking-tight text-slate-900 dark:text-white">
                NIFTY<span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-500 to-blue-600 dark:from-cyan-400 dark:to-blue-400">FIRST</span>
              </span>
              <span className="text-[10px] uppercase font-extrabold tracking-widest px-2 py-0.5 rounded-md bg-cyan-500/10 dark:bg-gradient-to-r dark:from-cyan-500/20 dark:to-blue-500/20 text-cyan-700 dark:text-cyan-300 border border-cyan-500/30">
                QUANT TERMINAL
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Insider Trading & Institutional Deals Backtesting Engine</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-slate-100 dark:bg-slate-950/70 border border-slate-200 dark:border-white/[0.08] shadow-inner">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 ${
                  isActive
                    ? 'bg-white dark:bg-gradient-to-r dark:from-cyan-500/20 dark:via-blue-500/15 dark:to-transparent text-cyan-700 dark:text-cyan-300 border border-cyan-500/40 dark:border-cyan-400/40 shadow-md shadow-cyan-500/10'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/60 dark:hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-600 dark:text-cyan-400' : 'text-slate-500 dark:text-slate-400'}`} />
                <span>{tab.label}</span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 dark:bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Status & Theme Controls */}
        <div className="flex items-center gap-3">
          {/* Data Health status */}
          <div className="hidden lg:flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-slate-100/90 dark:bg-slate-950/60 border border-slate-200 dark:border-white/[0.08] text-xs">
            <div className={`w-2.5 h-2.5 rounded-full ${isHealthy ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]' : 'bg-amber-400'}`} />
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider">Data Health</div>
              <div className="font-mono text-slate-800 dark:text-slate-200 font-bold">
                {eodCount ? `${(eodCount / 1000).toFixed(0)}k Market Records` : 'Online'}
              </div>
            </div>
          </div>

          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="p-2.5 rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-100 hover:bg-slate-200 dark:bg-slate-900/80 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 transition-all duration-200 shadow-sm flex items-center justify-center group"
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-300 group-hover:rotate-45 transition-transform duration-300" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700 group-hover:-rotate-12 transition-transform duration-300" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

