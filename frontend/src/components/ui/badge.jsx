import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 tabular-nums',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary: 'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        outline: 'text-foreground border border-border',
        positive: 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-bold',
        negative: 'border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 font-bold',
        warning: 'border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold',
        neutral: 'border border-border bg-muted/60 text-muted-foreground font-medium',
        matched: 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-bold',
        override: 'border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400 font-bold',
        lowConfidence: 'border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold',
        unmatched: 'border border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400 font-bold',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
