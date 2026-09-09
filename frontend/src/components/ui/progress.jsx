import * as React from 'react';
import { cn } from '@/lib/utils';

const Progress = React.forwardRef(({ className, value = 0, max = 100, variant = 'default', ...props }, ref) => {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  const variantClasses = {
    default: 'bg-primary',
    positive: 'bg-emerald-600 dark:bg-emerald-500',
    negative: 'bg-rose-600 dark:bg-rose-500',
    warning: 'bg-amber-600 dark:bg-amber-500',
  };

  return (
    <div
      ref={ref}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      <div
        className={cn('h-full w-full flex-1 transition-all duration-300 ease-in-out', variantClasses[variant] || variantClasses.default)}
        style={{ transform: `translateX(-${100 - percentage}%)` }}
      />
    </div>
  );
});
Progress.displayName = 'Progress';

export { Progress };
