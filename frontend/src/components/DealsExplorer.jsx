import React, { useState, useEffect } from 'react';
import PageHeader from '@/components/common/PageHeader';
import DataTablePagination from '@/components/common/DataTablePagination';
import EmptyState from '@/components/common/EmptyState';
import LoadingState from '@/components/common/LoadingState';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
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
  DialogFooter,
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
  Search,
  Layers,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  RotateCcw,
  TrendingUp,
  Download,
  Filter,
} from 'lucide-react';
import { api } from '@/services/api';
import ClientDrilldownModal from './ClientDrilldownModal';
import { formatCrores, formatINR, formatPct } from '@/lib/utils';
import { toast } from 'sonner';

function ReactionCell({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/60">—</span>;
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
      {value.toFixed(2)}%
    </span>
  );
}

function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function DealsExplorer() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState('all');
  const [action, setAction] = useState('all');
  const [exchange, setExchange] = useState('all');
  const [availableExchanges, setAvailableExchanges] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [summary, setSummary] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);

  // Filter States
  const [netBuyOnly, setNetBuyOnly] = useState(false);
  const [datePreset, setDatePreset] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustomDateModal, setShowCustomDateModal] = useState(false);
  const [sortOption, setSortOption] = useState('date_desc');

  const getSortParams = () => {
    switch (sortOption) {
      case 'date_asc':
        return { sort_by: 'date', sort_order: 'asc' };
      case 'value_desc':
        return { sort_by: 'value', sort_order: 'desc' };
      case 'value_asc':
        return { sort_by: 'value', sort_order: 'asc' };
      case 'date_desc':
      default:
        return { sort_by: 'date', sort_order: 'desc' };
    }
  };

  const computeDateRange = (preset) => {
    const today = new Date();
    if (preset === 'today') {
      const todayStr = formatDate(today);
      return { start: todayStr, end: todayStr };
    } else if (preset === '7d') {
      const past = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start: formatDate(past), end: formatDate(today) };
    } else if (preset === '30d') {
      const past = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { start: formatDate(past), end: formatDate(today) };
    } else if (preset === '90d') {
      const past = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
      return { start: formatDate(past), end: formatDate(today) };
    } else if (preset === 'all') {
      return { start: '', end: '' };
    }
    return { start: startDate, end: endDate };
  };

  const handleDatePresetChange = (preset) => {
    setDatePreset(preset);
    setPage(1);
    if (preset === 'custom') {
      setShowCustomDateModal(true);
    } else {
      setShowCustomDateModal(false);
      const { start, end } = computeDateRange(preset);
      setStartDate(start);
      setEndDate(end);
    }
  };

  const applyCustomDateRange = () => {
    setStartDate(customFrom);
    setEndDate(customTo);
    setShowCustomDateModal(false);
    setPage(1);
    toast.success('Custom date range applied');
  };

  const clearCustomDateRange = () => {
    setCustomFrom('');
    setCustomTo('');
    setStartDate('');
    setEndDate('');
    setDatePreset('all');
    setShowCustomDateModal(false);
    setPage(1);
  };

  const handleResetFilters = () => {
    setCategory('all');
    setAction('all');
    setExchange('all');
    setSearch('');
    setNetBuyOnly(false);
    setDatePreset('all');
    setStartDate('');
    setEndDate('');
    setCustomFrom('');
    setCustomTo('');
    setShowCustomDateModal(false);
    setSortOption('date_desc');
    setPage(1);
    toast.info('Filters reset to default');
  };

  const fetchDeals = async () => {
    setLoading(true);
    try {
      const sort = getSortParams();
      const res = await api.getDeals({
        category: category !== 'all' ? category : undefined,
        action: action !== 'all' ? action : undefined,
        exchange: exchange !== 'all' ? exchange : undefined,
        search: search.trim() || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        net_buy_only: netBuyOnly,
        sort_by: sort.sort_by,
        sort_order: sort.sort_order,
        page,
        page_size: pageSize,
      });
      setDeals(res.deals || []);
      setTotalPages(res.total_pages || 1);
      setTotalCount(res.total_count || 0);
    } catch (err) {
      console.error('Failed to fetch deals:', err);
      toast.error('Failed to fetch deals data');
    } finally {
      setLoading(false);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await api.getDealsSummary({
        category: category !== 'all' ? category : undefined,
        action: action !== 'all' ? action : undefined,
        exchange: exchange !== 'all' ? exchange : undefined,
        search: search.trim() || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        net_buy_only: netBuyOnly,
      });
      setSummary(res);
    } catch (err) {
      console.error('Failed to fetch summary:', err);
    }
  };

  const fetchExchanges = async () => {
    try {
      const res = await api.getDealExchanges();
      const combined = Array.from(
        new Set([...(res.enabled_exchanges || []), ...(res.available_exchanges || [])])
      );
      setAvailableExchanges(combined);
    } catch (err) {
      console.error('Failed to fetch exchanges:', err);
    }
  };

  useEffect(() => {
    fetchDeals();
  }, [category, action, exchange, netBuyOnly, startDate, endDate, sortOption, page, pageSize]);

  useEffect(() => {
    fetchSummary();
  }, [category, action, exchange, netBuyOnly, startDate, endDate]);

  useEffect(() => {
    fetchExchanges();
  }, []);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setPage(1);
    fetchDeals();
    fetchSummary();
  };

  const hasActiveFilters =
    category !== 'all' ||
    action !== 'all' ||
    exchange !== 'all' ||
    search.trim() !== '' ||
    netBuyOnly ||
    datePreset !== 'all' ||
    startDate !== '' ||
    endDate !== '' ||
    sortOption !== 'date_desc';

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Deals Explorer"
        description="Historical and real-time disclosures repository for Bulk Deals, Block Deals, Insider Filings, and SAST Acquisitions."
        badge={`${totalCount.toLocaleString()} Indexed Deals`}
        actions={
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetFilters}
                className="gap-1.5 text-xs text-muted-foreground hover:text-destructive"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset Filters
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchDeals();
                fetchSummary();
                toast.success('Deals feed refreshed');
              }}
              className="gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* Category Summary Cards Grid */}
      {summary && summary.by_category && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {summary.by_category.map((cat) => {
            const buyRatio = cat.count > 0 ? ((cat.buy_count / cat.count) * 100).toFixed(0) : 0;
            const isSelected = category === cat.deal_category;

            return (
              <Card
                key={cat.deal_category}
                onClick={() => {
                  setCategory(isSelected ? 'all' : cat.deal_category);
                  setPage(1);
                }}
                className={`cursor-pointer transition-all hover:border-primary/50 shadow-xs ${
                  isSelected ? 'border-primary bg-primary/[0.04] ring-1 ring-primary/30' : ''
                }`}
              >
                <CardContent className="p-4 sm:p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      {cat.deal_category}
                    </span>
                    <Badge variant={isSelected ? 'default' : 'secondary'} className="text-[10px]">
                      {isSelected ? 'Active Filter' : 'Filter'}
                    </Badge>
                  </div>

                  <div className="flex items-baseline justify-between">
                    <div className="text-2xl font-black font-mono text-foreground">
                      {cat.count.toLocaleString()}
                    </div>
                    <div className="text-xs font-mono font-semibold text-muted-foreground">
                      {formatCrores(cat.total_value)}
                    </div>
                  </div>

                  {/* Buy vs Sell Progress Indicator */}
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] font-mono">
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        {cat.buy_count} Buys ({buyRatio}%)
                      </span>
                      <span className="font-bold text-rose-600 dark:text-rose-400">
                        {cat.sell_count} Sells
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-rose-500/20 dark:bg-rose-500/30 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-600 dark:bg-emerald-400 rounded-full transition-all duration-300"
                        style={{ width: `${buyRatio}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Main Deals Table Card */}
      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border/80">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Layers className="w-4 h-4 text-primary" />
                  Live Disclosures Grid
                </CardTitle>
                {netBuyOnly && (
                  <Badge variant="positive" className="text-[10px] gap-1">
                    <TrendingUp className="w-3 h-3" /> Net Buy Active
                  </Badge>
                )}
              </div>
              <CardDescription className="text-xs mt-1">
                Displaying {deals.length} records · Page {page} of {totalPages}
                {startDate && endDate ? ` · Range: ${startDate} to ${endDate}` : ''}
              </CardDescription>
            </div>

            {/* Filter Toolbar Form */}
            <form
              onSubmit={handleSearchSubmit}
              className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto"
            >
              {/* Search Box */}
              <div className="relative w-full sm:w-48">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Security, promoter..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 text-xs h-8"
                />
              </div>

              {/* Deal Category Select */}
              <Select
                value={category}
                onValueChange={(val) => {
                  setCategory(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="Insider Trading">Insider Trading</SelectItem>
                  <SelectItem value="SAST Deals">SAST Deals</SelectItem>
                  <SelectItem value="Block Deals">Block Deals</SelectItem>
                  <SelectItem value="Bulk Deals">Bulk Deals</SelectItem>
                </SelectContent>
              </Select>

              {/* Action Select */}
              <Select
                value={action}
                onValueChange={(val) => {
                  setAction(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[110px] text-xs">
                  <SelectValue placeholder="Action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">BUY & SELL</SelectItem>
                  <SelectItem value="BUY">BUY Only</SelectItem>
                  <SelectItem value="SELL">SELL Only</SelectItem>
                </SelectContent>
              </Select>

              {/* Date Presets Select */}
              <Select
                value={datePreset}
                onValueChange={(val) => handleDatePresetChange(val)}
              >
                <SelectTrigger className="h-8 w-[125px] text-xs font-mono">
                  <SelectValue placeholder="Date Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Dates</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                  <SelectItem value="90d">Last 90 Days</SelectItem>
                  <SelectItem value="custom">Custom Range...</SelectItem>
                </SelectContent>
              </Select>

              {/* Sort Order Select */}
              <Select
                value={sortOption}
                onValueChange={(val) => {
                  setSortOption(val);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="date_desc">Date: Newest First</SelectItem>
                  <SelectItem value="date_asc">Date: Oldest First</SelectItem>
                  <SelectItem value="value_desc">Value: High → Low</SelectItem>
                  <SelectItem value="value_asc">Value: Low → High</SelectItem>
                </SelectContent>
              </Select>

              {/* Net Buy Only Toggle */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-card">
                <Switch
                  id="net-buy-mode"
                  checked={netBuyOnly}
                  onCheckedChange={(checked) => {
                    setNetBuyOnly(checked);
                    setPage(1);
                  }}
                />
                <Label htmlFor="net-buy-mode" className="text-[11px] font-semibold cursor-pointer">
                  Net Buy
                </Label>
              </div>

              <Button type="submit" size="xs" variant="secondary" className="h-8 px-3">
                Filter
              </Button>
            </form>
          </div>
        </CardHeader>

        {/* Table Content */}
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6">
              <LoadingState mode="table" rows={8} />
            </div>
          ) : deals.length === 0 ? (
            <EmptyState
              title="No Deals Found"
              description="No transaction disclosures matched the current filter conditions. Try adjusting dates or resetting filters."
              actionLabel="Reset All Filters"
              onAction={handleResetFilters}
            />
          ) : (
            <div className="relative overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14 font-mono">ID</TableHead>
                    <TableHead className="w-24">Date</TableHead>
                    <TableHead className="w-28">Type</TableHead>
                    <TableHead className="min-w-[200px]">Security / Ticker</TableHead>
                    <TableHead className="min-w-[180px]">Promoter / Client</TableHead>
                    <TableHead className="w-20">Action</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right font-bold">Turnover</TableHead>
                    {netBuyOnly && (
                      <TableHead className="text-right text-emerald-600 dark:text-emerald-400 bg-emerald-500/[0.04]">
                        Net Buy Value
                      </TableHead>
                    )}
                    <TableHead className="min-w-[120px]">Mode</TableHead>
                    <TableHead className="text-right w-16">1D</TableHead>
                    <TableHead className="text-right w-16">5D</TableHead>
                    <TableHead className="text-right w-16">20D</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deals.map((d) => (
                    <TableRow key={`${d.deal_category}-${d.id}`}>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        #{d.id}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{d.trade_date}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] font-sans">
                          {d.deal_category}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {d.symbol && (
                            <Badge variant="secondary" className="font-mono text-[10px] font-bold">
                              {d.symbol}
                            </Badge>
                          )}
                          <span className="font-bold text-foreground text-xs">{d.security_name}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {d.exchange_name || 'NSE'}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate" title={d.client_name}>
                        {d.client_name ? (
                          <button
                            onClick={() => setSelectedClient(d.client_name)}
                            className="text-foreground hover:text-primary underline decoration-dotted underline-offset-2 transition-colors cursor-pointer text-xs"
                          >
                            {d.client_name}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={d.action === 'BUY' ? 'positive' : 'negative'}>
                          {d.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {d.quantity ? Number(d.quantity).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {d.price ? `₹${Number(d.price).toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-foreground">
                        {d.total_value ? formatCrores(d.total_value) : '—'}
                      </TableCell>
                      {netBuyOnly && (
                        <TableCell className="text-right font-mono font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/[0.04]">
                          {d.net_buy_value !== null && d.net_buy_value !== undefined
                            ? `+${formatCrores(d.net_buy_value)}`
                            : '—'}
                        </TableCell>
                      )}
                      <TableCell className="text-[11px] text-muted-foreground truncate max-w-[120px]">
                        {d.mode_description || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <ReactionCell value={d.price_reaction?.['1d']} />
                      </TableCell>
                      <TableCell className="text-right">
                        <ReactionCell value={d.price_reaction?.['5d']} />
                      </TableCell>
                      <TableCell className="text-right">
                        <ReactionCell value={d.price_reaction?.['20d']} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination Footer */}
          <DataTablePagination
            page={page}
            pageSize={pageSize}
            totalCount={totalCount}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={(sz) => {
              setPageSize(sz);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>

      {/* Custom Date Range Dialog */}
      <Dialog open={showCustomDateModal} onOpenChange={setShowCustomDateModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              Custom Date Filter
            </DialogTitle>
            <DialogDescription>
              Select specific trade dates to filter the historical deals repository.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4 py-3">
            <div className="space-y-1.5">
              <Label htmlFor="custom-from">From Date</Label>
              <Input
                id="custom-from"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="custom-to">To Date</Label>
              <Input
                id="custom-to"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={clearCustomDateRange}>
              Clear Range
            </Button>
            <Button
              size="sm"
              onClick={applyCustomDateRange}
              disabled={!customFrom || !customTo}
            >
              Apply Filter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Client Drilldown Modal */}
      {selectedClient && (
        <ClientDrilldownModal
          clientName={selectedClient}
          onClose={() => setSelectedClient(null)}
        />
      )}
    </div>
  );
}
