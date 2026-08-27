import React, { useState, useEffect } from 'react';
import { Search, TrendingUp, Calendar, AlertCircle, ArrowUpRight, ArrowDownRight, BarChart2, Activity } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { api } from '../services/api';

export default function StockInspector({ theme = 'dark' }) {
  const [symbol, setSymbol] = useState('HINDUNILVR');
  const [inputSymbol, setInputSymbol] = useState('HINDUNILVR');
  const [history, setHistory] = useState([]);
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const isLight = theme === 'light';

  const fetchStockData = async (sym) => {
    setLoading(true);
    setError(null);
    try {
      const histRes = await api.getStockHistory(sym);
      setHistory(histRes.candles || []);

      const dealsRes = await api.getStockDeals(sym);
      setDeals(dealsRes.deals || []);
    } catch (err) {
      console.error(err);
      setError(`Could not load price candles for symbol '${sym}'. Please ensure it is present in the NSE Market Data repository.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStockData(symbol);
  }, [symbol]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputSymbol.trim()) {
      setSymbol(inputSymbol.trim().toUpperCase());
    }
  };

  const minClose = history.length > 0 ? Math.min(...history.map((c) => c.close)) : 0;
  const maxClose = history.length > 0 ? Math.max(...history.map((c) => c.close)) : 0;
  const yDomain = [Math.floor(minClose * 0.95), Math.ceil(maxClose * 1.05)];

  const latestCandle = history.length > 0 ? history[history.length - 1] : null;
  const firstCandle = history.length > 0 ? history[0] : null;
  const overallReturn = latestCandle && firstCandle ? ((latestCandle.close - firstCandle.close) / firstCandle.close) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Search Header Panel */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2 tracking-tight">
              <Search className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              Stock EOD Price Inspector & Deal Overlay
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Inspect historical daily candles and see insider/large deals mapped onto the timeline
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
            <button type="submit" className="btn-primary text-xs py-2 px-4.5">
              Inspect Ticker
            </button>
          </form>
        </div>

        {/* Quick Stock Tags */}
        <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t border-slate-200 dark:border-white/[0.06] text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">Quick Select:</span>
          {['HINDUNILVR', 'INFY', 'TCS', 'RELIANCE', 'SBIN', '20MICRONS', 'RAVINDRA'].map((s) => (
            <button
              key={s}
              onClick={() => {
                setInputSymbol(s);
                setSymbol(s);
              }}
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
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Chart Panel */}
      {history.length > 0 && (
        <div className="glass-panel p-6 rounded-2xl">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-200/80 dark:border-white/[0.06]">
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-2xl font-black font-mono text-slate-900 dark:text-white tracking-tight">{symbol}</h3>
                {latestCandle && (
                  <span className="text-xl font-black font-mono text-cyan-600 dark:text-cyan-300">
                    ₹{latestCandle.close.toFixed(2)}
                  </span>
                )}
                <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-md border ${
                  overallReturn >= 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                }`}>
                  {overallReturn >= 0 ? '+' : ''}{overallReturn.toFixed(2)}% YTD
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {history.length} Trading Days Recorded ({history[0].trade_date} to {latestCandle?.trade_date})
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono">
              <div className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900/90 border border-slate-200 dark:border-white/[0.08]">
                <span className="text-slate-500 dark:text-slate-400">Low: </span>
                <span className="font-bold text-rose-600 dark:text-rose-400">₹{minClose.toFixed(2)}</span>
                <span className="text-slate-400 dark:text-slate-600 mx-2">|</span>
                <span className="text-slate-500 dark:text-slate-400">High: </span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">₹{maxClose.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={isLight ? 0.35 : 0.4} />
                    <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={isLight ? 'rgba(148,163,184,0.18)' : 'rgba(255,255,255,0.04)'} vertical={false} />
                <XAxis
                  dataKey="trade_date"
                  stroke={isLight ? '#64748b' : '#94a3b8'}
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: isLight ? '#cbd5e1' : 'rgba(255,255,255,0.08)' }}
                />
                <YAxis
                  domain={yDomain}
                  stroke={isLight ? '#64748b' : '#94a3b8'}
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: isLight ? '#cbd5e1' : 'rgba(255,255,255,0.08)' }}
                  tickFormatter={(v) => `₹${v.toFixed(0)}`}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-white/95 dark:bg-[#0c1222]/95 border border-sky-500/30 dark:border-sky-500/40 p-3.5 rounded-xl shadow-xl dark:shadow-2xl backdrop-blur-xl text-xs font-mono">
                          <div className="text-slate-500 dark:text-slate-400 mb-1.5 font-sans font-medium">{label}</div>
                          <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs">
                            <div>Open: <span className="text-slate-900 dark:text-white font-bold">₹{d.open.toFixed(2)}</span></div>
                            <div>High: <span className="text-emerald-600 dark:text-emerald-400 font-bold">₹{d.high.toFixed(2)}</span></div>
                            <div>Low: <span className="text-rose-600 dark:text-rose-400 font-bold">₹{d.low.toFixed(2)}</span></div>
                            <div>Close: <span className="text-cyan-700 dark:text-cyan-300 font-bold">₹{d.close.toFixed(2)}</span></div>
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 pt-1.5 border-t border-slate-200 dark:border-white/10 flex justify-between">
                            <span>Vol: {d.volume?.toLocaleString()}</span>
                            {d.delivery_pct && <span>Del: {d.delivery_pct}%</span>}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke="#0ea5e9"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#priceGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/60 dark:divide-white/[0.04]">
                {deals.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-100/70 dark:hover:bg-white/[0.02]">
                    <td className="py-2.5 px-3.5 text-slate-700 dark:text-slate-300">{d.trade_date}</td>
                    <td className="py-2.5 px-3.5 font-sans">
                      <span className="badge-tag">{d.deal_category}</span>
                    </td>
                    <td className="py-2.5 px-3.5 font-sans text-slate-700 dark:text-slate-300">{d.client_name}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

