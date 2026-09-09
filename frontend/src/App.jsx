import React, { useState, useEffect } from 'react';
import TopHeader from '@/components/layout/TopHeader';
import AppSidebar from '@/components/layout/AppSidebar';
import Dashboard from '@/components/Dashboard';
import DateRangeBacktester from '@/components/DateRangeBacktester';
import BacktestConfigForm from '@/components/BacktestConfigForm';
import MetricCards from '@/components/MetricCards';
import EquityCurveChart from '@/components/EquityCurveChart';
import DrawdownChart from '@/components/DrawdownChart';
import TradeLogTable from '@/components/TradeLogTable';
import DealsExplorer from '@/components/DealsExplorer';
import StockInspector from '@/components/StockInspector';
import SystemStatus from '@/components/SystemStatus';
import InsiderConviction from '@/components/InsiderConviction';
import SmartScreener from '@/components/SmartScreener';
import SymbolMatching from '@/components/SymbolMatching';
import AlertsPanel from '@/components/AlertsPanel';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Zap, TrendingUp } from 'lucide-react';
import { api } from '@/services/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [backtestMode, setBacktestMode] = useState('date_range'); // 'date_range' | 'portfolio'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [systemStatus, setSystemStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [convictionDeepLink, setConvictionDeepLink] = useState(null);
  const [alertsCount, setAlertsCount] = useState(0);

  // Deep-linking helper for Stock Inspector / Screener to Conviction Engine
  const handleInspectSymbol = (symbol) => {
    setConvictionDeepLink(symbol);
    setActiveTab('conviction');
  };

  // Theme management: 'dark' | 'light' (Dark preferred in quant finance)
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
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans transition-colors duration-200">
      {/* Top Application Header */}
      <TopHeader
        systemStatus={systemStatus}
        alertsCount={alertsCount}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenMobileMenu={() => setMobileMenuOpen(true)}
        onNavigateTab={setActiveTab}
        activeTab={activeTab}
      />

      {/* Main Workspace: Sidebar + Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Institutional Collapsible Sidebar */}
        <AppSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
          mobileOpen={mobileMenuOpen}
          onMobileOpenChange={setMobileMenuOpen}
          alertsCount={alertsCount}
        />

        {/* Content Container */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
          {/* Tab 0: Executive Dashboard */}
          {activeTab === 'dashboard' && (
            <Dashboard onNavigateTab={setActiveTab} systemStatus={systemStatus} />
          )}

          {/* Tab 1: Quantitative Backtest Lab */}
          {activeTab === 'backtest' && (
            <div className="space-y-6">
              {/* Backtest Mode Selector */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-border/80">
                <div className="flex items-center gap-1.5 p-1 rounded-lg bg-muted border border-border/60">
                  <Button
                    size="sm"
                    variant={backtestMode === 'date_range' ? 'default' : 'ghost'}
                    onClick={() => setBacktestMode('date_range')}
                    className="gap-1.5 text-xs font-semibold"
                  >
                    <Zap className="w-3.5 h-3.5" />
                    Full Deal Signals (Date Range)
                  </Button>
                  <Button
                    size="sm"
                    variant={backtestMode === 'portfolio' ? 'default' : 'ghost'}
                    onClick={() => setBacktestMode('portfolio')}
                    className="gap-1.5 text-xs font-semibold"
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    Portfolio Strategy Simulator
                  </Button>
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {backtestMode === 'date_range'
                    ? '1D · 5D · 10D · 20D · 60D forward returns across historical deals'
                    : 'Fixed capital simulation, equity curves & trade logs'}
                </div>
              </div>

              {/* Date Range Full Deal Backtest */}
              {backtestMode === 'date_range' && <DateRangeBacktester />}

              {/* Portfolio Simulator Backtest */}
              {backtestMode === 'portfolio' && (
                <div className="space-y-6">
                  {error && (
                    <Alert variant="destructive">
                      <AlertTriangle className="w-4 h-4" />
                      <AlertTitle>Simulation Error</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  {/* Symbol Mapping Warning */}
                  {results?.symbol_mapping_audit &&
                    (results.symbol_mapping_audit.excluded_low_confidence > 0 ||
                      results.symbol_mapping_audit.excluded_unmatched > 0) && (
                      <Alert variant="warning">
                        <AlertTriangle className="w-4 h-4" />
                        <AlertTitle>
                          Symbol Governance Exclusion —{' '}
                          {results.symbol_mapping_audit.excluded_low_confidence +
                            results.symbol_mapping_audit.excluded_unmatched}{' '}
                          of {results.symbol_mapping_audit.total_transactions} transactions unresolved
                        </AlertTitle>
                        <AlertDescription className="font-mono text-[11px]">
                          {results.symbol_mapping_audit.excluded_low_confidence} LOW_CONFIDENCE ·{' '}
                          {results.symbol_mapping_audit.excluded_unmatched} UNMATCHED — excluded from returns calculation
                        </AlertDescription>
                      </Alert>
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
      </div>

      {/* Global Notifications Toaster */}
      <Toaster position="bottom-right" richColors />
    </div>
  );
}
