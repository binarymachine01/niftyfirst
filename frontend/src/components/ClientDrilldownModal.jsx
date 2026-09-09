import React, { useState, useEffect } from 'react';
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
import { Badge } from '@/components/ui/badge';
import MetricCard from '@/components/common/MetricCard';
import LoadingState from '@/components/common/LoadingState';
import { User, TrendingUp, TrendingDown, Layers, Wallet } from 'lucide-react';
import { api } from '@/services/api';
import { formatCrores, formatINR } from '@/lib/utils';

export default function ClientDrilldownModal({ clientName, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!clientName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    api
      .getClientDeals(clientName)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.detail || 'Failed to load client history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientName]);

  const open = Boolean(clientName);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-6">
        <DialogHeader className="pb-3 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <User className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-base sm:text-lg font-black tracking-tight text-foreground">
                {clientName}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Institutional Client / Promoter Disclosed Transaction History
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading && <LoadingState mode="cards" cards={4} />}

        {error && (
          <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-medium">
            {error}
          </div>
        )}

        {data && (
          <div className="space-y-6 pt-2">
            {/* Summary KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard
                title="Total Deals"
                value={data.summary.total_deals.toLocaleString()}
                subtitle="All Categories"
              />
              <MetricCard
                title="Securities"
                value={data.summary.distinct_securities.toLocaleString()}
                subtitle="Unique Tickers"
              />
              <MetricCard
                title="Buy Value"
                value={formatCrores(data.summary.total_buy_value)}
                subtitle={`${data.summary.buy_count} BUY deals`}
                icon={TrendingUp}
                variant="positive"
              />
              <MetricCard
                title="Sell Value"
                value={formatCrores(data.summary.total_sell_value)}
                subtitle={`${data.summary.sell_count} SELL deals`}
                icon={TrendingDown}
                variant="negative"
              />
            </div>

            {/* Net Position Banner */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-muted/40 border border-border text-xs">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-primary" />
                <span className="font-bold text-foreground">Net Position:</span>
                <span
                  className={`font-mono font-bold text-sm ${
                    data.summary.net_value >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {data.summary.net_value >= 0 ? '+' : ''}
                  {formatCrores(data.summary.net_value)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {data.by_category.map((c) => (
                  <Badge key={c.deal_category} variant="outline" className="text-[10px]">
                    {c.deal_category} ({c.count})
                  </Badge>
                ))}
              </div>
            </div>

            {/* Breakdown by Security Table */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-primary" />
                Position Breakdown by Security
              </h3>
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Security</TableHead>
                      <TableHead className="text-right">Deals</TableHead>
                      <TableHead className="text-right">Net Qty</TableHead>
                      <TableHead className="text-right">Net Value</TableHead>
                      <TableHead className="text-right">Last Deal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.by_security.map((s) => (
                      <TableRow key={s.security_name}>
                        <TableCell className="font-bold text-foreground font-sans">
                          {s.security_name}
                        </TableCell>
                        <TableCell className="text-right font-mono">{s.deal_count}</TableCell>
                        <TableCell
                          className={`text-right font-mono font-bold ${
                            s.net_qty >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {Number(s.net_qty).toLocaleString()}
                        </TableCell>
                        <TableCell
                          className={`text-right font-mono font-bold ${
                            s.net_value >= 0
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {formatCrores(s.net_value)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground">
                          {s.last_deal_date}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Full Transaction History Table */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                All Disclosed Transactions ({data.deals.length})
              </h3>
              <div className="rounded-lg border border-border overflow-hidden max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Security</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.deals.map((d) => (
                      <TableRow key={`${d.deal_category}-${d.id}`}>
                        <TableCell className="font-mono text-muted-foreground">
                          {d.trade_date}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {d.deal_category}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-semibold text-foreground font-sans">
                          {d.security_name}
                        </TableCell>
                        <TableCell>
                          <Badge variant={d.action === 'BUY' ? 'positive' : 'negative'}>
                            {d.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {d.quantity ? Number(d.quantity).toLocaleString() : '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold text-foreground">
                          {d.total_value ? formatCrores(d.total_value) : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
