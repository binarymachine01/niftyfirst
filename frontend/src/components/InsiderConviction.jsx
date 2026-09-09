import React, { useState, useEffect } from 'react';
import {
  Gauge, Search, TrendingUp, TrendingDown, CheckCircle2, AlertTriangle,
  Info, ChevronRight, RefreshCw, ShieldCheck, ShieldAlert, ShieldQuestion,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';

function formatValue(v) {
  if (v === null || v === undefined) return '-';
  const n = Number(v);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

function ConfidenceBadge({ tier }) {
  const icons = { HIGH: ShieldCheck, MEDIUM: ShieldQuestion, LOW: ShieldAlert };
  const Icon = icons[tier] || ShieldQuestion;
  const variant = tier === 'HIGH' ? 'positive' : tier === 'MEDIUM' ? 'warning' : 'negative';
  return (
    <Badge variant={variant} className="inline-flex items-center gap-1 font-bold text-[10px]">
      <Icon className="w-3 h-3" /> {tier} CONFIDENCE
    </Badge>
  );
}

function ScoreGauge({ score }) {
  if (score === null || score === undefined) {
    return <div className="text-3xl font-black text-muted-foreground">N/A</div>;
  }
  const color = score >= 70 ? 'text-positive' : score >= 40 ? 'text-warning' : 'text-negative';
  return (
    <div className={cn('text-4xl font-black font-mono', color)}>
      {score.toFixed(0)}<span className="text-lg text-muted-foreground">/100</span>
    </div>
  );
}

export default function InsiderConviction({ initialSymbol = null }) {
  const [ranking, setRanking] = useState([]);
  const [rankingLoading, setRankingLoading] = useState(false);

  const [symbolInput, setSymbolInput] = useState(initialSymbol || '');
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [scoreDetail, setScoreDetail] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(null);

  const fetchRanking = async () => {
    setRankingLoading(true);
    try {
      const res = await api.getConvictionRanking({ limit: 25 });
      setRanking(res.ranking || []);
    } catch (err) {
      console.error('Failed to load conviction ranking:', err);
    } finally {
      setRankingLoading(false);
    }
  };

  useEffect(() => {
    fetchRanking();
  }, []);

  // Deep-link support from screener
  useEffect(() => {
    if (initialSymbol) {
      setSymbolInput(initialSymbol);
      inspectSymbol(initialSymbol);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSymbol]);

  const inspectSymbol = async (symbol) => {
    if (!symbol) return;
    const sym = symbol.trim().toUpperCase();
    setSelectedSymbol(sym);
    setDetailLoading(true);
    setDetailError(null);
    setScoreDetail(null);
    setExplanation(null);
    try {
      const [scoreRes, explRes] = await Promise.all([
        api.getConvictionScore(sym),
        api.getConvictionExplanation(sym),
      ]);
      setScoreDetail(scoreRes);
      setExplanation(explRes);
    } catch (err) {
      console.error('Failed to load conviction score:', err);
      setDetailError(err.response?.data?.detail || `Could not compute an Insider Conviction Score for '${sym}'.`);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    inspectSymbol(symbolInput);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <PageHeader
        title="Insider Conviction Engine"
        subtitle="Transparent 0-100 quantitative conviction score derived from observable insider filings and transaction conviction"
        badge="Scoring Algorithm"
      >
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="e.g. HINDUNILVR, INFY..."
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              className="h-9 w-44 pl-8 font-mono font-bold text-xs uppercase"
            />
          </div>
          <Button type="submit" size="sm" className="h-9">
            Score It
          </Button>
        </form>
      </PageHeader>

      {/* Conviction Leaderboard Ranking */}
      <Card>
        <CardHeader className="py-3 px-4 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xs font-bold uppercase tracking-wider">
                Top Conviction Ranking (Active Insider Activity, Last 180 Days)
              </CardTitle>
              <CardDescription className="text-xs">
                Highest ranked securities based on multi-factor insider accumulation
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={fetchRanking}
              disabled={rankingLoading}
            >
              <RefreshCw className={cn('w-3.5 h-3.5', rankingLoading && 'animate-spin')} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {ranking.length === 0 ? (
            <p className="text-xs text-muted-foreground py-12 text-center">
              {rankingLoading ? 'Computing conviction scores...' : 'No symbols with qualifying insider activity found in current lookback window.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="table-dense">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Rank</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Confidence</TableHead>
                    <TableHead className="text-right">Net Buying</TableHead>
                    <TableHead>Data Coverage</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono">
                  {ranking.map((r) => (
                    <TableRow
                      key={r.symbol}
                      onClick={() => inspectSymbol(r.symbol)}
                      className={cn(
                        'cursor-pointer hover:bg-muted/50 transition-colors',
                        selectedSymbol === r.symbol && 'bg-primary/10'
                      )}
                    >
                      <TableCell className="text-muted-foreground font-bold">#{r.rank}</TableCell>
                      <TableCell className="font-bold text-foreground">{r.symbol}</TableCell>
                      <TableCell className="text-right font-bold">
                        <span className={cn(
                          r.overall_score >= 70 ? 'text-positive' : r.overall_score >= 40 ? 'text-warning' : 'text-negative'
                        )}>
                          {r.overall_score?.toFixed(0)}
                        </span>
                      </TableCell>
                      <TableCell className="font-sans">
                        <ConfidenceBadge tier={r.confidence} />
                      </TableCell>
                      <TableCell className={cn('text-right font-bold', (r.net_buying_value || 0) >= 0 ? 'text-positive' : 'text-negative')}>
                        {r.net_buying_value !== null ? formatValue(r.net_buying_value) : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground font-sans text-xs">
                        {r.components_available}/{r.components_total} components
                      </TableCell>
                      <TableCell className="text-right">
                        <ChevronRight className="w-4 h-4 text-muted-foreground inline-block" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading state for single stock detail */}
      {detailLoading && (
        <Card className="p-12 text-center text-xs text-muted-foreground">
          <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin inline-block mr-2 align-middle" />
          Computing Insider Conviction Score for {selectedSymbol}...
        </Card>
      )}

      {detailError && (
        <Card className="border-destructive/40 bg-destructive/10 text-destructive text-xs p-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>{detailError}</span>
        </Card>
      )}

      {/* Detail Panel */}
      {scoreDetail && explanation && !detailLoading && (
        <div className="space-y-6">
          {/* Detailed Score Header Card */}
          <Card>
            <CardHeader className="py-4 px-6 border-b border-border/60">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-5">
                  <ScoreGauge score={scoreDetail.overall_score} />
                  <div>
                    <div className="text-xl font-black text-foreground font-mono">{scoreDetail.symbol}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{explanation.components_summary}</div>
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                      Model {scoreDetail.model_version} · As of {scoreDetail.as_of_date}
                    </div>
                  </div>
                </div>
                <ConfidenceBadge tier={scoreDetail.confidence.tier} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table className="table-dense">
                <TableHeader>
                  <TableRow>
                    <TableHead>Component Factor</TableHead>
                    <TableHead className="text-right">Factor Score</TableHead>
                    <TableHead className="text-right">Configured Weight</TableHead>
                    <TableHead className="text-right">Normalized Weight</TableHead>
                    <TableHead className="text-right">Weighted Contribution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono">
                  {Object.entries(scoreDetail.components).map(([key, c]) => (
                    <TableRow key={key} className={!c.available ? 'opacity-50' : ''}>
                      <TableCell className="font-sans font-bold text-foreground">{c.label}</TableCell>
                      <TableCell className="text-right">{c.available ? c.score.toFixed(0) : 'N/A'}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{c.configured_weight_pct.toFixed(0)}%</TableCell>
                      <TableCell className="text-right text-muted-foreground">{c.available ? `${c.normalized_weight_pct.toFixed(1)}%` : '-'}</TableCell>
                      <TableCell className="text-right font-bold text-primary">
                        {c.available ? `${c.score.toFixed(0)} × ${c.normalized_weight_pct.toFixed(1)}% = ${c.weighted_contribution.toFixed(1)}` : 'Unavailable'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Why This Score Card */}
          <Card>
            <CardHeader className="py-3 px-4 border-b border-border/60">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <Info className="w-4 h-4 text-primary" /> Conviction Factor Attribution Drivers
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="text-xs font-bold text-positive uppercase tracking-wider mb-2">Positive Factors</div>
                  {explanation.positive.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No positive contributors identified.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {explanation.positive.map((p, i) => (
                        <li key={i} className="text-xs text-foreground flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-positive flex-shrink-0 mt-0.5" />
                          <span>{p}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-warning uppercase tracking-wider mb-2">Caution / Missing-Data Factors</div>
                  {explanation.negative.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No negative factors or missing-data flags.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {explanation.negative.map((n, i) => (
                        <li key={i} className="text-xs text-foreground flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-warning flex-shrink-0 mt-0.5" />
                          <span>{n}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="pt-3 border-t border-border text-[11px] text-muted-foreground font-mono">
                {explanation.confidence_summary}
              </div>
              <p className="text-[10px] text-muted-foreground italic">{explanation.disclaimer}</p>
            </CardContent>
          </Card>

          {/* Supporting Transactions Card */}
          <Card>
            <CardHeader className="py-3 px-4 border-b border-border/60">
              <CardTitle className="text-xs font-bold uppercase tracking-wider">
                Supporting Transactions ({scoreDetail.supporting_transactions.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {scoreDetail.supporting_transactions.length === 0 ? (
                <p className="text-xs text-muted-foreground py-6 text-center">No transactions recorded in the current lookback window.</p>
              ) : (
                <div className="overflow-x-auto max-h-80">
                  <Table className="table-dense">
                    <TableHeader className="sticky top-0 bg-muted/90 backdrop-blur z-10">
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Insider / Client</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="font-mono">
                      {scoreDetail.supporting_transactions.map((t) => (
                        <TableRow key={`${t.deal_category}-${t.id}`}>
                          <TableCell className="text-muted-foreground">{t.trade_date}</TableCell>
                          <TableCell className="font-sans">
                            <Badge variant="outline" className="text-[10px]">{t.deal_category}</Badge>
                          </TableCell>
                          <TableCell className="font-sans text-foreground truncate max-w-[180px]" title={t.client_name}>
                            {t.client_name || 'N/A'}
                          </TableCell>
                          <TableCell className="font-sans text-muted-foreground">{t.role || 'Unavailable'}</TableCell>
                          <TableCell className="font-sans">
                            <Badge variant={t.action === 'BUY' ? 'positive' : 'negative'} className="text-[10px]">
                              {t.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{t.quantity ? Number(t.quantity).toLocaleString() : '-'}</TableCell>
                          <TableCell className="text-right font-bold text-primary">
                            {t.total_value ? formatValue(t.total_value) : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
