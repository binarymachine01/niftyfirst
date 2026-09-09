import React, { useState, useEffect, useMemo } from 'react';
import PageHeader from '@/components/common/PageHeader';
import MetricCard from '@/components/common/MetricCard';
import DataTablePagination from '@/components/common/DataTablePagination';
import EmptyState from '@/components/common/EmptyState';
import LoadingState from '@/components/common/LoadingState';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Play,
  Calendar,
  Filter,
  Download,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  RefreshCw,
  Search,
  Eye,
  History,
  FileSpreadsheet,
  Zap,
} from 'lucide-react';
import { api } from '@/services/api';
import { formatCrores, formatINR, formatPct } from '@/lib/utils';
import { toast } from 'sonner';

const DEAL_TYPE_OPTIONS = [
  { id: 'Insider Trading', label: 'Insider', badge: 'SEBI PIT' },
  { id: 'SAST Deals', label: 'SAST', badge: 'Takeovers' },
  { id: 'Block Deals', label: 'Block', badge: 'Min ₹10Cr' },
  { id: 'Bulk Deals', label: 'Bulk', badge: '>0.5% Eq' },
];

function ReturnCell({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/60 font-mono text-[11px]">N/A</span>;
  }
  const n = Number(value);
  const isPos = n > 0;
  const isNeg = n < 0;
  return (
    <span
      className={`font-mono text-xs font-bold inline-flex items-center gap-0.5 ${
        isPos ? 'text-emerald-600 dark:text-emerald-400' : isNeg ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'
      }`}
    >
      {isPos ? <ArrowUpRight className="w-3 h-3" /> : isNeg ? <ArrowDownRight className="w-3 h-3" /> : null}
      {isPos ? '+' : ''}
      {n.toFixed(2)}%
    </span>
  );
}

export default function DateRangeBacktester() {
  // Config & Form State
  const [fromDate, setFromDate] = useState('2026-01-01');
  const [toDate, setToDate] = useState('2026-08-31');
  const [dealTypes, setDealTypes] = useState([
    'Insider Trading',
    'SAST Deals',
    'Block Deals',
    'Bulk Deals',
  ]);
  const [action, setAction] = useState('BOTH'); // BUY, SELL, BOTH
  const [minValueLakhs, setMinValueLakhs] = useState(0);
  const [activePreset, setActivePreset] = useState('6m');

  // Metadata & Status State
  const [availability, setAvailability] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [runData, setRunData] = useState(null);

  // Table & Filter State
  const [tableSearch, setTableSearch] = useState('');
  const [tableCategory, setTableCategory] = useState('ALL');
  const [tableAction, setTableAction] = useState('ALL');
  const [tableReturnFilter, setTableReturnFilter] = useState('ALL'); // ALL, POSITIVE, NEGATIVE
  const [sortField, setSortField] = useState('deal_date');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Modals & Drilldowns
  const [selectedSignalForDrilldown, setSelectedSignalForDrilldown] = useState(null);
  const [showExcludedModal, setShowExcludedModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyRuns, setHistoryRuns] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Fetch Data Availability on Mount
  useEffect(() => {
    api
      .getBacktestDataAvailability()
      .then((res) => {
        setAvailability(res);
        if (res?.eod?.max_date) {
          const maxD = res.eod.max_date;
          setToDate(maxD);
          try {
            const d = new Date(maxD);
            d.setMonth(d.getMonth() - 6);
            setFromDate(d.toISOString().slice(0, 10));
            setActivePreset('6m');
          } catch (e) {
            console.error(e);
          }
        }
      })
      .catch((err) => {
        console.error('Failed to load data availability:', err);
      });
  }, []);

  // Quick Preset Helper
  const applyPreset = (presetKey) => {
    setActivePreset(presetKey);
    const maxDateStr = availability?.eod?.max_date || new Date().toISOString().slice(0, 10);
    const maxDate = new Date(maxDateStr);
    setToDate(maxDateStr);

    if (presetKey === '30d') {
      const d = new Date(maxDate);
      d.setDate(d.getDate() - 30);
      setFromDate(d.toISOString().slice(0, 10));
    } else if (presetKey === '90d') {
      const d = new Date(maxDate);
      d.setDate(d.getDate() - 90);
      setFromDate(d.toISOString().slice(0, 10));
    } else if (presetKey === '6m') {
      const d = new Date(maxDate);
      d.setMonth(d.getMonth() - 6);
      setFromDate(d.toISOString().slice(0, 10));
    } else if (presetKey === '1y') {
      const d = new Date(maxDate);
      d.setFullYear(d.getFullYear() - 1);
      setFromDate(d.toISOString().slice(0, 10));
    } else if (presetKey === 'full') {
      if (availability?.eod?.min_date) {
        setFromDate(availability.eod.min_date);
      } else {
        setFromDate('2024-12-02');
      }
    }
  };

  const handleToggleDealType = (typeId) => {
    if (dealTypes.includes(typeId)) {
      if (dealTypes.length > 1) {
        setDealTypes(dealTypes.filter((t) => t !== typeId));
      }
    } else {
      setDealTypes([...dealTypes, typeId]);
    }
  };

  // Run Backtest
  const handleRunBacktest = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        from_date: fromDate,
        to_date: toDate,
        deal_types: dealTypes,
        actions: action === 'BOTH' ? ['BUY', 'SELL'] : [action],
        exchange: 'NSE',
        min_value_lakhs: parseFloat(minValueLakhs) || 0,
      };
      const res = await api.runDateRangeBacktest(payload);
      setRunData(res.data);
      setPage(1);
      toast.success('Date-range backtest simulation completed');
    } catch (err) {
      console.error('Backtest error:', err);
      const msg = err.response?.data?.detail || err.message || 'Backtest execution failed.';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Export handlers
  const handleExport = async (type = 'deals', format = 'csv') => {
    if (!runData?.run_id) return;
    setExporting(true);
    try {
      await api.downloadBacktestExport(runData.run_id, type, format);
      toast.success(`Exported ${type} (${format.toUpperCase()})`);
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  // Load history runs
  const handleOpenHistory = async () => {
    setShowHistoryModal(true);
    setLoadingHistory(true);
    try {
      const res = await api.getBacktestRuns(15);
      setHistoryRuns(res.runs || []);
    } catch (err) {
      console.error('Failed to load runs:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleLoadHistoricRun = async (runId) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getBacktestRun(runId);
      setRunData(res.data);
      setFromDate(res.data.from_date);
      setToDate(res.data.to_date);
      setDealTypes(res.data.deal_types || []);
      setShowHistoryModal(false);
      setPage(1);
      toast.success(`Loaded historic backtest run ${runId}`);
    } catch (err) {
      console.error('Failed to load run:', err);
      toast.error('Could not load prior backtest run.');
    } finally {
      setLoading(false);
    }
  };

  // Deals Filtering and Sorting
  const filteredDeals = useMemo(() => {
    if (!runData?.deals) return [];
    let items = runData.deals;

    if (tableSearch.trim()) {
      const q = tableSearch.toLowerCase();
      items = items.filter(
        (d) =>
          d.security_name?.toLowerCase().includes(q) ||
          d.nse_symbol?.toLowerCase().includes(q) ||
          d.company_name?.toLowerCase().includes(q) ||
          d.underlying_deals?.some((u) => u.client_name?.toLowerCase().includes(q))
      );
    }

    if (tableCategory !== 'ALL') {
      items = items.filter((d) => d.deal_type === tableCategory);
    }

    if (tableAction !== 'ALL') {
      items = items.filter((d) => d.action === tableAction);
    }

    if (tableReturnFilter === 'POSITIVE') {
      items = items.filter((d) => d.signal_return !== null && d.signal_return > 0);
    } else if (tableReturnFilter === 'NEGATIVE') {
      items = items.filter((d) => d.signal_return !== null && d.signal_return < 0);
    }

    items = [...items].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (valA === null || valA === undefined) valA = sortDir === 'asc' ? Infinity : -Infinity;
      if (valB === null || valB === undefined) valB = sortDir === 'asc' ? Infinity : -Infinity;
      if (typeof valA === 'string') {
        return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortDir === 'asc' ? valA - valB : valB - valA;
    });

    return items;
  }, [runData, tableSearch, tableCategory, tableAction, tableReturnFilter, sortField, sortDir]);

  const totalPages = Math.ceil(filteredDeals.length / pageSize) || 1;
  const paginatedDeals = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredDeals.slice(start, start + pageSize);
  }, [filteredDeals, page, pageSize]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Full Deal Signals Backtest"
        description="Quantitatively test all historical insider, bulk, block, and SAST deals across 1D, 5D, 10D, 20D, and 60D forward returns."
        badge="Zero Look-Ahead Bias"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenHistory}
              className="gap-1.5 text-xs"
            >
              <History className="w-3.5 h-3.5" />
              Prior Runs
            </Button>
            {runData && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport('deals', 'csv')}
                  disabled={exporting}
                  className="gap-1.5 text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport('deals', 'excel')}
                  disabled={exporting}
                  className="gap-1.5 text-xs"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Excel
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* Top Level Summary Cards (Active when runData present) */}
      {runData?.summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <MetricCard
            title="Total Disclosures"
            value={runData.summary.total_underlying_transactions?.toLocaleString() || runData.summary.total_deals?.toLocaleString()}
            subtitle={`${runData.summary.total_deals?.toLocaleString()} signals`}
            variant="default"
          />
          <MetricCard
            title="Eligible Signals"
            value={runData.summary.eligible_deals?.toLocaleString()}
            subtitle="Matched to NSE EOD"
            variant="positive"
          />
          <div
            onClick={() => setShowExcludedModal(true)}
            className="cursor-pointer"
            title="Click to view excluded records audit"
          >
            <MetricCard
              title="Excluded Records"
              value={runData.summary.excluded_deals?.toLocaleString()}
              subtitle="Audit exclusions →"
              variant={runData.summary.excluded_deals > 0 ? 'warning' : 'default'}
            />
          </div>
          <MetricCard
            title="20D Win Rate"
            value={formatPct(runData.summary.win_rate_20d, false)}
            subtitle={`${runData.summary.eligible_deals} trades`}
            trend={runData.summary.win_rate_20d >= 50 ? 'up' : 'down'}
            variant={runData.summary.win_rate_20d >= 50 ? 'positive' : 'warning'}
          />
          <MetricCard
            title="Mean 20D Return"
            value={formatPct(runData.summary.avg_return_20d)}
            subtitle="Trading days forward"
            trend={runData.summary.avg_return_20d >= 0 ? 'up' : 'down'}
            variant={runData.summary.avg_return_20d >= 0 ? 'positive' : 'negative'}
          />
          <MetricCard
            title="60D Win Rate"
            value={formatPct(runData.summary.win_rate_60d, false)}
            subtitle="Medium horizon"
            trend={runData.summary.win_rate_60d >= 50 ? 'up' : 'down'}
            variant={runData.summary.win_rate_60d >= 50 ? 'positive' : 'warning'}
          />
        </div>
      )}

      {/* Backtest Configuration Card */}
      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                Date Range & Strategy Configuration
              </CardTitle>
              <CardDescription className="text-xs">
                {availability?.eod
                  ? `Available EOD Price History: ${availability.eod.min_date} to ${availability.eod.max_date} (${availability.eod.count.toLocaleString()} rows)`
                  : 'Loading market availability metadata...'}
              </CardDescription>
            </div>

            {/* Quick Date Presets */}
            <div className="flex items-center gap-1 p-0.5 rounded-md bg-muted border border-border/60">
              {[
                { id: '30d', label: '30D' },
                { id: '90d', label: '90D' },
                { id: '6m', label: '6M' },
                { id: '1y', label: '1Y' },
                { id: 'full', label: 'Full Data' },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded cursor-pointer transition-colors ${
                    activePreset === p.id
                      ? 'bg-card text-foreground shadow-xs font-bold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* From Date */}
            <div className="space-y-1.5">
              <Label htmlFor="from_date">From Date</Label>
              <Input
                id="from_date"
                type="date"
                value={fromDate}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="font-mono text-xs h-8"
              />
            </div>

            {/* To Date */}
            <div className="space-y-1.5">
              <Label htmlFor="to_date">To Date</Label>
              <Input
                id="to_date"
                type="date"
                value={toDate}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="font-mono text-xs h-8"
              />
            </div>

            {/* Action Select */}
            <div className="space-y-1.5">
              <Label htmlFor="action_select">Trade Direction</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger id="action_select" className="h-8 text-xs font-semibold">
                  <SelectValue placeholder="Direction" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BOTH">BUY & SELL (Both)</SelectItem>
                  <SelectItem value="BUY">BUY Deals Only</SelectItem>
                  <SelectItem value="SELL">SELL Deals Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Min Value Filter */}
            <div className="space-y-1.5">
              <Label htmlFor="min_value">Min Turnover (₹ Lakhs)</Label>
              <Input
                id="min_value"
                type="number"
                min="0"
                step="10"
                value={minValueLakhs}
                onChange={(e) => setMinValueLakhs(e.target.value)}
                placeholder="0"
                className="font-mono text-xs h-8"
              />
            </div>

            {/* Launch Button */}
            <div className="space-y-1.5 flex flex-col justify-end">
              <Button
                onClick={handleRunBacktest}
                disabled={loading}
                className="h-8 w-full gap-1.5 font-bold shadow-xs"
              >
                {loading ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    Executing...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Run Backtest
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Deal Types Selector Pills */}
          <div className="pt-2 border-t border-border/80 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-muted-foreground mr-1">
                Included Deal Types:
              </span>
              {DEAL_TYPE_OPTIONS.map((t) => {
                const isSelected = dealTypes.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => handleToggleDealType(t.id)}
                    className={`px-3 py-1 text-xs font-semibold rounded-md border transition-all cursor-pointer flex items-center gap-1.5 ${
                      isSelected
                        ? 'border-primary bg-primary/[0.08] text-foreground font-bold shadow-xs'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    <span>{t.label}</span>
                    <Badge variant={isSelected ? 'default' : 'outline'} className="text-[9px] px-1 py-0 font-mono">
                      {t.badge}
                    </Badge>
                  </button>
                );
              })}
            </div>

            <div className="text-[11px] text-muted-foreground font-mono">
              Exchange: <span className="font-bold text-foreground">NSE Strictly Enforced</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown Metrics Grid */}
      {runData?.deal_type_performance && runData.action_performance && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Performance by Deal Type */}
          <Card>
            <CardHeader className="p-4 border-b border-border/80">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-primary" />
                Performance by Deal Type
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Deal Type</TableHead>
                    <TableHead className="text-right">Signals</TableHead>
                    <TableHead className="text-right">20D Win %</TableHead>
                    <TableHead className="text-right">Avg 20D Return</TableHead>
                    <TableHead className="text-right">Avg 60D Return</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(runData.deal_type_performance).map(([cat, stats]) => (
                    <TableRow key={cat}>
                      <TableCell className="font-semibold text-foreground text-xs">{cat}</TableCell>
                      <TableCell className="text-right font-mono">{stats.count}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-foreground">
                        {formatPct(stats.win_rate_20d, false)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <ReturnCell value={stats.avg_return_20d} />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <ReturnCell value={stats.avg_return_60d} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Performance by Direction (BUY vs SELL) */}
          <Card>
            <CardHeader className="p-4 border-b border-border/80">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-primary" />
                Performance by Trade Direction
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Direction</TableHead>
                    <TableHead className="text-right">Signals</TableHead>
                    <TableHead className="text-right">20D Win %</TableHead>
                    <TableHead className="text-right">Avg 20D Return</TableHead>
                    <TableHead className="text-right">Avg 60D Return</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(runData.action_performance).map(([act, stats]) => (
                    <TableRow key={act}>
                      <TableCell>
                        <Badge variant={act === 'BUY' ? 'positive' : 'negative'}>{act}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{stats.count}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-foreground">
                        {formatPct(stats.win_rate_20d, false)}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <ReturnCell value={stats.avg_return_20d} />
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        <ReturnCell value={stats.avg_return_60d} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Consolidated Signals Table Card */}
      {runData && (
        <Card>
          <CardHeader className="p-4 sm:p-5 border-b border-border/80">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  Consolidated Signals & Multi-Horizon Forward Performance
                </CardTitle>
                <CardDescription className="text-xs">
                  {filteredDeals.length} signals displayed · Evaluated at forward market closes
                </CardDescription>
              </div>

              {/* Table Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-44">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="Search security..."
                    value={tableSearch}
                    onChange={(e) => {
                      setTableSearch(e.target.value);
                      setPage(1);
                    }}
                    className="pl-8 text-xs h-8"
                  />
                </div>

                <Select
                  value={tableCategory}
                  onValueChange={(val) => {
                    setTableCategory(val);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 w-[120px] text-xs">
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Categories</SelectItem>
                    <SelectItem value="Insider Trading">Insider</SelectItem>
                    <SelectItem value="SAST Deals">SAST</SelectItem>
                    <SelectItem value="Block Deals">Block</SelectItem>
                    <SelectItem value="Bulk Deals">Bulk</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={tableAction}
                  onValueChange={(val) => {
                    setTableAction(val);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 w-[95px] text-xs">
                    <SelectValue placeholder="Action" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All</SelectItem>
                    <SelectItem value="BUY">BUY</SelectItem>
                    <SelectItem value="SELL">SELL</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={tableReturnFilter}
                  onValueChange={(val) => {
                    setTableReturnFilter(val);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="h-8 w-[115px] text-xs">
                    <SelectValue placeholder="Return" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All Returns</SelectItem>
                    <SelectItem value="POSITIVE">Positive Only</SelectItem>
                    <SelectItem value="NEGATIVE">Negative Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="relative overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Signal Date</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="min-w-[200px]">Security / NSE Symbol</TableHead>
                    <TableHead className="text-right">Filing Count</TableHead>
                    <TableHead className="text-right font-bold">Total Turnover</TableHead>
                    <TableHead className="text-right text-emerald-600 dark:text-emerald-400">Net Buy Value</TableHead>
                    <TableHead className="text-right">Entry Price</TableHead>
                    <TableHead className="text-right">1D</TableHead>
                    <TableHead className="text-right">5D</TableHead>
                    <TableHead className="text-right">10D</TableHead>
                    <TableHead className="text-right">20D</TableHead>
                    <TableHead className="text-right">60D</TableHead>
                    <TableHead className="text-right font-bold">Signal Return</TableHead>
                    <TableHead className="text-center">Audit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedDeals.map((d, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {d.deal_date}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {d.deal_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.action === 'BUY' ? 'positive' : 'negative'}>
                          {d.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {d.nse_symbol && (
                            <Badge variant="secondary" className="font-mono text-[10px] font-bold">
                              {d.nse_symbol}
                            </Badge>
                          )}
                          <span className="font-bold text-foreground text-xs">{d.security_name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {d.transaction_count || d.underlying_deals?.length || 1}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-foreground">
                        {formatCrores(d.total_value)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {d.net_buy_value !== undefined && d.net_buy_value !== null
                          ? formatCrores(d.net_buy_value)
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        ₹{d.entry_price?.toFixed(2) || '—'}
                      </TableCell>
                      <TableCell className="text-right"><ReturnCell value={d.return_1d} /></TableCell>
                      <TableCell className="text-right"><ReturnCell value={d.return_5d} /></TableCell>
                      <TableCell className="text-right"><ReturnCell value={d.return_10d} /></TableCell>
                      <TableCell className="text-right"><ReturnCell value={d.return_20d} /></TableCell>
                      <TableCell className="text-right"><ReturnCell value={d.return_60d} /></TableCell>
                      <TableCell className="text-right font-mono font-black">
                        <ReturnCell value={d.signal_return} />
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setSelectedSignalForDrilldown(d)}
                          title="Inspect underlying deal filings"
                        >
                          <Eye className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Control */}
            <DataTablePagination
              page={page}
              pageSize={pageSize}
              totalCount={filteredDeals.length}
              totalPages={totalPages}
              onPageChange={setPage}
              onPageSizeChange={(sz) => {
                setPageSize(sz);
                setPage(1);
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Underlying Transactions Drilldown Dialog */}
      {selectedSignalForDrilldown && (
        <Dialog
          open={Boolean(selectedSignalForDrilldown)}
          onOpenChange={(open) => !open && setSelectedSignalForDrilldown(null)}
        >
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                Underlying Transaction Filings ({selectedSignalForDrilldown.security_name})
              </DialogTitle>
              <DialogDescription>
                Consolidated signal on {selectedSignalForDrilldown.deal_date} with {selectedSignalForDrilldown.transaction_count || selectedSignalForDrilldown.underlying_deals?.length || 1} disclosures.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-3 gap-3 p-3 rounded-lg bg-muted/40 border border-border text-xs">
                <div>
                  <span className="text-muted-foreground">Dominant Action:</span>{' '}
                  <Badge variant={selectedSignalForDrilldown.action === 'BUY' ? 'positive' : 'negative'}>
                    {selectedSignalForDrilldown.action}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Turnover:</span>{' '}
                  <span className="font-mono font-bold text-foreground">{formatCrores(selectedSignalForDrilldown.total_value)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Net Buy:</span>{' '}
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatCrores(selectedSignalForDrilldown.net_buy_value)}</span>
                </div>
              </div>

              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Entity / Client</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(selectedSignalForDrilldown.underlying_deals || [selectedSignalForDrilldown]).map((u, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{u.trade_date || u.deal_date}</TableCell>
                        <TableCell className="font-semibold text-foreground text-xs max-w-[200px] truncate">
                          {u.client_name || u.promoter_name || '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={u.action === 'BUY' ? 'positive' : 'negative'}>{u.action}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {u.quantity ? Number(u.quantity).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          ₹{u.price?.toFixed(2) || '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-foreground">
                          {formatCrores(u.total_value)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Excluded Records Modal */}
      {showExcludedModal && (
        <Dialog open={showExcludedModal} onOpenChange={setShowExcludedModal}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                Excluded Records Audit Trail ({runData?.summary?.excluded_deals || 0})
              </DialogTitle>
              <DialogDescription>
                Disclosures excluded from forward returns to preserve data integrity and eliminate bias.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-border overflow-hidden pt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Security</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Exclusion Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(runData?.excluded_records || []).map((ex, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{ex.deal_date}</TableCell>
                      <TableCell className="font-bold text-foreground text-xs">{ex.security_name}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{ex.deal_type}</Badge></TableCell>
                      <TableCell className="text-right font-mono">{formatCrores(ex.total_value)}</TableCell>
                      <TableCell className="text-xs text-amber-700 dark:text-amber-400 font-mono">
                        {ex.exclusion_reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Prior Backtest Runs History Modal */}
      {showHistoryModal && (
        <Dialog open={showHistoryModal} onOpenChange={setShowHistoryModal}>
          <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <History className="w-4 h-4 text-primary" />
                Prior Backtest Executions
              </DialogTitle>
              <DialogDescription>
                Select any prior saved simulation to load its parameters, signals, and performance.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-lg border border-border overflow-hidden pt-2">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Date Range</TableHead>
                    <TableHead className="text-right">Signals</TableHead>
                    <TableHead className="text-right">20D Win %</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyRuns.map((r) => (
                    <TableRow key={r.run_id}>
                      <TableCell className="font-mono text-xs font-bold text-foreground">{r.run_id}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.from_date} → {r.to_date}</TableCell>
                      <TableCell className="text-right font-mono">{r.summary?.eligible_deals || '—'}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-foreground">
                        {r.summary?.win_rate_20d !== undefined ? `${r.summary.win_rate_20d.toFixed(1)}%` : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => handleLoadHistoricRun(r.run_id)}
                        >
                          Load Run
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
