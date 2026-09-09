import React, { useState, useEffect, useCallback } from 'react';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import LoadingState from '@/components/common/LoadingState';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ShieldAlert,
  ShieldQuestion,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Link2,
  History,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  X,
  Check,
} from 'lucide-react';
import { api } from '@/services/api';
import { formatCrores } from '@/lib/utils';
import { toast } from 'sonner';

function StatusBadge({ status }) {
  const s = status?.toUpperCase();
  if (s === 'MATCHED') return <Badge variant="positive">MATCHED</Badge>;
  if (s === 'LOW_CONFIDENCE') return <Badge variant="warning">LOW CONFIDENCE</Badge>;
  if (s === 'UNMATCHED') return <Badge variant="negative">UNMATCHED</Badge>;
  if (s === 'MANUAL_OVERRIDE') return <Badge variant="override">MANUAL OVERRIDE</Badge>;
  return <Badge variant="outline">{status || 'N/A'}</Badge>;
}

function MapModal({ item, onClose, onSaved }) {
  const [candidates, setCandidates] = useState(item.candidates || []);
  const [selectedSymbol, setSelectedSymbol] = useState(item.resolved_nse_symbol || '');
  const [customSymbol, setCustomSymbol] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!item.candidates || item.candidates.length === 0) {
      api
        .getMatchCandidates(item.original_security_name)
        .then((res) => setCandidates(res.candidates || []))
        .catch(() => {});
    }
  }, [item]);

  const handleSave = async () => {
    const symbol = (customSymbol || selectedSymbol || '').trim().toUpperCase();
    if (!symbol) {
      setError('Select a candidate or enter an NSE symbol.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.createSymbolMapping({
        original_security_name: item.original_security_name,
        resolved_nse_symbol: symbol,
      });
      toast.success(`Mapped to NSE symbol ${symbol}`);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save mapping.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-primary" />
            Map Security to NSE Symbol
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {item.original_security_name}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">
            {error}
          </div>
        )}

        {candidates.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Automated Candidates
            </Label>
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {candidates.map((c, i) => (
                <div
                  key={i}
                  onClick={() => {
                    setSelectedSymbol(c.symbol);
                    setCustomSymbol('');
                  }}
                  className={`flex items-center justify-between p-2.5 rounded-md border text-xs cursor-pointer transition-all ${
                    selectedSymbol === c.symbol && !customSymbol
                      ? 'border-primary bg-primary/[0.08] font-bold text-foreground'
                      : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-foreground">{c.symbol}</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {c.method}
                    </Badge>
                  </div>
                  <span className="font-mono text-xs font-bold text-foreground">
                    {(c.confidence * 100).toFixed(0)}% Match
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5 pt-2">
          <Label htmlFor="manual-symbol" className="text-xs">
            Or Enter NSE Symbol Manually
          </Label>
          <Input
            id="manual-symbol"
            type="text"
            placeholder="e.g. RELIANCE, TCS, INFY"
            value={customSymbol}
            onChange={(e) => setCustomSymbol(e.target.value.toUpperCase())}
            className="font-mono text-xs uppercase"
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Manual Override'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SymbolMatching() {
  const [activeTab, setActiveTab] = useState('unmatched');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [mappingTarget, setMappingTarget] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [history, setHistory] = useState({});

  const [validation, setValidation] = useState(null);
  const [showRematchModal, setShowRematchModal] = useState(false);
  const [rematchConfirmText, setRematchConfirmText] = useState('');
  const [rematching, setRematching] = useState(false);
  const [rematchError, setRematchError] = useState(null);
  const [rematchResult, setRematchResult] = useState(null);

  const fetchValidation = useCallback(async () => {
    try {
      const res = await api.validateSymbolMappings();
      setValidation(res);
    } catch (err) {
      console.error('Failed to load symbol mapping validation:', err);
    }
  }, []);

  useEffect(() => {
    fetchValidation();
  }, [fetchValidation]);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let res;
      if (activeTab === 'unmatched') res = await api.getUnmatchedSecurities(search);
      else if (activeTab === 'low_confidence') res = await api.getLowConfidenceSecurities(search);
      else
        res = await api.getAllMappings({
          search: search || undefined,
          status: activeTab === 'all' ? undefined : activeTab.toUpperCase(),
        });
      setRows(res.unmatched || res.low_confidence || res.mappings || []);
    } catch (err) {
      console.error('Failed to load symbol mappings:', err);
      setError('Failed to load symbol mapping data.');
      toast.error('Failed to load symbol mapping data');
    } finally {
      setLoading(false);
    }
  }, [activeTab, search]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleRemoveOverride = async (mappingId) => {
    try {
      await api.removeSymbolMapping(mappingId);
      toast.success('Manual override removed');
      fetchRows();
    } catch (err) {
      console.error('Failed to remove override:', err);
      toast.error('Failed to remove override');
    }
  };

  const handleRematch = async () => {
    setRematching(true);
    setRematchError(null);
    try {
      const res = await api.rematchSymbols(rematchConfirmText);
      setRematchResult(res);
      setRematchConfirmText('');
      toast.success('Re-match complete');
      await fetchRows();
      await fetchValidation();
    } catch (err) {
      setRematchError(err.response?.data?.detail || 'Unable to re-match symbols.');
    } finally {
      setRematching(false);
    }
  };

  const closeRematchModal = () => {
    setShowRematchModal(false);
    setRematchConfirmText('');
    setRematchError(null);
    setRematchResult(null);
  };

  const toggleHistory = async (row) => {
    if (expandedRow === row.mapping_id) {
      setExpandedRow(null);
      return;
    }
    setExpandedRow(row.mapping_id);
    if (!history[row.mapping_id]) {
      try {
        const res = await api.getMappingHistory(row.mapping_id);
        setHistory((prev) => ({ ...prev, [row.mapping_id]: res.history || [] }));
      } catch (err) {
        console.error('Failed to load history:', err);
      }
    }
  };

  const tabs = [
    { id: 'unmatched', label: 'Unmatched', icon: XCircle },
    { id: 'low_confidence', label: 'Low Confidence', icon: ShieldQuestion },
    { id: 'manual_override', label: 'Manual Overrides', icon: Link2 },
    { id: 'matched', label: 'Matched', icon: CheckCircle2 },
    { id: 'all', label: 'All', icon: Search },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Symbol Governance & Master Matching"
        description="Verify and control how disclosed entity names resolve to NSE market symbols. Unmatched and Low Confidence records are strictly quarantined from backtesting."
        badge="NSE Safety Gate"
        actions={
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowRematchModal(true)}
            className="gap-1.5 text-xs font-bold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Clear & Re-Match Symbols
          </Button>
        }
      />

      {/* Validation Alert */}
      {validation && !validation.valid && (
        <div className="p-3.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs flex items-center gap-2 font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>
            {validation.invalid_resolved_symbol_count} mapping(s) resolve to a symbol no longer in the active NSE universe. ({validation.invalid_manual_override_count} manual override(s) require review).
          </span>
        </div>
      )}

      {/* Main Governance Workspace Card */}
      <Card>
        <CardHeader className="p-4 sm:p-5 border-b border-border/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Governance Status Navigation Tabs */}
            <div className="flex items-center gap-1 p-1 rounded-lg bg-muted border border-border/60 overflow-x-auto">
              {tabs.map((t) => {
                const Icon = t.icon;
                const isActive = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setActiveTab(t.id);
                      setExpandedRow(null);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-all whitespace-nowrap ${
                      isActive
                        ? 'bg-card text-foreground shadow-xs font-bold'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{t.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-56">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search security name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs h-8"
              />
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-6">
              <LoadingState mode="table" rows={6} />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={`No ${activeTab.replace('_', ' ')} securities found`}
              description="All security disclosures have been evaluated according to the current governance rules."
            />
          ) : (
            <div className="relative overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[220px]">Security Name (Filing)</TableHead>
                    <TableHead className="w-36">NSE Symbol</TableHead>
                    <TableHead className="w-28 text-right">Confidence</TableHead>
                    <TableHead className="w-28">Method</TableHead>
                    <TableHead className="w-36">Governance Status</TableHead>
                    <TableHead className="text-right w-20">Deals</TableHead>
                    <TableHead className="text-right w-28">Turnover</TableHead>
                    <TableHead className="w-24">Last Deal</TableHead>
                    <TableHead className="text-right w-36">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, idx) => (
                    <React.Fragment key={row.mapping_id || row.original_security_name || idx}>
                      <TableRow className="hover:bg-muted/40">
                        <TableCell className="font-bold text-foreground text-xs font-sans">
                          {row.original_security_name}
                        </TableCell>
                        <TableCell>
                          {row.resolved_nse_symbol ? (
                            <Badge variant="secondary" className="font-mono text-xs font-bold">
                              {row.resolved_nse_symbol}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground/60 text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold">
                          {row.confidence !== null && row.confidence !== undefined
                            ? `${(Number(row.confidence) * 100).toFixed(0)}%`
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {row.match_method || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.match_status} />
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.deal_count || row.deals_count || '—'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-bold text-foreground">
                          {formatCrores(row.total_value)}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">
                          {row.last_deal_date || '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() => setMappingTarget(row)}
                              className="text-[11px] h-7 px-2"
                            >
                              Map
                            </Button>
                            {row.match_status === 'MANUAL_OVERRIDE' && (
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => handleRemoveOverride(row.mapping_id)}
                                className="text-[11px] h-7 px-2 text-rose-600 hover:text-rose-700"
                              >
                                Revert
                              </Button>
                            )}
                            {row.mapping_id && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => toggleHistory(row)}
                                title="Audit History"
                              >
                                <History className="w-3.5 h-3.5 text-muted-foreground" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                      {/* Expandable Audit History Row */}
                      {expandedRow === row.mapping_id && (
                        <TableRow className="bg-muted/20">
                          <TableCell colSpan={9} className="p-4">
                            <div className="space-y-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                                Governance Audit History
                              </span>
                              {history[row.mapping_id]?.length > 0 ? (
                                <div className="rounded-md border border-border overflow-hidden bg-card">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Timestamp</TableHead>
                                        <TableHead>Old Symbol</TableHead>
                                        <TableHead>New Symbol</TableHead>
                                        <TableHead>User / Source</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {history[row.mapping_id].map((h, i) => (
                                        <TableRow key={i}>
                                          <TableCell className="font-mono text-xs text-muted-foreground">
                                            {h.created_at}
                                          </TableCell>
                                          <TableCell className="font-mono text-xs">{h.old_symbol || '—'}</TableCell>
                                          <TableCell className="font-mono text-xs font-bold text-foreground">
                                            {h.new_symbol}
                                          </TableCell>
                                          <TableCell className="text-xs text-muted-foreground">
                                            {h.changed_by || 'System'}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">No prior revisions recorded.</p>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Manual Map Dialog */}
      {mappingTarget && (
        <MapModal
          item={mappingTarget}
          onClose={() => setMappingTarget(null)}
          onSaved={() => {
            setMappingTarget(null);
            fetchRows();
            fetchValidation();
          }}
        />
      )}

      {/* Clear & Re-Match Confirmation Dialog */}
      <Dialog open={showRematchModal} onOpenChange={setShowRematchModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-4 h-4" />
              Clear & Re-Match NSE Symbols
            </DialogTitle>
            <DialogDescription>
              This action purges automated matches and re-runs the fuzzy matcher across all historical deals against the active NSE symbol master. Manual overrides will be preserved.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Label htmlFor="confirm-clear" className="text-xs font-semibold">
              Type <span className="font-mono font-bold text-rose-600 dark:text-rose-400">CLEAR</span> to confirm:
            </Label>
            <Input
              id="confirm-clear"
              type="text"
              placeholder="CLEAR"
              value={rematchConfirmText}
              onChange={(e) => setRematchConfirmText(e.target.value)}
              className="font-mono text-xs uppercase"
            />

            {rematchError && (
              <div className="p-3 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs">
                {rematchError}
              </div>
            )}

            {rematchResult && (
              <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-mono">
                Re-matching complete: {rematchResult.matched_count || 0} matched, {rematchResult.unmatched_count || 0} unmatched.
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={closeRematchModal}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleRematch}
              disabled={rematchConfirmText !== 'CLEAR' || rematching}
            >
              {rematching ? 'Re-Matching...' : 'Confirm Re-Match'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
