import React, { useState, useEffect, useCallback } from 'react';
import PageHeader from '@/components/common/PageHeader';
import DataTablePagination from '@/components/common/DataTablePagination';
import EmptyState from '@/components/common/EmptyState';
import LoadingState from '@/components/common/LoadingState';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  SlidersHorizontal,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  Download,
  RotateCcw,
  Sparkles,
  Search,
  Eye,
} from 'lucide-react';
import { api } from '@/services/api';
import { formatCrores, formatINR, formatPct } from '@/lib/utils';
import { toast } from 'sonner';

const SORT_OPTIONS = [
  { field: 'conviction_score', label: 'Conviction Score' },
  { field: 'insider_value', label: 'Insider Value' },
  { field: 'insider_count', label: 'Insider Count' },
  { field: 'return_1d', label: '1D Return' },
  { field: 'return_5d', label: '5D Return' },
  { field: 'return_20d', label: '20D Return' },
  { field: 'return_3m', label: '3M Return' },
  { field: 'return_6m', label: '6M Return' },
  { field: 'week_52_position', label: '52W Position' },
  { field: 'rsi', label: 'RSI (14)' },
  { field: 'volume_ratio', label: 'Volume Ratio' },
  { field: 'delivery_pct', label: 'Delivery %' },
  { field: 'delivery_increase', label: 'Delivery Increase' },
  { field: 'historical_win_rate', label: 'Historical Win Rate' },
  { field: 'signal_strength_rank', label: 'Signal Strength' },
];

const LOOKBACK_OPTIONS = [7, 14, 30, 60, 90, 180];
const DEAL_CATEGORIES = ['Insider Trading', 'SAST Deals', 'Block Deals', 'Bulk Deals'];

const DEFAULT_FILTERS = {
  insider: {
    buy: true,
    sell: false,
    min_transaction_value_lakhs: 0,
    min_insiders: 1,
    promoter_buying: false,
    repeat_buying: false,
    lookback_days: 30,
  },
  price: {
    return_1d_min: null,
    return_1d_max: null,
    return_5d_min: null,
    return_5d_max: null,
    return_20d_min: null,
    return_20d_max: null,
    return_3m_min: null,
    return_3m_max: null,
    return_6m_min: null,
    return_6m_max: null,
    week_52_position_min: null,
    week_52_position_max: null,
  },
  technical: {
    above_20dma: null,
    above_50dma: null,
    above_200dma: null,
    rsi_min: null,
    rsi_max: null,
    volume_ratio_min: null,
    volume_ratio_max: null,
    breakout: null,
  },
  delivery: {
    delivery_pct_min: null,
    delivery_pct_max: null,
    delivery_increase_min: null,
  },
  deals: { categories: [...DEAL_CATEGORIES], exchanges: [] },
  conviction: { min_score: null, max_score: null },
  sort: { field: 'conviction_score', direction: 'desc' },
  page: 1,
  page_size: 25,
};

function numOrNull(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function PctCell({ value, suffix = '%' }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/60 font-mono text-[11px]">—</span>;
  }
  const isUp = value >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 font-bold font-mono text-xs ${
        isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
      }`}
    >
      {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {isUp ? '+' : ''}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}

function SignalBadge({ tier }) {
  const t = tier?.toUpperCase();
  if (t === 'VERY STRONG') return <Badge variant="positive">VERY STRONG</Badge>;
  if (t === 'STRONG') return <Badge variant="default">STRONG</Badge>;
  if (t === 'MODERATE') return <Badge variant="warning">MODERATE</Badge>;
  return <Badge variant="neutral">WEAK</Badge>;
}

export default function SmartScreener({ onInspectSymbol }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [filterSection, setFilterSection] = useState('insider');

  const executeScreen = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.runScreener(filters);
      setData(res);
    } catch (err) {
      console.error('Screener run error:', err);
      setError('Unable to evaluate screener.');
      toast.error('Screener execution failed');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    executeScreen();
  }, [filters.page, filters.page_size, filters.sort]);

  const updateInsider = (k, v) =>
    setFilters((p) => ({ ...p, page: 1, insider: { ...p.insider, [k]: v } }));
  const updatePrice = (k, v) =>
    setFilters((p) => ({ ...p, page: 1, price: { ...p.price, [k]: v } }));
  const updateTechnical = (k, v) =>
    setFilters((p) => ({ ...p, page: 1, technical: { ...p.technical, [k]: v } }));
  const updateDelivery = (k, v) =>
    setFilters((p) => ({ ...p, page: 1, delivery: { ...p.delivery, [k]: v } }));
  const updateConviction = (k, v) =>
    setFilters((p) => ({ ...p, page: 1, conviction: { ...p.conviction, [k]: v } }));

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    toast.info('Screener filters reset');
  };

  const renderFilterControls = () => (
    <div className="space-y-4 text-xs">
      {/* Category Tabs for Filters */}
      <div className="flex flex-wrap items-center gap-1 p-1 rounded-md bg-muted border border-border">
        {[
          { id: 'insider', label: 'Insider' },
          { id: 'price', label: 'Price' },
          { id: 'technical', label: 'Technical' },
          { id: 'delivery', label: 'Delivery' },
        ].map((sec) => (
          <button
            key={sec.id}
            onClick={() => setFilterSection(sec.id)}
            className={`px-2.5 py-1 text-xs font-semibold rounded cursor-pointer transition-all ${
              filterSection === sec.id
                ? 'bg-card text-foreground shadow-xs font-bold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {sec.label}
          </button>
        ))}
      </div>

      {/* Insider Section */}
      {filterSection === 'insider' && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="insider-buy"
                checked={filters.insider.buy}
                onCheckedChange={(c) => updateInsider('buy', Boolean(c))}
              />
              <Label htmlFor="insider-buy" className="text-xs cursor-pointer">
                BUY Filings
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="insider-sell"
                checked={filters.insider.sell}
                onCheckedChange={(c) => updateInsider('sell', Boolean(c))}
              />
              <Label htmlFor="insider-sell" className="text-xs cursor-pointer">
                SELL Filings
              </Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Lookback Period</Label>
            <Select
              value={String(filters.insider.lookback_days)}
              onValueChange={(val) => updateInsider('lookback_days', Number(val))}
            >
              <SelectTrigger className="h-8 text-xs font-mono">
                <SelectValue placeholder="Lookback" />
              </SelectTrigger>
              <SelectContent>
                {LOOKBACK_OPTIONS.map((d) => (
                  <SelectItem key={d} value={String(d)} className="text-xs font-mono">
                    Last {d} Days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Min Turnover (₹ Lakhs)</Label>
            <Input
              type="number"
              step="10"
              value={filters.insider.min_transaction_value_lakhs}
              onChange={(e) =>
                updateInsider('min_transaction_value_lakhs', Number(e.target.value) || 0)
              }
              className="font-mono text-xs h-8"
            />
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="promoter-only"
                checked={filters.insider.promoter_buying}
                onCheckedChange={(c) => updateInsider('promoter_buying', Boolean(c))}
              />
              <Label htmlFor="promoter-only" className="text-xs cursor-pointer">
                Promoter Buying Only
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="repeat-buyers"
                checked={filters.insider.repeat_buying}
                onCheckedChange={(c) => updateInsider('repeat_buying', Boolean(c))}
              />
              <Label htmlFor="repeat-buyers" className="text-xs cursor-pointer">
                Repeat Accumulation
              </Label>
            </div>
          </div>
        </div>
      )}

      {/* Price & Returns Section */}
      {filterSection === 'price' && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">1D Return Range (%)</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                placeholder="Min %"
                value={filters.price.return_1d_min ?? ''}
                onChange={(e) => updatePrice('return_1d_min', numOrNull(e.target.value))}
                className="font-mono text-xs h-8"
              />
              <Input
                type="number"
                placeholder="Max %"
                value={filters.price.return_1d_max ?? ''}
                onChange={(e) => updatePrice('return_1d_max', numOrNull(e.target.value))}
                className="font-mono text-xs h-8"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">20D Return Range (%)</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                placeholder="Min %"
                value={filters.price.return_20d_min ?? ''}
                onChange={(e) => updatePrice('return_20d_min', numOrNull(e.target.value))}
                className="font-mono text-xs h-8"
              />
              <Input
                type="number"
                placeholder="Max %"
                value={filters.price.return_20d_max ?? ''}
                onChange={(e) => updatePrice('return_20d_max', numOrNull(e.target.value))}
                className="font-mono text-xs h-8"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">52W Position Range (0-100%)</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                min="0"
                max="100"
                placeholder="Min"
                value={filters.price.week_52_position_min ?? ''}
                onChange={(e) => updatePrice('week_52_position_min', numOrNull(e.target.value))}
                className="font-mono text-xs h-8"
              />
              <Input
                type="number"
                min="0"
                max="100"
                placeholder="Max"
                value={filters.price.week_52_position_max ?? ''}
                onChange={(e) => updatePrice('week_52_position_max', numOrNull(e.target.value))}
                className="font-mono text-xs h-8"
              />
            </div>
          </div>
        </div>
      )}

      {/* Technical Signals */}
      {filterSection === 'technical' && (
        <div className="space-y-3 pt-1">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="above-50dma"
                checked={filters.technical.above_50dma === true}
                onCheckedChange={(c) => updateTechnical('above_50dma', c ? true : null)}
              />
              <Label htmlFor="above-50dma" className="text-xs cursor-pointer">
                Price Above 50 DMA
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="above-200dma"
                checked={filters.technical.above_200dma === true}
                onCheckedChange={(c) => updateTechnical('above_200dma', c ? true : null)}
              />
              <Label htmlFor="above-200dma" className="text-xs cursor-pointer">
                Price Above 200 DMA
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <Checkbox
                id="breakout-flag"
                checked={filters.technical.breakout === true}
                onCheckedChange={(c) => updateTechnical('breakout', c ? true : null)}
              />
              <Label htmlFor="breakout-flag" className="text-xs cursor-pointer">
                52W Breakout (within 5% of High)
              </Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">RSI (14) Range</Label>
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="number"
                placeholder="Min (e.g. 40)"
                value={filters.technical.rsi_min ?? ''}
                onChange={(e) => updateTechnical('rsi_min', numOrNull(e.target.value))}
                className="font-mono text-xs h-8"
              />
              <Input
                type="number"
                placeholder="Max (e.g. 70)"
                value={filters.technical.rsi_max ?? ''}
                onChange={(e) => updateTechnical('rsi_max', numOrNull(e.target.value))}
                className="font-mono text-xs h-8"
              />
            </div>
          </div>
        </div>
      )}

      {/* Delivery Section */}
      {filterSection === 'delivery' && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs">Min Delivery %</Label>
            <Input
              type="number"
              min="0"
              max="100"
              placeholder="e.g. 50"
              value={filters.delivery.delivery_pct_min ?? ''}
              onChange={(e) => updateDelivery('delivery_pct_min', numOrNull(e.target.value))}
              className="font-mono text-xs h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Min Delivery Increase (%)</Label>
            <Input
              type="number"
              placeholder="e.g. 20"
              value={filters.delivery.delivery_increase_min ?? ''}
              onChange={(e) => updateDelivery('delivery_increase_min', numOrNull(e.target.value))}
              className="font-mono text-xs h-8"
            />
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-border/80 flex items-center justify-between gap-2">
        <Button size="xs" variant="outline" onClick={resetFilters}>
          Reset
        </Button>
        <Button size="xs" onClick={() => executeScreen()} className="font-bold">
          Apply Filters
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Smart Stock Screener"
        description="Filter and rank Indian equities combining insider conviction scores, technical breakout signals, and delivery spikes."
        badge="Multi-Factor Scanner"
        actions={
          <div className="flex items-center gap-2">
            {/* Mobile Filter Sheet Trigger */}
            <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
              <SheetTrigger asChild>
                <Button size="sm" variant="outline" className="md:hidden gap-1.5 text-xs">
                  <Filter className="w-3.5 h-3.5" />
                  Filter Parameters
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-80 p-6 overflow-y-auto">
                <SheetHeader className="pb-3 border-b border-border text-left">
                  <SheetTitle className="text-base font-bold flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-primary" />
                    Screener Parameters
                  </SheetTitle>
                  <SheetDescription className="text-xs">
                    Adjust quantitative filter thresholds
                  </SheetDescription>
                </SheetHeader>
                <div className="pt-4">{renderFilterControls()}</div>
              </SheetContent>
            </Sheet>

            <Button
              size="sm"
              variant="outline"
              onClick={executeScreen}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Run Screen
            </Button>
          </div>
        }
      />

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left Column: Filter Sidebar (Desktop) */}
        <div className="hidden md:block md:col-span-4 lg:col-span-3 space-y-4">
          <Card>
            <CardHeader className="p-4 border-b border-border/80">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
                Filter Parameters
              </CardTitle>
              <CardDescription className="text-xs">
                Quantitative rule constraints
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4">{renderFilterControls()}</CardContent>
          </Card>
        </div>

        {/* Right Column: Ranked Screener Results */}
        <div className="md:col-span-8 lg:col-span-9 space-y-4">
          <Card>
            <CardHeader className="p-4 sm:p-5 border-b border-border/80">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    Ranked Equities ({data?.total_count || 0})
                  </CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Click any ticker to inspect in-depth conviction scoring & historical deals
                  </CardDescription>
                </div>

                {/* Sort Field Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Rank by:</span>
                  <Select
                    value={filters.sort.field}
                    onValueChange={(val) =>
                      setFilters((p) => ({
                        ...p,
                        sort: { ...p.sort, field: val },
                      }))
                    }
                  >
                    <SelectTrigger className="h-8 w-44 text-xs font-semibold">
                      <SelectValue placeholder="Sort" />
                    </SelectTrigger>
                    <SelectContent>
                      {SORT_OPTIONS.map((s) => (
                        <SelectItem key={s.field} value={s.field} className="text-xs">
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              {loading ? (
                <div className="p-6">
                  <LoadingState mode="table" rows={8} />
                </div>
              ) : !data?.results || data.results.length === 0 ? (
                <EmptyState
                  title="No Stocks Passed Filter Constraints"
                  description="Try easing the lookback period, lowering the turnover threshold, or unchecking technical requirements."
                  actionLabel="Reset to Default Parameters"
                  onAction={resetFilters}
                />
              ) : (
                <div className="relative overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Symbol / Company</TableHead>
                        <TableHead className="text-right">Conviction</TableHead>
                        <TableHead>Signal</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">1D</TableHead>
                        <TableHead className="text-right">20D</TableHead>
                        <TableHead className="text-right">52W Pos</TableHead>
                        <TableHead className="text-right">Vol Ratio</TableHead>
                        <TableHead className="text-right">Delivery %</TableHead>
                        <TableHead className="text-right">Insider Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.results.map((item) => (
                        <TableRow
                          key={item.symbol}
                          className="hover:bg-muted/40 cursor-pointer"
                          onClick={() => onInspectSymbol && onInspectSymbol(item.symbol)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <Badge variant="secondary" className="font-mono text-xs font-bold">
                                {item.symbol}
                              </Badge>
                              <span className="font-bold text-foreground text-xs">{item.company_name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold text-sm text-foreground">
                            {item.conviction_score !== null ? (
                              <span
                                className={
                                  item.conviction_score >= 70
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : item.conviction_score >= 50
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-muted-foreground'
                                }
                              >
                                {item.conviction_score.toFixed(0)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>
                            <SignalBadge tier={item.signal_strength_tier} />
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            ₹{item.price ? Number(item.price).toFixed(2) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <PctCell value={item.return_1d} />
                          </TableCell>
                          <TableCell className="text-right">
                            <PctCell value={item.return_20d} />
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {item.week_52_position !== null
                              ? `${item.week_52_position.toFixed(0)}%`
                              : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {item.volume_ratio !== null ? `${item.volume_ratio.toFixed(1)}x` : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {item.delivery_pct !== null ? `${item.delivery_pct.toFixed(0)}%` : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold text-foreground text-xs">
                            {formatCrores(item.insider_value)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Pagination */}
              {data && (
                <DataTablePagination
                  page={data.page || 1}
                  pageSize={data.page_size || 25}
                  totalCount={data.total_count || 0}
                  totalPages={data.total_pages || 1}
                  onPageChange={(p) => setFilters((prev) => ({ ...prev, page: p }))}
                  onPageSizeChange={(sz) =>
                    setFilters((prev) => ({ ...prev, page: 1, page_size: sz }))
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
