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
import { Card, CardHeader, CardTitle, CardContent } from './ui/card';
import { Badge } from './ui/badge';

export default function DrawdownChart({ data, theme = 'dark' }) {
  if (!data || data.length === 0) return null;

  const isLight = theme === 'light';
  const maxDrawdown = Math.max(...data.map((d) => d.drawdown_pct || 0));

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const dd = payload[0].value;
      return (
        <div className="bg-popover border border-border p-2.5 rounded-lg shadow-xl text-xs font-mono">
          <div className="text-muted-foreground text-[10px] mb-0.5">{label}</div>
          <div className="font-bold text-negative">
            Drawdown: -{dd.toFixed(2)}%
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader className="py-3 px-4 border-b border-border/60">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-negative" />
            Underwater Capital Drawdown (%)
          </CardTitle>
          <Badge variant="negative" className="font-mono text-xs">
            Max Drawdown: -{maxDrawdown.toFixed(2)}%
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity={isLight ? 0.35 : 0.45} />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={isLight ? 'rgba(148,163,184,0.18)' : 'rgba(255,255,255,0.03)'} vertical={false} />
              <XAxis
                dataKey="date"
                stroke={isLight ? '#64748b' : '#94a3b8'}
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: isLight ? '#cbd5e1' : 'rgba(255,255,255,0.08)' }}
              />
              <YAxis
                stroke={isLight ? '#64748b' : '#94a3b8'}
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: isLight ? '#cbd5e1' : 'rgba(255,255,255,0.08)' }}
                tickFormatter={(v) => `-${v.toFixed(0)}%`}
                width={50}
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
      </CardContent>
    </Card>
  );
}
