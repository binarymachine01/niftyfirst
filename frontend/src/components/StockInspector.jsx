import React, { useState, useEffect, useMemo } from 'react';
import {
  Search, AlertCircle, ArrowUpRight, ArrowDownRight, Gauge, Info, CheckCircle2, AlertTriangle,
  ShieldCheck, ShieldAlert, ShieldQuestion, Users, Repeat, TrendingUp, Layers, Clock,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, Bar, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { api } from '../services/api';
import ClientDrilldownModal from './ClientDrilldownModal';

function ReactionCell({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-400 dark:text-slate-600">—</span>;
  }
  const isUp = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-bold ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      {isUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {isUp ? '+' : ''}{value.toFixed(2)}%
    </span>
  );
}

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
  if (value === null || value === undefined) return <span className="text-slate-400 dark:text-slate-600">N/A</span>;
  const isUp = value >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 font-bold ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      {isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      {isUp ? '+' : ''}{value.toFixed(2)}%
    </span>
  );
}

const SIGNAL_STYLES = {
  'VERY STRONG': 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  STRONG: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  MODERATE: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
  WEAK: 'bg-slate-200 dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-white/10',
};

function SignalBadge({ tier }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-black tracking-wide ${SIGNAL_STYLES[tier] || SIGNAL_STYLES.WEAK}`}>
      {tier || 'N/A'}
    </span>
  );
}

function ConfidenceBadge({ tier }) {
  const styles = {
    HIGH: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    MEDIUM: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
    LOW: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30',
  };
  const icons = { HIGH: ShieldCheck, MEDIUM: ShieldQuestion, LOW: ShieldAlert };
  const Icon = icons[tier] || ShieldQuestion;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-bold ${styles[tier] || styles.LOW}`}>
      <Icon className="w-3.5 h-3.5" /> {tier || 'N/A'} CONFIDENCE
    </span>
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

// Custom candlestick body/wick renderer. The Bar's dataKey returns [low, high],
// so recharts already maps `y`/`height` to that exact price range in pixel
// space - priceToY() interpolates open/close linearly within that mapping.
function CandleShape(props) {
  const { x, y, width, height, payload } = props;
  const { open, close, high, low } = payload;
  if (high == null || low == null || high === low || width <= 0) return null;
  const priceToY = (price) => y + height - ((price - low) / (high - low)) * height;
  const isUp = close >= open;
  const color = isUp ? '#10b981' : '#f43f5e';
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
      {/* Search Header Panel */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
              <Search className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              Stock Intelligence
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Price action, insider/deal activity, Insider Conviction, and historical signal performance in one research view
            </p>
          </div>
          <form onSubmit={handleSubmit} className="flex items-center gap-2.5 w-full sm:w-auto">
            <input
              type="text"
              placeholder="e.g. HINDUNILVR, INFY..."
              value={inputSymbol}
              onChange={(e) => setInputSymbol(e.target.value)}
              className="glass-input font-mono font-bold text-xs uppercase w-48 tracking-wider"
            />
            <button type="submit" className="btn-primary text-xs py-2 px-4.5">Inspect Ticker</button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-200 dark:border-white/[0.06] text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">Quick Select:</span>
          {['HINDUNILVR', 'INFY', 'TCS', 'RELIANCE', 'SBIN', '20MICRONS', 'RAVINDRA'].map((s) => (
            <button
              key={s}
              onClick={() => { setInputSymbol(s); setSymbol(s); }}
              className={`px-3 py-1 rounded-lg border font-mono text-[11px] font-bold transition-all ${
                symbol === s
                  ? 'bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border-cyan-500/40'
                  : 'bg-white dark:bg-slate-900/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/5'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2 font-medium">
          <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
        </div>
      )}

      {loading && !intel && (
        <div className="glass-panel p-10 rounded-2xl text-center text-xs text-slate-500 dark:text-slate-400">
          <span className="w-4 h-4 border-2 border-cyan-500 dark:border-cyan-400 border-t-transparent rounded-full animate-spin inline-block mr-2 align-middle" />
          Loading stock intelligence for {symbol}...
        </div>
      )}

      {header && (
        <>
          {/* Stock Header */}
          <div className="glass-panel p-6 rounded-2xl">
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">{intel.symbol}</h3>
                  {header.company_name && <span className="text-sm text-slate-500 dark:text-slate-400 font-sans">{header.company_name}</span>}
                </div>
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  <span className="text-2xl font-black font-mono text-slate-900 dark:text-white">
                    {header.latest_price !== null ? `₹${header.latest_price.toFixed(2)}` : 'N/A'}
                  </span>
                  {header.change !== null && (
                    <span className={`text-sm font-mono font-bold px-2 py-0.5 rounded-md border ${header.change >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'}`}>
                      {header.change >= 0 ? '+' : ''}{header.change.toFixed(2)} ({header.change_pct >= 0 ? '+' : ''}{header.change_pct?.toFixed(2)}%)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                  <span>52W High: <span className="font-bold text-emerald-600 dark:text-emerald-400">{header.week_52_high !== null ? `₹${header.week_52_high.toFixed(2)}` : 'N/A'}</span></span>
                  <span>52W Low: <span className="font-bold text-rose-600 dark:text-rose-400">{header.week_52_low !== null ? `₹${header.week_52_low.toFixed(2)}` : 'N/A'}</span></span>
                  <span className="text-slate-400 dark:text-slate-600">As of {intel.as_of_date}</span>
                </div>
                {/* Current price returns - distinct from Historical Signal Performance below */}
                <div className="flex items-center gap-4 mt-2 text-xs font-mono">
                  {[['1d', '1D'], ['5d', '5D'], ['20d', '20D'], ['3m', '3M'], ['6m', '6M']].map(([key, label]) => (
                    <span key={key} className="text-slate-400 dark:text-slate-600">
                      {label}: <Pct value={technical?.returns?.[key]} />
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Insider Conviction</div>
                  <div className={`text-3xl font-black font-mono ${conviction?.overall_score >= 70 ? 'text-emerald-500' : conviction?.overall_score >= 40 ? 'text-amber-500' : 'text-rose-500'}`}>
                    {conviction?.overall_score !== null && conviction?.overall_score !== undefined ? conviction.overall_score.toFixed(0) : 'N/A'}<span className="text-sm text-slate-400">/100</span>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <SignalBadge tier={signal?.tier} />
                  <ConfidenceBadge tier={conviction?.confidence?.tier} />
                </div>
              </div>
            </div>
          </div>

          {/* Stock Intelligence Summary */}
          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight mb-4 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> Stock Intelligence Summary
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Insider Activity</div>
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {insiderActivity?.net_value === null ? 'No activity' : insiderActivity.net_value >= 0 ? 'Net buying' : 'Net selling'}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Price Trend</div>
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {technical?.dma?.above_dma_50 === true ? 'Bullish (above 50 DMA)' : technical?.dma?.above_dma_50 === false ? 'Bearish (below 50 DMA)' : 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Volume</div>
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {technical?.volume_ratio !== null && technical?.volume_ratio !== undefined ? `${technical.volume_ratio.toFixed(2)}× average` : 'N/A'}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Delivery</div>
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {technical?.delivery?.delivery_increase === null ? 'N/A' : technical.delivery.delivery_increase > 0 ? 'Improving' : technical.delivery.delivery_increase < 0 ? 'Declining' : 'Flat'}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Historical Signal</div>
                <div className="font-bold text-slate-800 dark:text-slate-200">
                  {intel.historical_signal_performance?.primary_20d?.available
                    ? (intel.historical_signal_performance.primary_20d.pct_positive >= 50 ? 'Positive' : 'Negative')
                    : 'Insufficient data'}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Signal</div>
                <SignalBadge tier={signal?.tier} />
              </div>
            </div>
          </div>

          {/* Chart Panel */}
          <div className="glass-panel p-6 rounded-2xl">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-950/70 border border-slate-200 dark:border-white/[0.08] text-xs">
                {RANGE_OPTIONS.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => setRange(r.key)}
                    className={`px-2.5 py-1 rounded-lg font-bold transition-all ${range === r.key ? 'bg-white dark:bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 border border-slate-300 dark:border-cyan-500/40' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}`}
                  >
                    {r.key}
                  </button>
=======
      {/* Associated Deals Table */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight">
            Insider & Block Transactions for {symbol} ({deals.length} Recorded)
          </h3>
        </div>
        {deals.length === 0 ? (
          <p className="text-xs text-slate-500 py-6 text-center">
            No insider deals or block trades currently recorded for this stock in market data.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
            <table className="w-full text-left text-xs border-collapse font-mono">
              <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-2.5 px-3.5">Date</th>
                  <th className="py-2.5 px-3.5">Category</th>
                  <th className="py-2.5 px-3.5">Client / Promoter</th>
                  <th className="py-2.5 px-3.5">Action</th>
                  <th className="py-2.5 px-3.5 text-right">Quantity</th>
                  <th className="py-2.5 px-3.5 text-right">Price</th>
                  <th className="py-2.5 px-3.5 text-right">Total Turnover</th>
                  <th className="py-2.5 px-3.5 text-right">1D</th>
                  <th className="py-2.5 px-3.5 text-right">5D</th>
                  <th className="py-2.5 px-3.5 text-right">20D</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04]">
                {deals.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-100/70 dark:hover:bg-white/[0.02]">
                    <td className="py-2.5 px-3.5 text-slate-700 dark:text-slate-300">{d.trade_date}</td>
                    <td className="py-2.5 px-3.5 font-sans">
                      <span className="badge-tag">{d.deal_category}</span>
                    </td>
                    <td className="py-2.5 px-3.5 font-sans">
                      {d.client_name ? (
                        <button
                          onClick={() => setSelectedClient(d.client_name)}
                          className="text-slate-700 dark:text-slate-300 hover:text-cyan-600 dark:hover:text-cyan-400 underline decoration-dotted underline-offset-2 transition-colors"
                        >
                          {d.client_name}
                        </button>
                      ) : (
                        'N/A'
                      )}
                    </td>
                    <td className="py-2.5 px-3.5 font-sans">
                      <span className={d.action === 'BUY' ? 'badge-buy' : 'badge-sell'}>
                        {d.action}
                      </span>
                    </td>
                    <td className="py-2.5 px-3.5 text-right text-slate-800 dark:text-slate-200">
                      {d.quantity ? Number(d.quantity).toLocaleString() : '-'}
                    </td>
                    <td className="py-2.5 px-3.5 text-right text-slate-800 dark:text-slate-200">
                      {d.price ? `₹${Number(d.price).toFixed(2)}` : '-'}
                    </td>
                    <td className="py-2.5 px-3.5 text-right text-cyan-700 dark:text-cyan-300 font-bold">
                      {d.total_value ? `₹${(Number(d.total_value) / 100000).toFixed(2)} L` : '-'}
                    </td>
                    <td className="py-2.5 px-3.5 text-right font-mono"><ReactionCell value={d.price_reaction?.['1d']} /></td>
                    <td className="py-2.5 px-3.5 text-right font-mono"><ReactionCell value={d.price_reaction?.['5d']} /></td>
                    <td className="py-2.5 px-3.5 text-right font-mono"><ReactionCell value={d.price_reaction?.['20d']} /></td>
                  </tr>
>>>>>>> feature/dev
                ))}
              </div>
              <div className="flex items-center gap-3 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={showDma20} onChange={(e) => setShowDma20(e.target.checked)} className="w-3 h-3" /> <span className="text-amber-500">20 DMA</span></label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={showDma50} onChange={(e) => setShowDma50(e.target.checked)} className="w-3 h-3" /> <span className="text-sky-500">50 DMA</span></label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={showDma200} onChange={(e) => setShowDma200(e.target.checked)} className="w-3 h-3" /> <span className="text-purple-500">200 DMA</span></label>
              </div>
            </div>

            {chartData.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 py-10 text-center">No price data available for the selected range.</p>
            ) : (
              <>
                <div className="h-96 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isLight ? 'rgba(148,163,184,0.18)' : 'rgba(255,255,255,0.04)'} vertical={false} />
                      <XAxis dataKey="trade_date" stroke={isLight ? '#64748b' : '#94a3b8'} fontSize={10} tickLine={false} minTickGap={40} />
                      <YAxis domain={yDomain} stroke={isLight ? '#64748b' : '#94a3b8'} fontSize={11} tickLine={false} tickFormatter={(v) => `₹${v.toFixed(0)}`} width={65} />
                      <Tooltip
                        content={({ active, payload, label }) => {
                          if (!active || !payload || !payload.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-white/95 dark:bg-[#0c1222]/95 border border-sky-500/30 dark:border-sky-500/40 p-3.5 rounded-xl shadow-xl backdrop-blur-xl text-xs font-mono max-w-xs">
                              <div className="text-slate-500 dark:text-slate-400 mb-1.5 font-sans font-medium">{label}</div>
                              <div className="grid grid-cols-2 gap-x-5 gap-y-1">
                                <div>O: <span className="text-slate-900 dark:text-white font-bold">₹{d.open?.toFixed(2)}</span></div>
                                <div>H: <span className="text-emerald-600 dark:text-emerald-400 font-bold">₹{d.high?.toFixed(2)}</span></div>
                                <div>L: <span className="text-rose-600 dark:text-rose-400 font-bold">₹{d.low?.toFixed(2)}</span></div>
                                <div>C: <span className="text-cyan-700 dark:text-cyan-300 font-bold">₹{d.close?.toFixed(2)}</span></div>
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 pt-1.5 border-t border-slate-200 dark:border-white/10 flex justify-between font-sans">
                                <span>Vol: {d.volume?.toLocaleString() ?? 'N/A'}</span>
                                <span>Del: {d.delivery_pct !== null && d.delivery_pct !== undefined ? `${d.delivery_pct}%` : 'N/A'}</span>
                              </div>
                              {d.transactions && (
                                <div className="mt-2 pt-1.5 border-t border-slate-200 dark:border-white/10 space-y-1 font-sans">
                                  {d.transactions.map((t, i) => (
                                    <div key={i} className="text-[10px]">
                                      <span className={t.action === 'BUY' ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-rose-600 dark:text-rose-400 font-bold'}>{t.action}</span>
                                      {' '}{t.deal_category} · {t.role || 'N/A'} · {t.client_name || 'N/A'} · {t.total_value ? formatValue(t.total_value) : 'N/A'}
                                    </div>
                <div className="h-28 w-full mt-4 pt-3 border-t border-slate-200 dark:border-white/[0.06]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={filteredData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#e2e8f0' : 'rgba(255,255,255,0.04)'} />
                      <XAxis dataKey="trade_date" hide />
                      <YAxis domain={[0, 100]} ticks={[30, 50, 70]} tick={{ fill: isLight ? '#64748b' : '#94a3b8', fontSize: 9 }} orientation="right" />
                      <Tooltip content={<CustomTooltip />} />
                      <ReferenceLine y={70} stroke="#f43f5e" strokeDasharray="3 3" />
                      <ReferenceLine y={30} stroke="#10b981" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="rsi_14" stroke="#8b5cf6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="text-[10px] text-slate-400 dark:text-slate-600 text-right font-mono -mt-1">RSI (14)</div>
                </div>

                <div className="h-28 w-full mt-4 pt-3 border-t border-slate-200 dark:border-white/[0.06]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={filteredData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#e2e8f0' : 'rgba(255,255,255,0.04)'} />
                      <XAxis dataKey="trade_date" hide />
                      <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: isLight ? '#64748b' : '#94a3b8', fontSize: 9 }} orientation="right" />
                      <Tooltip content={<CustomTooltip />} />
                      {technical?.delivery?.avg_delivery_pct !== null && technical?.delivery?.avg_delivery_pct !== undefined && (
                        <ReferenceLine y={technical.delivery.avg_delivery_pct} stroke="#94a3b8" strokeDasharray="4 4" />
                      )}
                      <Line type="monotone" dataKey="delivery_pct" stroke="#06b6d4" strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div className="text-[10px] text-slate-400 dark:text-slate-600 text-right font-mono -mt-1">
                    Delivery % {technical?.delivery?.avg_delivery_pct !== null && technical?.delivery?.avg_delivery_pct !== undefined ? `(dashed = ${technical.delivery.avg_delivery_pct.toFixed(0)}% avg)` : ''}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Insider Activity + Repeat Buyers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="glass-panel p-6 rounded-2xl">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> Insider Activity <span className="text-[10px] font-normal text-slate-400">(last {insiderActivity?.window_days} days)</span>
              </h3>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div><div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Buying</div><div className="font-bold text-emerald-600 dark:text-emerald-400 text-lg font-mono">{formatValue(insiderActivity?.buy_value)}</div></div>
                <div><div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Selling</div><div className="font-bold text-rose-600 dark:text-rose-400 text-lg font-mono">{formatValue(insiderActivity?.sell_value)}</div></div>
                <div><div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Net</div><div className={`font-bold text-lg font-mono ${(insiderActivity?.net_value || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{insiderActivity?.net_value >= 0 ? '+' : ''}{formatValue(insiderActivity?.net_value)}</div></div>
                <div><div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1">Insiders</div><div className="font-bold text-slate-800 dark:text-slate-200 text-lg font-mono">{insiderActivity?.unique_insiders ?? 'N/A'}</div></div>
              </div>
            </div>

            <div className="glass-panel p-6 rounded-2xl">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight mb-4 flex items-center gap-2">
                <Repeat className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> Repeat Buyers
              </h3>
              {!insiderActivity?.repeat_buyers || insiderActivity.repeat_buyers.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4">No repeat buyers detected in this window.</p>
              ) : (
                <ul className="space-y-1.5">
                  {insiderActivity.repeat_buyers.map((b, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                      <button
                        onClick={() => setSelectedClient(b.client_name)}
                        className="text-left font-bold hover:underline hover:text-cyan-600 dark:hover:text-cyan-400"
                      >
                        {b.client_name}
                      </button>{' '}
                      — {b.purchase_count} purchases
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Deal Activity Breakdown */}
          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight mb-4 flex items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> Deal Activity
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {['Insider Trading', 'SAST Deals', 'Block Deals', 'Bulk Deals'].map((cat) => {
                const d = intel.deal_activity?.[cat];
                return (
                  <div key={cat} className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-950/60 border border-slate-200 dark:border-white/[0.08]">
                    <div className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider mb-1.5">{cat}</div>
                    {!d ? (
                      <div className="text-xs text-slate-400 dark:text-slate-600">No activity</div>
                    ) : (
                      <div className="text-xs font-mono space-y-0.5">
                        <div className="text-emerald-600 dark:text-emerald-400 font-bold">{d.buy_count} BUY {d.buy_value ? `(${formatValue(d.buy_value)})` : ''}</div>
                        <div className="text-rose-600 dark:text-rose-400 font-bold">{d.sell_count} SELL {d.sell_value ? `(${formatValue(d.sell_value)})` : ''}</div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Historical Signal Performance */}
          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight mb-1 flex items-center gap-2">
              <Clock className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> Historical Signal Performance
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">
              How this stock performed after past insider BUY signals — not the same as current price returns above.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {Object.entries(intel.historical_signal_performance?.windows || {}).map(([key, w]) => (
                <div key={key} className="p-3.5 rounded-xl bg-slate-100 dark:bg-slate-950/60 border border-slate-200 dark:border-white/[0.08] text-center">
                  <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5">{HISTORICAL_WINDOW_LABELS[key] || key}</div>
                  {w.available ? (
                    <>
                      <div className={`text-lg font-black font-mono ${w.pct_positive >= 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{w.pct_positive.toFixed(0)}%</div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">Avg {w.avg_return >= 0 ? '+' : ''}{w.avg_return.toFixed(1)}%</div>
                      <div className="text-[10px] text-slate-400 dark:text-slate-600 font-mono">{w.positive_count}/{w.sample_size} signals</div>
                    </>
                  ) : (
                    <div className="text-[11px] text-slate-400 dark:text-slate-600 py-2">Insufficient data<br/>({w.sample_size} signal{w.sample_size === 1 ? '' : 's'})</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Conviction Score Breakdown */}
          {conviction && (
            <div className="glass-panel p-6 rounded-2xl">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight mb-4 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> Insider Conviction Breakdown
              </h3>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/[0.06]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3.5">Component</th>
                      <th className="py-2.5 px-3.5 text-right">Score</th>
                      <th className="py-2.5 px-3.5 text-right">Weight</th>
                      <th className="py-2.5 px-3.5 text-right">Contribution</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04] font-mono">
                    {Object.entries(conviction.components).map(([key, c]) => (
                      <tr key={key} className={!c.available ? 'opacity-50' : ''}>
                        <td className="py-2.5 px-3.5 font-sans font-bold text-slate-900 dark:text-white">{c.label}</td>
                        <td className="py-2.5 px-3.5 text-right">{c.available ? c.score.toFixed(0) : 'N/A'}</td>
                        <td className="py-2.5 px-3.5 text-right text-slate-500 dark:text-slate-400">{c.configured_weight_pct.toFixed(0)}%</td>
                        <td className="py-2.5 px-3.5 text-right font-bold text-cyan-700 dark:text-cyan-300">{c.available ? c.weighted_contribution.toFixed(1) : 'Unavailable'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-600 font-mono mt-2">Model: {conviction.model_version}</div>
            </div>
          )}

          {/* Why This Signal */}
          {explanation && (
            <div className="glass-panel p-6 rounded-2xl">
              <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight mb-4 flex items-center gap-2">
                <Info className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> Why This Signal?
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">Positive Factors</div>
                  {explanation.positive.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">No positive contributors identified.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {explanation.positive.map((p, i) => (
                        <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" /> {p}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <div className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-2">Negative / Caution Factors</div>
                  {explanation.negative.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">No negative factors or missing-data flags.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {explanation.negative.map((n, i) => (
                        <li key={i} className="text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" /> {n}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="mt-5 pt-4 border-t border-slate-200 dark:border-white/[0.08] text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                {explanation.confidence_summary}
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-600 italic mt-3">{explanation.disclaimer}</p>
            </div>
          )}

          {/* Recent Transactions */}
          <div className="glass-panel p-6 rounded-2xl">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white tracking-tight mb-4">
              Recent Transactions ({intel.transactions?.length || 0})
            </h3>
            {!intel.transactions || intel.transactions.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">No insider deals or block trades currently recorded for this stock.</p>
            ) : (
              <div className="overflow-x-auto max-h-96 rounded-xl border border-slate-200 dark:border-white/[0.06]">
                <table className="w-full text-left text-xs border-collapse font-mono">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-[#0c1222] text-slate-700 dark:text-slate-400 uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3.5">Date</th>
                      <th className="py-2.5 px-3.5">Category</th>
                      <th className="py-2.5 px-3.5">Insider / Client</th>
                      <th className="py-2.5 px-3.5">Role</th>
                      <th className="py-2.5 px-3.5">Action</th>
                      <th className="py-2.5 px-3.5 text-right">Quantity</th>
                      <th className="py-2.5 px-3.5 text-right">Price</th>
                      <th className="py-2.5 px-3.5 text-right">Value</th>
                      <th className="py-2.5 px-3.5">Mapping</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04]">
                    {intel.transactions.map((t) => (
                      <tr key={`${t.deal_category}-${t.id}`} className="hover:bg-slate-100/70 dark:hover:bg-white/[0.02]">
                        <td className="py-2.5 px-3.5 text-slate-700 dark:text-slate-300">{t.trade_date}</td>
                        <td className="py-2.5 px-3.5 font-sans"><span className="badge-tag">{t.deal_category}</span></td>
                        <td className="py-2.5 px-3.5 font-sans text-slate-700 dark:text-slate-300">
                          <button
                            onClick={() => setSelectedClient(t.client_name)}
                            className="text-left font-bold hover:underline hover:text-cyan-600 dark:hover:text-cyan-400"
                          >
                            {t.client_name || 'N/A'}
                          </button>
                        </td>
                        <td className="py-2.5 px-3.5 font-sans text-slate-500 dark:text-slate-400">{t.role || 'Unavailable'}</td>
                        <td className="py-2.5 px-3.5 font-sans"><span className={t.action === 'BUY' ? 'badge-buy' : 'badge-sell'}>{t.action}</span></td>
                        <td className="py-2.5 px-3.5 text-right text-slate-800 dark:text-slate-200">{t.quantity ? Number(t.quantity).toLocaleString() : 'N/A'}</td>
                        <td className="py-2.5 px-3.5 text-right text-slate-800 dark:text-slate-200">{t.price ? `₹${Number(t.price).toFixed(2)}` : 'N/A'}</td>
                        <td className="py-2.5 px-3.5 text-right text-cyan-700 dark:text-cyan-300 font-bold">{t.total_value ? formatValue(t.total_value) : 'N/A'}</td>
                        <td className="py-2.5 px-3.5 font-sans">
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${t.match_status === 'MANUAL_OVERRIDE' ? 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-300 border-cyan-500/30' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'}`}>
                            {t.match_status || 'MATCHED'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {selectedClient && (
        <ClientDrilldownModal clientName={selectedClient} onClose={() => setSelectedClient(null)} />
      )}
    </div>
  );
}
