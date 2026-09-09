import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown } from 'lucide-react';

export function MetricCard({
  title,
  label,
  value,
  subtitle,
  description,
  change,
  trend, // 'up' | 'down' | 'neutral'
  changeType, // 'positive' | 'negative' | 'neutral'
  icon: Icon,
  variant = 'default', // 'default' | 'positive' | 'negative' | 'warning'
  className,
}) {
  const displayTitle = title || label;
  const displaySubtitle = subtitle || description;

  const resolvedTrend = trend || (changeType === 'positive' ? 'up' : changeType === 'negative' ? 'down' : undefined);

  const variantStyles = {
    default: 'border-border bg-card',
    positive: 'border-emerald-500/20 bg-emerald-500/[0.03]',
    negative: 'border-rose-500/20 bg-rose-500/[0.03]',
    warning: 'border-amber-500/20 bg-amber-500/[0.03]',
  };

  const isUp = resolvedTrend === 'up' || (typeof change === 'number' && change > 0);
  const isDown = resolvedTrend === 'down' || (typeof change === 'number' && change < 0);

  return (
    <Card className={cn('overflow-hidden shadow-xs hover:border-border/90 transition-colors', variantStyles[variant], className)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {displayTitle}
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black tracking-tight text-foreground font-mono">
                {value ?? '—'}
              </span>
              {change !== undefined && change !== null && (
                <span
                  className={cn(
                    'inline-flex items-center text-xs font-bold font-mono',
                    isUp && 'text-emerald-600 dark:text-emerald-400',
                    isDown && 'text-rose-600 dark:text-rose-400',
                    !isUp && !isDown && 'text-muted-foreground'
                  )}
                >
                  {isUp && <TrendingUp className="w-3 h-3 mr-0.5" />}
                  {isDown && <TrendingDown className="w-3 h-3 mr-0.5" />}
                  {typeof change === 'number' ? `${change > 0 ? '+' : ''}${change.toFixed(2)}%` : change}
                </span>
              )}
            </div>
            {displaySubtitle && (
              <div className="text-[11px] text-muted-foreground font-normal">
                {displaySubtitle}
              </div>
            )}
          </div>

          {Icon && (
            <div className="p-2 rounded-md bg-secondary/80 text-muted-foreground">
              <Icon className="w-4 h-4 text-foreground/80" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default MetricCard;
