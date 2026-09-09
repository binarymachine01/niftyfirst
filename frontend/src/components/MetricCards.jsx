import React from 'react';
import MetricCard from '@/components/common/MetricCard';
import { TrendingUp, Award, Percent, Scale, AlertTriangle, ShieldCheck } from 'lucide-react';
import { formatINR } from '@/lib/utils';

export default function MetricCards({ summary }) {
  if (!summary) return null;

  const isProfitable = summary.total_return_pct >= 0;
  const netPnL = summary.final_equity - summary.initial_capital;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
      <MetricCard
        title="Strategy Return"
        value={`${isProfitable ? '+' : ''}${summary.total_return_pct.toFixed(2)}%`}
        subtitle={`${isProfitable ? '+₹' : '-₹'}${Math.abs(netPnL).toLocaleString('en-IN')}`}
        trend={isProfitable ? 'up' : 'down'}
        icon={TrendingUp}
        variant={isProfitable ? 'positive' : 'negative'}
      />

      <MetricCard
        title="Win Ratio"
        value={`${summary.win_rate_pct.toFixed(1)}%`}
        subtitle={`${summary.winning_trades}W / ${summary.losing_trades}L`}
        trend={summary.win_rate_pct >= 50 ? 'up' : 'down'}
        icon={Award}
        variant={summary.win_rate_pct >= 50 ? 'positive' : 'warning'}
      />

      <MetricCard
        title="Compounded CAGR"
        value={`${summary.cagr_pct > 0 ? '+' : ''}${summary.cagr_pct.toFixed(2)}%`}
        subtitle="Annualized"
        icon={Percent}
        variant="default"
      />

      <MetricCard
        title="Profit Factor"
        value={summary.profit_factor > 90 ? '∞' : summary.profit_factor.toFixed(2)}
        subtitle={`+${summary.avg_gain_pct.toFixed(1)}% / -${summary.avg_loss_pct.toFixed(1)}%`}
        icon={Scale}
        variant={summary.profit_factor >= 1.5 ? 'positive' : 'default'}
      />

      <MetricCard
        title="Max Drawdown"
        value={`-${summary.max_drawdown_pct.toFixed(2)}%`}
        subtitle="Peak-to-Trough"
        trend="down"
        icon={AlertTriangle}
        variant={summary.max_drawdown_pct < 8 ? 'default' : 'negative'}
      />

      <MetricCard
        title="Sharpe Ratio"
        value={summary.sharpe_ratio.toFixed(2)}
        subtitle={summary.sharpe_ratio >= 1.5 ? 'High Alpha' : 'Moderate'}
        icon={ShieldCheck}
        variant="default"
      />
    </div>
  );
}
