import React, { useState, useEffect, useCallback } from 'react';
import { Bell, Plus, Trash2, CheckCheck, ChevronDown, ChevronUp, BellRing, RefreshCw } from 'lucide-react';
import { api } from '../services/api';
import { PageHeader } from './common/PageHeader';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from './ui/table';
import ClientDrilldownModal from './ClientDrilldownModal';
import { cn } from '@/lib/utils';

const CATEGORIES = ['Insider Trading', 'SAST Deals', 'Block Deals', 'Bulk Deals'];

function formatValue(v) {
  const n = Number(v || 0);
  if (n === 0) return '-';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString('en-IN')}`;
}

export default function AlertsPanel({ onMatchesRefreshed }) {
  const [filters, setFilters] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [form, setForm] = useState({ name: '', category: '', action: '', min_value_lakhs: 0, keyword: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [filtersRes, matchesRes] = await Promise.all([api.getSavedFilters(), api.getAlertMatches()]);
      setFilters(filtersRes.filters || []);
      setResults(matchesRes.results || []);
      if (onMatchesRefreshed) onMatchesRefreshed(matchesRes.total_new_alerts || 0);
    } catch (err) {
      console.error('Failed to load alerts:', err);
      setError('Failed to load saved filters and matches.');
    } finally {
      setLoading(false);
    }
  }, [onMatchesRefreshed]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setCreating(true);
    try {
      await api.createSavedFilter({
        name: form.name.trim(),
        category: form.category || null,
        action: form.action || null,
        min_value_lakhs: Number(form.min_value_lakhs) || 0,
        keyword: form.keyword.trim() || null,
      });
      setForm({ name: '', category: '', action: '', min_value_lakhs: 0, keyword: '' });
      await refresh();
    } catch (err) {
      console.error('Failed to create filter:', err);
      setError('Failed to create saved filter.');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.deleteSavedFilter(id);
      await refresh();
    } catch (err) {
      console.error('Failed to delete filter:', err);
    }
  };

  const handleAcknowledge = async (id) => {
    try {
      await api.acknowledgeFilter(id);
      await refresh();
    } catch (err) {
      console.error('Failed to acknowledge filter:', err);
    }
  };

  const toggleExpand = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const totalNewAlerts = results.reduce((sum, r) => sum + (r.new_since_last_check || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Saved Filters & Deal Alerts"
        subtitle="Define recurring institutional filter rules and receive immediate notifications when matching disclosures appear"
        badge={totalNewAlerts > 0 ? `${totalNewAlerts} New Alert${totalNewAlerts > 1 ? 's' : ''}` : 'Real-Time Scanner'}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading}
          className="h-9 gap-1.5"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          <span>Refresh Feeds</span>
        </Button>
      </PageHeader>

      {/* Create Filter Card */}
      <Card>
        <CardHeader className="py-3 px-4 border-b border-border/60">
          <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" /> Create New Surveillance Rule
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {error && (
            <div className="p-3 mb-4 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs font-medium">
              {error}
            </div>
          )}

          <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div className="lg:col-span-2">
              <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Filter Name *</label>
              <Input
                type="text"
                required
                placeholder="e.g. Promoter Buys > ₹1 Cr"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-9 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">All Categories</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Action</label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Any Action</option>
                <option value="BUY">BUY Only</option>
                <option value="SELL">SELL Only</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Min ₹ Lakhs</label>
              <Input
                type="number"
                min="0"
                step="1"
                value={form.min_value_lakhs}
                onChange={(e) => setForm({ ...form, min_value_lakhs: e.target.value })}
                className="h-9 font-mono text-xs"
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-[10px] uppercase font-bold text-muted-foreground mb-1">Keyword</label>
                <Input
                  type="text"
                  placeholder="ticker, client..."
                  value={form.keyword}
                  onChange={(e) => setForm({ ...form, keyword: e.target.value })}
                  className="h-9 text-xs"
                />
              </div>
              <Button type="submit" disabled={creating} className="h-9 px-4 mt-auto">
                <Plus className="w-3.5 h-3.5 mr-1" /> Save
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Saved Filters List */}
      {results.length === 0 ? (
        <Card className="p-12 text-center text-xs text-muted-foreground">
          No saved filter rules yet. Configure one above to start continuous deal surveillance.
        </Card>
      ) : (
        <div className="space-y-4">
          {results.map((r) => {
            const f = r.filter;
            const isOpen = !!expanded[f.id];
            return (
              <Card key={f.id} className={cn(r.new_since_last_check > 0 && 'border-primary/40 shadow-sm')}>
                <CardHeader className="py-3 px-4 border-b border-border/60">
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        'p-2 rounded-lg border flex items-center justify-center',
                        r.new_since_last_check > 0 ? 'bg-destructive/10 border-destructive/30 text-destructive' : 'bg-muted border-border text-primary'
                      )}>
                        {r.new_since_last_check > 0 ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
                      </div>
                      <div>
                        <div className="text-sm font-bold text-foreground">{f.name}</div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <Badge variant="outline" className="text-[10px]">{f.category || 'All Categories'}</Badge>
                          {f.action && (
                            <Badge variant={f.action === 'BUY' ? 'positive' : 'negative'} className="text-[10px]">
                              {f.action}
                            </Badge>
                          )}
                          {f.min_value_lakhs > 0 && <Badge variant="secondary" className="text-[10px]">Min ₹{f.min_value_lakhs}L</Badge>}
                          {f.keyword && <Badge variant="secondary" className="text-[10px]">"{f.keyword}"</Badge>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-lg font-black font-mono text-foreground">{r.total_matching}</div>
                        <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Total Match</div>
                      </div>
                      {r.new_since_last_check > 0 && (
                        <div className="text-right">
                          <div className="text-lg font-black font-mono text-destructive">{r.new_since_last_check}</div>
                          <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Unseen</div>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        {r.new_since_last_check > 0 && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 text-positive"
                            onClick={() => handleAcknowledge(f.id)}
                            title="Mark as read"
                          >
                            <CheckCheck className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => toggleExpand(f.id)}
                          title="Toggle matches"
                        >
                          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(f.id)}
                          title="Delete filter"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                {isOpen && (
                  <CardContent className="p-0">
                    {r.matches.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-6 text-center">No matching deals recorded yet.</p>
                    ) : (
                      <div className="overflow-x-auto max-h-80">
                        <Table className="table-dense">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead>Category</TableHead>
                              <TableHead>Security</TableHead>
                              <TableHead>Client</TableHead>
                              <TableHead>Action</TableHead>
                              <TableHead className="text-right">Quantity</TableHead>
                              <TableHead className="text-right">Price</TableHead>
                              <TableHead className="text-right">Value</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody className="font-mono">
                            {r.matches.map((m) => (
                              <TableRow key={`${m.deal_category}-${m.id}`} className={cn(m.is_new && 'bg-primary/5 font-semibold')}>
                                <TableCell className="text-muted-foreground">{m.trade_date}</TableCell>
                                <TableCell className="font-sans">
                                  <Badge variant="outline" className="text-[10px]">{m.deal_category}</Badge>
                                </TableCell>
                                <TableCell className="font-sans font-bold text-foreground">{m.symbol || m.security_name}</TableCell>
                                <TableCell className="font-sans text-foreground">
                                  <button
                                    onClick={() => setSelectedClient(m.client_name)}
                                    className="font-bold hover:underline hover:text-primary transition-colors text-left"
                                  >
                                    {m.client_name}
                                  </button>
                                </TableCell>
                                <TableCell className="font-sans">
                                  <Badge variant={m.action === 'BUY' ? 'positive' : 'negative'} className="text-[10px]">
                                    {m.action}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">{m.quantity ? Number(m.quantity).toLocaleString() : '-'}</TableCell>
                                <TableCell className="text-right">{m.price ? `₹${Number(m.price).toFixed(2)}` : '-'}</TableCell>
                                <TableCell className="text-right font-bold text-primary">{formatValue(m.total_value)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {selectedClient && (
        <ClientDrilldownModal clientName={selectedClient} onClose={() => setSelectedClient(null)} />
      )}
    </div>
  );
}
