import React from 'react';
import { TrendingUp, Award, Percent, AlertTriangle, Scale, BarChart2, ShieldCheck, DollarSign, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export default function MetricCards({ summary }) {
  if (!summary) return null;

  const isProfitable = summary.total_return_pct >= 0;

  const metrics = [
    {
      title: 'Strategy Return',
      value: `${summary.total_return_pct > 0 ? '+' : ''}${summary.total_return_pct.toFixed(2)}%`,
      badge: isProfitable ? `+₹${(summary.final_equity - summary.initial_capital).toLocaleString('en-IN')}` : `-₹${(summary.initial_capital - summary.final_equity).toLocaleString('en-IN')}`,
      badgeColor: isProfitable ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      icon: TrendingUp,
      accent: isProfitable ? 'from-emerald-400 to-teal-500' : 'from-rose-400 to-red-500',
      valueColor: isProfitable ? 'text-emerald-400' : 'text-rose-400',
    },
    {
      title: 'Win Ratio',
      value: `${summary.win_rate_pct.toFixed(1)}%`,
      badge: `${summary.winning_trades}W / ${summary.losing_trades}L`,
      badgeColor: summary.win_rate_pct >= 50 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      icon: Award,
      accent: 'from-amber-400 to-orange-500',
      valueColor: summary.win_rate_pct >= 50 ? 'text-emerald-300' : 'text-amber-300',
      winLossRatio: summary.total_trades > 0 ? (summary.winning_trades / summary.total_trades) * 100 : 0,
    },
    {
      title: 'Compounded CAGR',
      value: `${summary.cagr_pct > 0 ? '+' : ''}${summary.cagr_pct.toFixed(2)}%`,
      badge: 'Annualized',
      badgeColor: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
      icon: Percent,
      accent: 'from-cyan-400 to-blue-500',
      valueColor: 'text-cyan-400',
    },
    {
      title: 'Profit Factor',
      value: summary.profit_factor > 90 ? '∞' : summary.profit_factor.toFixed(2),
      badge: `+${summary.avg_gain_pct.toFixed(1)}% / -${summary.avg_loss_pct.toFixed(1)}%`,
      badgeColor: summary.profit_factor >= 1.5 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-800 text-slate-400 border-white/10',
      icon: Scale,
      accent: 'from-blue-400 to-indigo-500',
      valueColor: summary.profit_factor >= 1.5 ? 'text-emerald-400' : 'text-slate-200',
    },
    {
      title: 'Max Drawdown',
      value: `-${summary.max_drawdown_pct.toFixed(2)}%`,
      badge: 'Peak-to-Trough',
      badgeColor: summary.max_drawdown_pct < 8 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      icon: AlertTriangle,
      accent: 'from-rose-400 to-pink-600',
      valueColor: summary.max_drawdown_pct < 8 ? 'text-emerald-400' : 'text-rose-400',
    },
    {
      title: 'Sharpe Ratio',
      value: summary.sharpe_ratio.toFixed(2),
      badge: summary.sharpe_ratio >= 1.5 ? 'High Alpha' : 'Moderate',
      badgeColor: 'bg-purple-500/10 text-purple-300 border-purple-500/20',
      icon: ShieldCheck,
      accent: 'from-purple-400 to-indigo-500',
      valueColor: 'text-purple-300',
    },
    {
      title: 'Total Signals',
      value: summary.total_trades.toString(),
      badge: `₹${(summary.final_equity / 100000).toFixed(1)}L Capital`,
      badgeColor: 'bg-slate-800 text-slate-300 border-white/10',
      icon: BarChart2,
      accent: 'from-sky-400 to-blue-600',
      valueColor: 'text-white',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3.5 mb-6">
      {metrics.map((m, idx) => {
        const Icon = m.icon;
        return (
          <div
            key={idx}
            className="glass-panel metric-card p-4 flex flex-col justify-between rounded-2xl group hover:-translate-y-1 transition-all duration-200"
          >
            {/* Top Bar Glow Accent */}
            <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${m.accent} opacity-80`} />

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase">
                  {m.title}
                </span>
                <div className="p-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-slate-300 group-hover:text-cyan-400 transition-colors">
                  <Icon className="w-3.5 h-3.5" />
                </div>
              </div>

              <div className={`text-2xl font-black font-mono tracking-tight ${m.valueColor} mt-1`}>
                {m.value}
              </div>
            </div>

            <div className="mt-3 pt-2 border-t border-white/[0.06] flex items-center justify-between">
              <span className={`text-[10px] font-bold font-mono px-2 py-0.5 rounded-md border ${m.badgeColor} truncate max-w-[120px]`}>
                {m.badge}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
