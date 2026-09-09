import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, AlertCircle, ArrowUpRight, ArrowDownRight, Gauge, Info, CheckCircle2, AlertTriangle,
  ShieldCheck, ShieldAlert, ShieldQuestion, Users, Repeat, TrendingUp, Layers, Clock, BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api } from '../services/api';
import ClientDrilldownModal from './ClientDrilldownModal';
import { PageHeader } from './common/PageHeader';
import { MetricCard } from './common/MetricCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
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

const RANGE_OPTIONS = [
  { key: '1M', days: 30 },
  { key: '3M', days: 91 },
  { key: '6M', days: 182 },
  { key: '1Y', days: 365 },
  { key: '3Y', days: 1095 },
  { key: '5Y', days: 1825 },
  { key: 'MAX', days: null },
];

const HISTORICAL_WINDOW_LABELS = { '1d': '1D', '5d': '5D', '10d': '10D', '20d': '20D', '60d': '60D' };

function formatValue(v) {
  if (v === null || v === undefined) return 'N/A';
  const n = Number(v);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)} Cr`;
  if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN')}`;
}

function Pct({ value }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">N/A</span>;
  const isUp = value >= 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-bold font-mono', isUp ? 'text-positive' : 'text-negative')}>
      {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {isUp ? '+' : ''}{value.toFixed(2)}%
    </span>
  );
}

function SignalBadge({ tier }) {
  const variantMap = {
    'VERY STRONG': 'positive',
    STRONG: 'default',
    MODERATE: 'warning',
    WEAK: 'outline',
  };
  return (
    <Badge variant={variantMap[tier] || 'outline'} className="font-bold tracking-wider uppercase text-[10px]">
      {tier || 'N/A'}
    </Badge>
  );
}

function ConfidenceBadge({ tier }) {
  const icons = { HIGH: ShieldCheck, MEDIUM: ShieldQuestion, LOW: ShieldAlert };
  const Icon = icons[tier] || ShieldQuestion;
  const variant = tier === 'HIGH' ? 'positive' : tier === 'MEDIUM' ? 'warning' : 'negative';
  return (
    <Badge variant={variant} className="inline-flex items-center gap-1 font-bold text-[10px]">
      <Icon className="w-3 h-3" /> {tier || 'N/A'} CONFIDENCE
    </Badge>
  );
}

function computeSMASeries(candles, window) {
  return candles.map((_, i) => {
    if (i < window - 1) return null;
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += candles[j].close;
    return Number((sum / window).toFixed(2));
  });
}

function CandleShape(props) {
  const { x, y, width, height, payload } = props;
  const { open, close, high, low } = payload;
  if (high == null || low == null || high === low || width <= 0) return null;
  const priceToY = (price) => y + height - ((price - low) / (high - low)) * height;
  const isUp = close >= open;
  const color = isUp ? 'var(--positive, #10b981)' : 'var(--negative, #f43f5e)';
  const bodyTop = priceToY(Math.max(open, close));
  const bodyBottom = priceToY(Math.min(open, close));
  const bodyHeight = Math.max(bodyBottom - bodyTop, 1);
  const wickX = x + width / 2;
  const bodyX = x + width * 0.15;
  const bodyWidth = width * 0.7;
  return (
    <g>
      <line x1={wickX} y1={y} x2={wickX} y2={y + height} stroke={color} strokeWidth={1} />
      <rect x={bodyX} y={bodyTop} width={bodyWidth} height={bodyHeight} fill={color} />
    </g>
  );
}

function BuyMarkerShape({ cx, cy }) {
  if (cx == null || cy == null) return null;
  return <path d={`M ${cx} ${cy - 5} L ${cx - 5} ${cy + 4} L ${cx + 5} ${cy + 4} Z`} fill="#10b981" stroke="#fff" strokeWidth={0.5} />;
}

function SellMarkerShape({ cx, cy }) {
  if (cx == null || cy == null) return null;
  return <path d={`M ${cx} ${cy + 5} L ${cx - 5} ${cy - 4} L ${cx + 5} ${cy - 4} Z`} fill="#f43f5e" stroke="#fff" strokeWidth={0.5} />;
}

export default function StockInspector({ theme = 'dark' }) {
  const [symbol, setSymbol] = useState('HINDUNILVR');
  const [inputSymbol, setInputSymbol] = useState('HINDUNILVR');
  const [history, setHistory] = useState([]);
  const [intel, setIntel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [range, setRange] = useState('1Y');
  const [showDma20, setShowDma20] = useState(true);
  const [showDma50, setShowDma50] = useState(true);
  const [showDma200, setShowDma200] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);

  const isLight = theme === 'light';

  const fetchStockData = async (sym) => {
    setLoading(true);
    setError(null);
    try {
      const [histRes, intelRes] = await Promise.all([
        api.getStockHistory(sym),
        api.getStockIntelligence(sym),
      ]);
      setHistory(histRes.candles || []);
      setIntel(intelRes);
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.detail || `Could not load data for symbol '${sym}'. Please ensure it is present in the NSE Market Data repository.`);
      setHistory([]);
      setIntel(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStockData(symbol);
  }, [symbol]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputSymbol.trim()) setSymbol(inputSymbol.trim().toUpperCase());
  };

  const rangedCandles = useMemo(() => {
    const opt = RANGE_OPTIONS.find((r) => r.key === range);
    if (!opt || !opt.days || history.length === 0) return history;
    const latestDate = new Date(history[history.length - 1].trade_date);
    const cutoff = new Date(latestDate);
    cutoff.setDate(cutoff.getDate() - opt.days);
    return history.filter((c) => new Date(c.trade_date) >= cutoff);
  }, [history, range]);

  const chartData = useMemo(() => {
    if (rangedCandles.length === 0) return [];
    const dma20 = computeSMASeries(rangedCandles, 20);
    const dma50 = computeSMASeries(rangedCandles, 50);
    const dma200 = computeSMASeries(rangedCandles, 200);
    const txByDate = {};
    (intel?.transactions || []).forEach((t) => {
      if (!txByDate[t.trade_date]) txByDate[t.trade_date] = [];
      txByDate[t.trade_date].push(t);
    });
    return rangedCandles.map((c, i) => {
      const txs = txByDate[c.trade_date] || null;
      const hasBuy = txs?.some((t) => t.action === 'BUY');
      const hasSell = txs?.some((t) => t.action === 'SELL');
      return {
        ...c,
        range: [c.low, c.high],
        dma20: showDma20 ? dma20[i] : null,
        dma50: showDma50 ? dma50[i] : null,
        dma200: showDma200 ? dma200[i] : null,
        transactions: txs,
        buyMarker: hasBuy ? c.high * 1.03 : null,
        sellMarker: hasSell ? c.low * 0.97 : null,
      };
    });
  }, [rangedCandles, intel, showDma20, showDma50, showDma200]);

  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 100];
    const lows = chartData.map((c) => c.low);
    const highs = chartData.map((c) => c.high);
    return [Math.floor(Math.min(...lows) * 0.96), Math.ceil(Math.max(...highs) * 1.06)];
  }, [chartData]);

  const header = intel?.header;
  const conviction = intel?.conviction;
  const signal = intel?.signal;
  const insiderActivity = intel?.insider_activity;
  const technical = intel?.technical;
  const explanation = intel?.explanation;

  return (
    <div className="space-y-6">
      {/* Top Page Header */}
      <PageHeader
        title="Stock Intelligence"
        subtitle="Price action, insider & deal disclosures, conviction scoring, and historical signal efficacy"
        badge="Multi-Source Research"
      >
        <form onSubmit={handleSubmit} className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="e.g. HINDUNILVR, INFY..."
              value={inputSymbol}
              onChange={(e) => setInputSymbol(e.target.value)}
              className="h-9 w-44 pl-8 font-mono font-bold text-xs uppercase"
            />
          </div>
          <Button type="submit" size="sm" className="h-9">
            Inspect Ticker
          </Button>
        </form>
      </PageHeader>

      {/* Quick Select Symbols */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Quick Select:</span>
        {['HINDUNILVR', 'INFY', 'TCS', 'RELIANCE', 'SBIN', '20MICRONS', 'RAVINDRA'].map((s) => (
          <Button
            key={s}
            variant={symbol === s ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => { setInputSymbol(s); setSymbol(s); }}
            className={cn('h-7 px-2.5 font-mono text-[11px] font-bold', symbol === s && 'border-primary text-primary')}
          >
            {s}
          </Button>
        ))}
      </div>

      {error && (
        <Card className="border-destructive/40 bg-destructive/10 text-destructive text-xs p-4 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </Card>
      )}

      {loading && !intel && (
        <Card className="p-12 text-center text-xs text-muted-foreground">
          <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin inline-block mr-2 align-middle" />
          Loading stock intelligence for {symbol}...
        </Card>
      )}

      {header && (
        <>
          {/* Key Metrics Header Bar */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard
              label={intel.symbol}
              value={header.latest_price !== null ? `₹${header.latest_price.toFixed(2)}` : 'N/A'}
              change={header.change_pct !== null && header.change_pct !== undefined ? `${header.change >= 0 ? '+' : ''}${header.change?.toFixed(2)} (${header.change_pct?.toFixed(2)}%)` : null}
              changeType={header.change >= 0 ? 'positive' : 'negative'}
              description={header.company_name || `As of ${intel.as_of_date}`}
            />
            <MetricCard
              label="52-Week Range"
              value={header.week_52_high !== null ? `₹${header.week_52_high.toFixed(0)}` : 'N/A'}
              description={`Low: ${header.week_52_low !== null ? `₹${header.week_52_low.toFixed(0)}` : 'N/A'}`}
            />
            <MetricCard
              label="Insider Conviction"
              value={conviction?.overall_score !== null && conviction?.overall_score !== undefined ? `${conviction.overall_score.toFixed(0)}/100` : 'N/A'}
              changeType={conviction?.overall_score >= 70 ? 'positive' : conviction?.overall_score >= 40 ? 'neutral' : 'negative'}
              description={<SignalBadge tier={signal?.tier} />}
            />
            <MetricCard
              label="Data Confidence"
              value={conviction?.confidence?.tier || 'N/A'}
              description={<ConfidenceBadge tier={conviction?.confidence?.tier} />}
            />
          </div>

          {/* Stock Intelligence Summary */}
          <Card>
            <CardHeader className="py-3 px-4 border-b border-border/60">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <Gauge className="w-4 h-4 text-primary" /> Technical & Disclosure Overview
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
                <div>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Insider Activity</div>
                  <div className="font-semibold text-foreground">
                    {insiderActivity?.net_value === null ? 'No activity' : insiderActivity.net_value >= 0 ? 'Net buying' : 'Net selling'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Price Trend</div>
                  <div className="font-semibold text-foreground">
                    {technical?.dma?.above_dma_50 === true ? 'Bullish (>50 DMA)' : technical?.dma?.above_dma_50 === false ? 'Bearish (<50 DMA)' : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Volume Ratio</div>
                  <div className="font-semibold text-foreground font-mono">
                    {technical?.volume_ratio !== null && technical?.volume_ratio !== undefined ? `${technical.volume_ratio.toFixed(2)}× avg` : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Delivery</div>
                  <div className="font-semibold text-foreground">
                    {technical?.delivery?.delivery_increase === null ? 'N/A' : technical.delivery.delivery_increase > 0 ? 'Improving' : technical.delivery.delivery_increase < 0 ? 'Declining' : 'Flat'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">20D Win Rate</div>
                  <div className="font-semibold text-foreground font-mono">
                    {intel.historical_signal_performance?.primary_20d?.available
                      ? `${intel.historical_signal_performance.primary_20d.pct_positive.toFixed(0)}%`
                      : 'N/A'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Signal Tier</div>
                  <SignalBadge tier={signal?.tier} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Interactive Chart Card */}
          <Card>
            <CardHeader className="py-3 px-4 border-b border-border/60">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg border border-border">
                  {RANGE_OPTIONS.map((r) => (
                    <Button
                      key={r.key}
                      variant={range === r.key ? 'default' : 'ghost'}
                      size="sm"
                      onClick={() => setRange(r.key)}
                      className="h-7 px-2.5 text-xs font-bold"
                    >
                      {r.key}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-xs font-medium">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={showDma20} onChange={(e) => setShowDma20(e.target.checked)} className="rounded text-primary focus:ring-0" />
                    <span className="text-amber-500 font-mono font-bold">20 DMA</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={showDma50} onChange={(e) => setShowDma50(e.target.checked)} className="rounded text-primary focus:ring-0" />
                    <span className="text-sky-500 font-mono font-bold">50 DMA</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={showDma200} onChange={(e) => setShowDma200(e.target.checked)} className="rounded text-primary focus:ring-0" />
                    <span className="text-purple-500 font-mono font-bold">200 DMA</span>
                  </label>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4">
              {chartData.length === 0 ? (
                <p className="text-xs text-muted-foreground py-16 text-center">No price data available for the selected range.</p>
              ) : (
                <>
                  <div className="h-96 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={isLight ? 'rgba(148,163,184,0.2)' : 'rgba(255,255,255,0.06)'} vertical={false} />
                        <XAxis dataKey="trade_date" stroke={isLight ? '#64748b' : '#94a3b8'} fontSize={10} tickLine={false} minTickGap={40} />
                        <YAxis domain={yDomain} stroke={isLight ? '#64748b' : '#94a3b8'} fontSize={11} tickLine={false} tickFormatter={(v) => `₹${v.toFixed(0)}`} width={65} />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload || !payload.length) return null;
                            const d = payload[0].payload;
                            return (
                              <div className="bg-popover border border-border p-3 rounded-lg shadow-xl text-xs font-mono max-w-xs">
                                <div className="text-muted-foreground mb-1 font-sans font-medium">{label}</div>
                                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                                  <div>O: <span className="text-foreground font-bold">₹{d.open?.toFixed(2)}</span></div>
                                  <div>H: <span className="text-positive font-bold">₹{d.high?.toFixed(2)}</span></div>
                                  <div>L: <span className="text-negative font-bold">₹{d.low?.toFixed(2)}</span></div>
                                  <div>C: <span className="text-primary font-bold">₹{d.close?.toFixed(2)}</span></div>
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-2 pt-1 border-t border-border flex justify-between font-sans">
                                  <span>Vol: {d.volume?.toLocaleString() ?? 'N/A'}</span>
                                  <span>Del: {d.delivery_pct !== null && d.delivery_pct !== undefined ? `${d.delivery_pct}%` : 'N/A'}</span>
                                </div>
                                {d.transactions && (
                                  <div className="mt-2 pt-1 border-t border-border space-y-1 font-sans">
                                    {d.transactions.map((t, i) => (
                                      <div key={i} className="text-[10px]">
                                        <span className={t.action === 'BUY' ? 'text-positive font-bold' : 'text-negative font-bold'}>{t.action}</span>
                                        {' '}{t.deal_category} · {t.role || 'N/A'} · {t.client_name || 'N/A'} · {t.total_value ? formatValue(t.total_value) : 'N/A'}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="range" shape={<CandleShape />} isAnimationActive={false} />
                        {showDma20 && <Line type="monotone" dataKey="dma20" stroke="#f59e0b" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
                        {showDma50 && <Line type="monotone" dataKey="dma50" stroke="#0ea5e9" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
                        {showDma200 && <Line type="monotone" dataKey="dma200" stroke="#a855f7" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />}
                        <Scatter dataKey="buyMarker" shape={<BuyMarkerShape />} isAnimationActive={false} />
                        <Scatter dataKey="sellMarker" shape={<SellMarkerShape />} isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Volume Panel */}
                  <div className="h-16 w-full mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                        <XAxis dataKey="trade_date" hide />
                        <YAxis hide />
                        <Bar dataKey="volume" isAnimationActive={false}>
                          {chartData.map((d, i) => (
                            <Cell key={i} fill={d.close >= d.open ? '#10b98180' : '#f43f5e80'} />
                          ))}
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div className="text-[10px] text-muted-foreground text-right font-mono -mt-1">Volume</div>
                  </div>

                  {/* Delivery Panel */}
                  <div className="h-16 w-full mt-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                        <XAxis dataKey="trade_date" hide />
                        <YAxis hide domain={[0, 100]} />
                        {technical?.delivery?.avg_delivery_pct !== null && technical?.delivery?.avg_delivery_pct !== undefined && (
                          <ReferenceLine y={technical.delivery.avg_delivery_pct} stroke="#94a3b8" strokeDasharray="4 4" />
                        )}
                        <Line type="monotone" dataKey="delivery_pct" stroke="#06b6d4" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <div className="text-[10px] text-muted-foreground text-right font-mono -mt-1">
                      Delivery % {technical?.delivery?.avg_delivery_pct !== null && technical?.delivery?.avg_delivery_pct !== undefined ? `(avg: ${technical.delivery.avg_delivery_pct.toFixed(0)}%)` : ''}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Insider Activity + Repeat Buyers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="py-3 px-4 border-b border-border/60">
                <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" /> Insider Activity
                  <span className="text-[10px] font-normal text-muted-foreground">({insiderActivity?.window_days}D window)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                <div className="grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Buying Value</div>
                    <div className="font-bold text-positive text-lg font-mono">{formatValue(insiderActivity?.buy_value)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Selling Value</div>
                    <div className="font-bold text-negative text-lg font-mono">{formatValue(insiderActivity?.sell_value)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Net Buying</div>
                    <div className={cn('font-bold text-lg font-mono', (insiderActivity?.net_value || 0) >= 0 ? 'text-positive' : 'text-negative')}>
                      {(insiderActivity?.net_value || 0) >= 0 ? '+' : ''}{formatValue(insiderActivity?.net_value)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">Unique Insiders</div>
                    <div className="font-bold text-foreground text-lg font-mono">{insiderActivity?.unique_insiders ?? 'N/A'}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3 px-4 border-b border-border/60">
                <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                  <Repeat className="w-4 h-4 text-primary" /> Repeat Buyers
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {!insiderActivity?.repeat_buyers || insiderActivity.repeat_buyers.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">No repeat buyers detected in this lookback window.</p>
                ) : (
                  <ul className="space-y-2">
                    {insiderActivity.repeat_buyers.map((b, i) => (
                      <li key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/40 border border-border/40">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-positive flex-shrink-0" />
                          <button
                            onClick={() => setSelectedClient(b.client_name)}
                            className="font-bold hover:underline hover:text-primary transition-colors text-foreground"
                          >
                            {b.client_name}
                          </button>
                        </div>
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {b.purchase_count} buys
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Deal Activity Breakdown */}
          <Card>
            <CardHeader className="py-3 px-4 border-b border-border/60">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" /> Multi-Category Deal Activity
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {['Insider Trading', 'SAST Deals', 'Block Deals', 'Bulk Deals'].map((cat) => {
                  const d = intel.deal_activity?.[cat];
                  return (
                    <div key={cat} className="p-3.5 rounded-xl bg-card border border-border flex flex-col justify-between">
                      <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-2">{cat}</div>
                      {!d ? (
                        <div className="text-xs text-muted-foreground">No activity</div>
                      ) : (
                        <div className="text-xs font-mono space-y-1">
                          <div className="text-positive font-bold">{d.buy_count} BUY {d.buy_value ? `(${formatValue(d.buy_value)})` : ''}</div>
                          <div className="text-negative font-bold">{d.sell_count} SELL {d.sell_value ? `(${formatValue(d.sell_value)})` : ''}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Historical Signal Performance */}
          <Card>
            <CardHeader className="py-3 px-4 border-b border-border/60">
              <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" /> Historical Signal Performance
              </CardTitle>
              <CardDescription className="text-xs">
                Forward return distribution following prior insider BUY disclosures
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {Object.entries(intel.historical_signal_performance?.windows || {}).map(([key, w]) => (
                  <div key={key} className="p-3.5 rounded-xl bg-card border border-border text-center">
                    <div className="text-xs font-bold text-muted-foreground mb-1">{HISTORICAL_WINDOW_LABELS[key] || key}</div>
                    {w.available ? (
                      <>
                        <div className={cn('text-xl font-black font-mono', w.pct_positive >= 50 ? 'text-positive' : 'text-negative')}>
                          {w.pct_positive.toFixed(0)}%
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          Avg {w.avg_return >= 0 ? '+' : ''}{w.avg_return.toFixed(1)}%
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {w.positive_count}/{w.sample_size} signals
                        </div>
                      </>
                    ) : (
                      <div className="text-[11px] text-muted-foreground py-2">
                        Insufficient data<br/>({w.sample_size} signal{w.sample_size === 1 ? '' : 's'})
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Conviction Score Component Breakdown */}
          {conviction && (
            <Card>
              <CardHeader className="py-3 px-4 border-b border-border/60">
                <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" /> Conviction Factor Attribution
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table className="table-dense">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Factor Component</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Weight</TableHead>
                      <TableHead className="text-right">Attribution</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="font-mono">
                    {Object.entries(conviction.components).map(([key, c]) => (
                      <TableRow key={key} className={!c.available ? 'opacity-50' : ''}>
                        <TableCell className="font-sans font-bold text-foreground">{c.label}</TableCell>
                        <TableCell className="text-right">{c.available ? c.score.toFixed(0) : 'N/A'}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{c.configured_weight_pct.toFixed(0)}%</TableCell>
                        <TableCell className="text-right font-bold text-primary">{c.available ? c.weighted_contribution.toFixed(1) : 'Unavailable'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Why This Signal? */}
          {explanation && (
            <Card>
              <CardHeader className="py-3 px-4 border-b border-border/60">
                <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
                  <Info className="w-4 h-4 text-primary" /> Factor Driver Narrative
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <div className="text-xs font-bold text-positive uppercase tracking-wider mb-2">Positive Drivers</div>
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
                    <div className="text-xs font-bold text-warning uppercase tracking-wider mb-2">Risk & Caution Drivers</div>
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
          )}

          {/* Recent Underlying Transactions */}
          <Card>
            <CardHeader className="py-3 px-4 border-b border-border/60">
              <CardTitle className="text-xs font-bold uppercase tracking-wider">
                Underlying Transactions ({intel.transactions?.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {!intel.transactions || intel.transactions.length === 0 ? (
                <p className="text-xs text-muted-foreground py-8 text-center">No insider deals or block trades currently recorded for this stock.</p>
              ) : (
                <div className="overflow-x-auto max-h-96">
                  <Table className="table-dense">
                    <TableHeader className="sticky top-0 bg-muted/90 backdrop-blur z-10">
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Insider / Client</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead>Mapping</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="font-mono">
                      {intel.transactions.map((t) => (
                        <TableRow key={`${t.deal_category}-${t.id}`}>
                          <TableCell className="text-muted-foreground">{t.trade_date}</TableCell>
                          <TableCell className="font-sans">
                            <Badge variant="outline" className="text-[10px]">{t.deal_category}</Badge>
                          </TableCell>
                          <TableCell className="font-sans text-foreground">
                            <button
                              onClick={() => setSelectedClient(t.client_name)}
                              className="text-left font-bold hover:underline hover:text-primary transition-colors"
                            >
                              {t.client_name || 'N/A'}
                            </button>
                          </TableCell>
                          <TableCell className="font-sans text-muted-foreground">{t.role || 'Unavailable'}</TableCell>
                          <TableCell className="font-sans">
                            <Badge variant={t.action === 'BUY' ? 'positive' : 'negative'} className="text-[10px]">
                              {t.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{t.quantity ? Number(t.quantity).toLocaleString() : 'N/A'}</TableCell>
                          <TableCell className="text-right">{t.price ? `₹${Number(t.price).toFixed(2)}` : 'N/A'}</TableCell>
                          <TableCell className="text-right font-bold text-primary">{t.total_value ? formatValue(t.total_value) : 'N/A'}</TableCell>
                          <TableCell className="font-sans">
                            <Badge variant={t.match_status === 'MANUAL_OVERRIDE' ? 'default' : 'secondary'} className="text-[9px] font-bold">
                              {t.match_status || 'MATCHED'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {selectedClient && (
        <ClientDrilldownModal clientName={selectedClient} onClose={() => setSelectedClient(null)} />
      )}
    </div>
  );
}
