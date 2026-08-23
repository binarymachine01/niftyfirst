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
import { AlertTriangle } from 'lucide-react';

export default function DrawdownChart({ data }) {
  if (!data || data.length === 0) return null;

  const maxDrawdown = Math.max(...data.map((d) => d.drawdown_pct || 0));

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const dd = payload[0].value;
      return (
        <div className="bg-[#0c1222]/95 border border-rose-500/40 p-2.5 rounded-xl shadow-2xl backdrop-blur-xl text-xs font-mono">
          <div className="text-slate-400 text-[10px] mb-0.5">{label}</div>
          <div className="font-bold text-rose-400">
            Drawdown: -{dd.toFixed(2)}%
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="glass-panel p-6 rounded-2xl">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
          <h3 className="text-xs font-extrabold text-white uppercase tracking-wider">
            Underwater Capital Drawdown (%)
          </h3>
        </div>
        <div className="text-xs font-mono font-bold text-rose-400 bg-rose-500/10 px-2.5 py-1 rounded-lg border border-rose-500/20">
          Max Drawdown: -{maxDrawdown.toFixed(2)}%
        </div>
      </div>

      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.45} />
                <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.03)" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="#64748b"
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
            />
            <YAxis
              stroke="#64748b"
              fontSize={10}
              tickLine={false}
              axisLine={{ stroke: 'rgba(255,255,255,0.08)' }}
              tickFormatter={(v) => `-${v.toFixed(0)}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="drawdown_pct"
              stroke="#f43f5e"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#drawdownGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
