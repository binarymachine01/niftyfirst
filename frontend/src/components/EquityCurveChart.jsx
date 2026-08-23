import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { TrendingUp, Activity, ArrowUpRight } from 'lucide-react';

export default function EquityCurveChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="glass-panel p-8 flex flex-col items-center justify-center h-80 text-slate-500 rounded-2xl border-dashed">
        <div className="p-4 rounded-full bg-slate-900/80 mb-3 border border-white/5">
          <TrendingUp className="w-8 h-8 text-cyan-400 opacity-40" />
        </div>
        <p className="text-sm font-semibold text-slate-400">Strategy Simulation Ready</p>
        <p className="text-xs text-slate-500 mt-1">Select parameters on the left and click "Run Quantitative Simulation"</p>
      </div>
    );
  }

  const initialVal = data[0]?.equity || 1000000;
  const currentVal = data[data.length - 1]?.equity || initialVal;
  const netProfit = currentVal - initialVal;
  const netProfitPct = ((currentVal - initialVal) / initialVal) * 100;
  const isPositive = netProfit >= 0;

  const minVal = Math.min(...data.map((d) => d.equity));
  const maxVal = Math.max(...data.map((d) => d.equity));
  const yDomain = [Math.floor(minVal * 0.98), Math.ceil(maxVal * 1.02)];

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const val = payload[0].value;
      const profitFromStart = val - initialVal;
      const profitPct = ((val - initialVal) / initialVal) * 100;
      const dd = payload[0].payload.drawdown_pct;

      return (
        <div className="bg-[#0c1222]/95 border border-cyan-500/40 p-3.5 rounded-xl shadow-2xl backdrop-blur-xl text-xs font-mono">
          <div className="text-slate-400 text-[11px] mb-1 font-sans font-medium flex items-center justify-between gap-4">
            <span>{label}</span>
            <span className="text-cyan-400 font-bold">Trading Day</span>
          </div>
          <div className="text-base font-black text-white">
            ₹{val.toLocaleString('en-IN')}
          </div>
          <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-white/10 text-[11px]">
            <span className={profitFromStart >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
              {profitFromStart >= 0 ? '+' : ''}₹{profitFromStart.toLocaleString('en-IN')} ({profitPct >= 0 ? '+' : ''}{profitPct.toFixed(2)}%)
            </span>
            {dd > 0 && (
              <span className="text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded text-[10px]">
                DD: -{dd.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="glass-panel p-6 rounded-2xl">
      {/* Chart Header with Live Stats */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-white/[0.06]">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
            <h3 className="text-sm font-extrabold text-white tracking-tight">
              Portfolio Growth Curve (₹)
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Chronological simulated equity progression</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-white/[0.08] text-xs">
            <span className="text-slate-400">Peak:</span>
            <span className="font-mono font-bold text-emerald-400">₹{(maxVal / 100000).toFixed(2)}L</span>
          </div>
          <div className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-mono font-bold ${
            isPositive ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25' : 'bg-rose-500/10 text-rose-300 border-rose-500/25'
          }`}>
            <ArrowUpRight className="w-3.5 h-3.5" />
            {netProfitPct >= 0 ? '+' : ''}{netProfitPct.toFixed(2)}% Total Gain
          </div>
        </div>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00f2fe" stopOpacity={0.45} />
                <stop offset="60%" stopColor="#3b82f6" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
            />
            <YAxis
              domain={yDomain}
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
              tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="#00f2fe"
              strokeWidth={3}
              fillOpacity={1}
              fill="url(#equityGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
