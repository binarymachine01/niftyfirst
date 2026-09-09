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
import { TrendingUp, ArrowUpRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from './ui/card';
import { Badge } from './ui/badge';

export default function EquityCurveChart({ data, theme = 'dark' }) {
  const isLight = theme === 'light';

  if (!data || data.length === 0) {
    return (
      <Card className="p-8 flex flex-col items-center justify-center h-80 border-dashed text-center">
        <div className="p-4 rounded-full bg-muted mb-3 border border-border">
          <TrendingUp className="w-8 h-8 text-primary opacity-60" />
        </div>
        <p className="text-sm font-semibold text-foreground">Strategy Simulation Ready</p>
        <p className="text-xs text-muted-foreground mt-1">Select parameters on the left and click "Run Quantitative Simulation"</p>
      </Card>
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
        <div className="bg-popover border border-border p-3.5 rounded-lg shadow-xl text-xs font-mono">
          <div className="text-muted-foreground text-[11px] mb-1 font-sans font-medium flex items-center justify-between gap-4">
            <span>{label}</span>
            <span className="text-primary font-bold">Trading Day</span>
          </div>
          <div className="text-base font-black text-foreground">
            ₹{val.toLocaleString('en-IN')}
          </div>
          <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-border text-[11px]">
            <span className={profitFromStart >= 0 ? 'text-positive font-bold' : 'text-negative font-bold'}>
              {profitFromStart >= 0 ? '+' : ''}₹{profitFromStart.toLocaleString('en-IN')} ({profitPct >= 0 ? '+' : ''}{profitPct.toFixed(2)}%)
            </span>
            {dd > 0 && (
              <Badge variant="negative" className="text-[10px] px-1.5 py-0">
                DD: -{dd.toFixed(1)}%
              </Badge>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card>
      <CardHeader className="py-3 px-4 border-b border-border/60">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="text-xs font-bold uppercase tracking-wider flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-primary" />
              Portfolio Growth Curve (₹)
            </CardTitle>
            <CardDescription className="text-xs">
              Chronological simulated equity progression
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-muted/60 border border-border text-xs">
              <span className="text-muted-foreground">Peak:</span>
              <span className="font-mono font-bold text-positive">₹{(maxVal / 100000).toFixed(2)}L</span>
            </div>
            <Badge variant={isPositive ? 'positive' : 'negative'} className="font-mono font-bold text-xs gap-1">
              <ArrowUpRight className="w-3.5 h-3.5" />
              {netProfitPct >= 0 ? '+' : ''}{netProfitPct.toFixed(2)}% Return
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={isLight ? 0.35 : 0.4} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={isLight ? 'rgba(148,163,184,0.18)' : 'rgba(255,255,255,0.04)'} vertical={false} />
              <XAxis
                dataKey="date"
                stroke={isLight ? '#64748b' : '#94a3b8'}
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: isLight ? '#cbd5e1' : 'rgba(255,255,255,0.08)' }}
              />
              <YAxis
                domain={yDomain}
                stroke={isLight ? '#64748b' : '#94a3b8'}
                fontSize={10}
                tickLine={false}
                axisLine={{ stroke: isLight ? '#cbd5e1' : 'rgba(255,255,255,0.08)' }}
                tickFormatter={(v) => `₹${(v / 100000).toFixed(1)}L`}
                width={65}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="#0ea5e9"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#equityGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
