import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import BacktestConfigForm from './components/BacktestConfigForm';
import MetricCards from './components/MetricCards';
import EquityCurveChart from './components/EquityCurveChart';
import DrawdownChart from './components/DrawdownChart';
import TradeLogTable from './components/TradeLogTable';
import DealsExplorer from './components/DealsExplorer';
import StockInspector from './components/StockInspector';
import SystemStatus from './components/SystemStatus';
import InsiderConviction from './components/InsiderConviction';
import SmartScreener from './components/SmartScreener';
import SymbolMatching from './components/SymbolMatching';
import AlertsPanel from './components/AlertsPanel';
import { api } from './services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('backtest');
  const [systemStatus, setSystemStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [convictionDeepLink, setConvictionDeepLink] = useState(null);
  const [alertsCount, setAlertsCount] = useState(0);

  // Reused by the Smart Screener so a clicked stock opens the EXISTING
  // Insider Conviction view instead of a duplicate stock-detail page.
  const handleInspectSymbol = (symbol) => {
    setConvictionDeepLink(symbol);
    setActiveTab('conviction');
  };

  // Theme management: 'dark' | 'light'
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('niftyfirst_theme');
    if (saved) return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
    localStorage.setItem('niftyfirst_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const [config, setConfig] = useState({
    holding_days: 20,
    categories: ['Insider Trading', 'SAST Deals', 'Block Deals', 'Bulk Deals'],
    action: 'BUY',
    min_value_lakhs: 0,
    stop_loss_pct: null,
    take_profit_pct: null,
    initial_capital: 1000000,
    position_size_pct: 10,
  });

  const fetchStatus = async () => {
    try {
      const res = await api.getSystemStatus();
      setSystemStatus(res);
    } catch (err) {
      console.error('Failed to load system status:', err);
    }
  };

  const fetchAlertsBadge = async () => {
    try {
      const res = await api.getAlertMatches();
      setAlertsCount(res?.total_new_alerts || 0);
    } catch (err) {
      console.error('Failed to load alert matches:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchAlertsBadge();
  }, []);

  const handleRunBacktest = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.runBacktest(config);
      if (res.status === 'success') {
        setResults(res.data);
      } else {
        setError('Backtest completed with error');
      }
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Failed to execute backtest');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#080d1a] text-slate-800 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
      {/* Header & Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        systemStatus={systemStatus}
        alertsCount={alertsCount}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
        {/* Tab 1: Quantitative Backtest Lab */}
        {activeTab === 'backtest' && (
          <div className="space-y-6">
            {error && (
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-medium">
                {error}
              </div>
            )}

            {/* Symbol Mapping Warning */}
            {results?.symbol_mapping_audit && (results.symbol_mapping_audit.excluded_low_confidence > 0 || results.symbol_mapping_audit.excluded_unmatched > 0) && (
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs">
                <div className="font-bold text-amber-700 dark:text-amber-400 mb-1">
                  ⚠ SYMBOL MAPPING WARNING — {results.symbol_mapping_audit.excluded_low_confidence + results.symbol_mapping_audit.excluded_unmatched} of {results.symbol_mapping_audit.total_transactions} transactions have unresolved symbols
                </div>
                <div className="text-amber-700/80 dark:text-amber-400/80 font-mono text-[11px]">
                  {results.symbol_mapping_audit.excluded_low_confidence} LOW_CONFIDENCE · {results.symbol_mapping_audit.excluded_unmatched} UNMATCHED — excluded from this backtest (never silently used)
                </div>
              </div>
            )}

            {/* Top Metric Cards */}
            {results && <MetricCards summary={results.summary} />}

            {/* Backtest Strategy Controls & Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-4">
                <BacktestConfigForm
                  config={config}
                  setConfig={setConfig}
                  onRunBacktest={handleRunBacktest}
                  loading={loading}
                />
              </div>

              <div className="lg:col-span-8 space-y-6">
                <EquityCurveChart data={results?.equity_curve} theme={theme} />
                {results?.equity_curve && results.equity_curve.length > 0 && (
                  <DrawdownChart data={results.equity_curve} theme={theme} />
                )}
              </div>
            </div>

            {/* Trade Log Execution Table */}
            {results?.trades && <TradeLogTable trades={results.trades} />}
          </div>
        )}

        {/* Tab 2: Smart Screener */}
        {activeTab === 'screener' && <SmartScreener onInspectSymbol={handleInspectSymbol} />}

        {/* Tab 3: Deals Explorer */}
        {activeTab === 'deals' && <DealsExplorer />}

        {/* Tab 4: Stock Inspector / Intelligence */}
        {activeTab === 'stocks' && <StockInspector theme={theme} />}

        {/* Tab 5: Insider Conviction Engine */}
        {activeTab === 'conviction' && <InsiderConviction initialSymbol={convictionDeepLink} />}

        {/* Tab 6: Alerts & Saved Filters */}
        {activeTab === 'alerts' && <AlertsPanel onMatchesRefreshed={setAlertsCount} />}

        {/* Tab 7: Symbol Matching Governance */}
        {activeTab === 'symbol-matching' && <SymbolMatching />}

        {/* Tab 8: System Health & Data Pipelines */}
        {activeTab === 'system' && (
          <SystemStatus systemStatus={systemStatus} onRefreshStatus={fetchStatus} />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-white/5 py-6 text-center text-xs text-slate-500 dark:text-slate-500 font-mono transition-colors">
        NiftyFirst Quantitative Market Data & Backtesting Suite
      </footer>
    </div>
  );
}

