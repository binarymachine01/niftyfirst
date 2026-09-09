import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import DataTablePagination from '@/components/common/DataTablePagination';
import {
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Download,
  CheckCircle,
  XCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { formatINR, formatPct } from '@/lib/utils';
import { toast } from 'sonner';

export default function TradeLogTable({ trades }) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState('ALL'); // ALL, WIN, LOSS, SL, TP
  const [sortField, setSortField] = useState('entry_date');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  if (!trades || trades.length === 0) return null;

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const filteredTrades = useMemo(() => {
    let result = trades.filter((t) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        t.symbol?.toLowerCase().includes(q) ||
        t.security_name?.toLowerCase().includes(q) ||
        (t.client_name && t.client_name.toLowerCase().includes(q)) ||
        t.deal_category?.toLowerCase().includes(q);

      if (!matchesSearch) return false;

      if (activeFilter === 'WIN') return t.pnl_pct > 0;
      if (activeFilter === 'LOSS') return t.pnl_pct < 0;
      if (activeFilter === 'SL') return t.exit_reason === 'Stop Loss';
      if (activeFilter === 'TP') return t.exit_reason === 'Take Profit';
      return true;
    });

    result.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string') {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      return sortAsc ? (valA || 0) - (valB || 0) : (valB || 0) - (valA || 0);
    });

    return result;
  }, [trades, search, activeFilter, sortField, sortAsc]);

  const totalPages = Math.ceil(filteredTrades.length / pageSize) || 1;
  const paginatedTrades = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredTrades.slice(start, start + pageSize);
  }, [filteredTrades, page, pageSize]);

  const exportCSV = () => {
    const headers = [
      'Symbol',
      'Security Name',
      'Category',
      'Client Name',
      'Action',
      'Deal Date',
      'Entry Date',
      'Entry Price',
      'Exit Date',
      'Exit Price',
      'Exit Reason',
      'Return %',
      'Net PnL (INR)',
    ];

    const rows = filteredTrades.map((t) => [
      t.symbol,
      `"${t.security_name.replace(/"/g, '""')}"`,
      t.deal_category,
      `"${(t.client_name || '').replace(/"/g, '""')}"`,
      t.action,
      t.deal_date,
      t.entry_date,
      t.entry_price.toFixed(2),
      t.exit_date,
      t.exit_price.toFixed(2),
      t.exit_reason,
      t.pnl_pct.toFixed(2),
      t.pnl_amount.toFixed(2),
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `niftyfirst_trades_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Trade log CSV downloaded');
  };

  return (
    <Card>
      <CardHeader className="p-4 sm:p-5 border-b border-border/80">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-primary" />
              Simulated Trade Executions Log
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {trades.length} historical trades simulated · {filteredTrades.length} matching active filters
            </CardDescription>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Quick Result Filters */}
            <div className="flex items-center gap-1 p-0.5 rounded-md bg-muted border border-border/60">
              {[
                { id: 'ALL', label: 'All' },
                { id: 'WIN', label: 'Wins' },
                { id: 'LOSS', label: 'Losses' },
                { id: 'SL', label: 'Stop-Loss' },
                { id: 'TP', label: 'Target' },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setActiveFilter(f.id);
                    setPage(1);
                  }}
                  className={`px-2 py-1 text-xs font-semibold rounded cursor-pointer transition-colors ${
                    activeFilter === f.id
                      ? 'bg-card text-foreground shadow-xs font-bold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Export CSV Button */}
            <Button size="xs" variant="outline" onClick={exportCSV} className="gap-1 text-xs">
              <Download className="w-3.5 h-3.5" />
              Export
            </Button>
          </div>
        </div>

        {/* Search Filter Bar */}
        <div className="pt-2">
          <div className="relative max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search symbol, client, or deal category..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="pl-8 text-xs h-8"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="relative overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol / Security</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Promoter / Entity</TableHead>
                <TableHead>Direction</TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('entry_date')}>
                  Entry Date
                </TableHead>
                <TableHead className="text-right">Entry (₹)</TableHead>
                <TableHead className="cursor-pointer" onClick={() => handleSort('exit_date')}>
                  Exit Date
                </TableHead>
                <TableHead className="text-right">Exit (₹)</TableHead>
                <TableHead>Exit Reason</TableHead>
                <TableHead className="text-right cursor-pointer" onClick={() => handleSort('pnl_pct')}>
                  Return (%)
                </TableHead>
                <TableHead className="text-right cursor-pointer" onClick={() => handleSort('pnl_amount')}>
                  Net P&L (₹)
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedTrades.map((t, idx) => {
                const isWin = t.pnl_pct > 0;
                return (
                  <TableRow key={idx}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="font-mono text-[10px] font-bold">
                          {t.symbol}
                        </Badge>
                        <span className="font-bold text-foreground text-xs">{t.security_name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] font-sans">
                        {t.deal_category}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate text-muted-foreground text-xs" title={t.client_name}>
                      {t.client_name || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.action === 'BUY' ? 'positive' : 'negative'}>
                        {t.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.entry_date}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      ₹{t.entry_price.toFixed(2)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{t.exit_date}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      ₹{t.exit_price.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <span className="text-[11px] font-medium text-muted-foreground">
                        {t.exit_reason}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      <span
                        className={`inline-flex items-center gap-0.5 ${
                          isWin ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {isWin ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                        {isWin ? '+' : ''}
                        {t.pnl_pct.toFixed(2)}%
                      </span>
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono font-bold ${
                        isWin ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {isWin ? '+₹' : '-₹'}
                      {Math.abs(t.pnl_amount).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Standard Pagination */}
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          totalCount={filteredTrades.length}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={(sz) => {
            setPageSize(sz);
            setPage(1);
          }}
        />
      </CardContent>
    </Card>
  );
}
