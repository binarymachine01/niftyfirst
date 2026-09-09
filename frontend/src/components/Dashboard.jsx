import React, { useState, useEffect } from 'react';
import PageHeader from '@/components/common/PageHeader';
import MetricCard from '@/components/common/MetricCard';
import LoadingState from '@/components/common/LoadingState';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Layers,
  BarChart3,
  SlidersHorizontal,
  ShieldCheck,
  Zap,
  TrendingUp,
  Activity,
  ArrowRight,
  Database,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { api } from '@/services/api';
import { formatCrores, formatINR } from '@/lib/utils';

export default function Dashboard({ onNavigateTab, systemStatus }) {
  const [dealsSummary, setDealsSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const loadData = async () => {
      try {
        setLoading(true);
        const data = await api.getDealsSummary();
        if (mounted) setDealsSummary(data);
      } catch (err) {
        console.error('Failed to load dashboard deals summary:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    loadData();
    return () => {
      mounted = false;
    };
  }, []);

  const getCategoryStats = (categoryName) => {
    if (!dealsSummary?.by_category) return { count: 0, value: 0 };
    const found = dealsSummary.by_category.find((c) => c.category === categoryName);
    return {
      count: found?.count || 0,
      value: found?.total_value || 0,
    };
  };

  const bulkStats = getCategoryStats('Bulk Deals');
  const blockStats = getCategoryStats('Block Deals');
  const insiderStats = getCategoryStats('Insider Trading');
  const sastStats = getCategoryStats('SAST Deals');

  const totalDealsCount =
    (bulkStats.count || 0) +
    (blockStats.count || 0) +
    (insiderStats.count || 0) +
    (sastStats.count || 0);

  const totalMarketValue =
    (bulkStats.value || 0) +
    (blockStats.value || 0) +
    (insiderStats.value || 0) +
    (sastStats.value || 0);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Market & Quantitative Overview"
        description="Comprehensive intelligence across institutional market deals, insider accumulation, and signal engines."
        badge="NiftyFirst Terminal"
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigateTab('deals')}
              className="gap-1.5"
            >
              <Layers className="w-3.5 h-3.5" />
              Deals Explorer
            </Button>
            <Button
              size="sm"
              onClick={() => onNavigateTab('backtest')}
              className="gap-1.5"
            >
              <Zap className="w-3.5 h-3.5" />
              Launch Backtest
            </Button>
          </div>
        }
      />

      {/* Top Level Metric Cards */}
      {loading ? (
        <LoadingState mode="cards" cards={4} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Bulk Deals"
            value={bulkStats.count.toLocaleString()}
            subtitle={formatCrores(bulkStats.value)}
            icon={Layers}
            variant="default"
          />
          <MetricCard
            title="Block Deals"
            value={blockStats.count.toLocaleString()}
            subtitle={formatCrores(blockStats.value)}
            icon={BarChart3}
            variant="default"
          />
          <MetricCard
            title="Insider Trading"
            value={insiderStats.count.toLocaleString()}
            subtitle={formatCrores(insiderStats.value)}
            icon={TrendingUp}
            variant="positive"
          />
          <MetricCard
            title="SAST Acquisitions"
            value={sastStats.count.toLocaleString()}
            subtitle={formatCrores(sastStats.value)}
            icon={ShieldCheck}
            variant="default"
          />
        </div>
      )}

      {/* Main Grid: Analytical Modules */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Platform Strategy Highlights & Quick Actions */}
        <div className="lg:col-span-7 space-y-6">
          {/* Quick Quantitative Strategy Launchpad */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Quantitative Strategy Launchpad
                </CardTitle>
                <Badge variant="outline" className="text-[10px] font-mono">
                  v2.0 Engines
                </Badge>
              </div>
              <CardDescription>
                Execute validated quantitative signal models across historical market disclosures.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div
                onClick={() => onNavigateTab('backtest')}
                className="group p-3.5 rounded-lg border border-border/80 bg-muted/20 hover:bg-muted/50 hover:border-primary/40 transition-all cursor-pointer flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                      Full Deal Date-Range Backtesting
                    </span>
                    <Badge variant="positive" className="text-[9px] px-1.5 py-0">
                      Consolidated
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Evaluates multi-horizon returns (1D, 5D, 10D, 20D, 60D) with automated deal aggregation.
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-1" />
              </div>

              <div
                onClick={() => onNavigateTab('screener')}
                className="group p-3.5 rounded-lg border border-border/80 bg-muted/20 hover:bg-muted/50 hover:border-primary/40 transition-all cursor-pointer flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                      Smart Stock Screener
                    </span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                      Multi-Factor
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Filters securities by promoter buying, repeat buyers, delivery volume spikes, and technical DMA.
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-1" />
              </div>

              <div
                onClick={() => onNavigateTab('conviction')}
                className="group p-3.5 rounded-lg border border-border/80 bg-muted/20 hover:bg-muted/50 hover:border-primary/40 transition-all cursor-pointer flex items-center justify-between"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">
                      Insider Conviction Scoring
                    </span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                      0-100 Score
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Transparent sub-scores evaluating insider volume, accumulation pattern, and price follow-through.
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-transform group-hover:translate-x-1" />
              </div>
            </CardContent>
          </Card>

          {/* Deal Category Distribution */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Layers className="w-4 h-4 text-muted-foreground" />
                Disclosures Distribution
              </CardTitle>
              <CardDescription>
                Summary of total transactions and capital flow captured in the local data warehouse.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  { name: 'Bulk Deals', stats: bulkStats, color: 'bg-blue-500' },
                  { name: 'Block Deals', stats: blockStats, color: 'bg-sky-500' },
                  { name: 'Insider Trading', stats: insiderStats, color: 'bg-emerald-500' },
                  { name: 'SAST Acquisitions', stats: sastStats, color: 'bg-amber-500' },
                ].map((item) => {
                  const pct = totalDealsCount > 0 ? (item.stats.count / totalDealsCount) * 100 : 0;
                  return (
                    <div key={item.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-foreground">{item.name}</span>
                        <span className="font-mono text-muted-foreground">
                          {item.stats.count.toLocaleString()} deals ({pct.toFixed(1)}%) · {formatCrores(item.stats.value)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full ${item.color} rounded-full transition-all duration-500`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Platform Health & Operational Posture */}
        <div className="lg:col-span-5 space-y-6">
          {/* Platform Health Status */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-emerald-500" />
                  Platform Health
                </CardTitle>
                <Badge
                  variant={systemStatus?.status === 'healthy' ? 'positive' : 'warning'}
                  className="text-[10px]"
                >
                  {systemStatus?.status === 'healthy' ? 'ALL SYSTEMS OPERATIONAL' : 'DEGRADED'}
                </Badge>
              </div>
              <CardDescription>
                Infrastructure connections, EOD candle feeds, and database integrity.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 font-mono text-xs">
              <div className="flex items-center justify-between p-2.5 rounded-md bg-muted/30 border border-border/60">
                <span className="text-muted-foreground font-sans">NSE Symbol Master</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">1,940+ NSE ACTIVE</span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-md bg-muted/30 border border-border/60">
                <span className="text-muted-foreground font-sans">Historical EOD Price Candles</span>
                <span className="font-bold text-foreground">
                  {Number(systemStatus?.database?.eod_rows || 0).toLocaleString()} Rows
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-md bg-muted/30 border border-border/60">
                <span className="text-muted-foreground font-sans">Institutional Deal Records</span>
                <span className="font-bold text-foreground">
                  {totalDealsCount.toLocaleString()} Disclosures
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5 rounded-md bg-muted/30 border border-border/60">
                <span className="text-muted-foreground font-sans">Symbol Governance Enforcement</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">STRICT REJECT ACTIVE</span>
              </div>

              <div className="pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onNavigateTab('system')}
                  className="w-full text-xs font-sans gap-1.5"
                >
                  <Database className="w-3.5 h-3.5" />
                  View System Architecture & Pipelines
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Institutional Governance Standards */}
          <Card className="border-primary/20 bg-primary/[0.02]">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-primary flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Institutional Standards in v2.0
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold">✓</span>
                <p>
                  <strong className="text-foreground">Zero Look-Ahead Bias:</strong> EOD price returns only evaluated after signal date candle close.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold">✓</span>
                <p>
                  <strong className="text-foreground">Signal Deduplication:</strong> Duplicate intra-day filings grouped by NSE Symbol + Date.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-primary font-bold">✓</span>
                <p>
                  <strong className="text-foreground">Net Buy Isolation:</strong> Excludes distribution/dumping activity from long accumulation strategies.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
