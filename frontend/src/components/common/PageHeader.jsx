import React from 'react';
import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  subtitle,
  description,
  badge,
  actions,
  children,
  className,
}) {
  const desc = subtitle || description;
  const actionContent = actions || children;

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-border/70',
        className
      )}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground">
            {title}
          </h1>
          {badge && (
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
              {badge}
            </span>
          )}
        </div>
        {desc && (
          <p className="text-xs sm:text-sm text-muted-foreground font-normal">
            {desc}
          </p>
        )}
      </div>

      {actionContent && (
        <div className="flex items-center flex-wrap gap-2 pt-1 sm:pt-0">
          {actionContent}
        </div>
      )}
    </div>
  );
}

export default PageHeader;
