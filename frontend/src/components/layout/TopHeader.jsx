import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Menu,
  Sun,
  Moon,
  Zap,
  Activity,
  CheckCircle2,
  AlertCircle,
  Bell,
  SlidersHorizontal,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function TopHeader({
  systemStatus,
  alertsCount = 0,
  theme,
  onToggleTheme,
  onToggleSidebar,
  onOpenMobileMenu,
  onNavigateTab,
  activeTab,
}) {
  const isHealthy = systemStatus?.status === 'healthy';
  const eodCount = systemStatus?.database?.eod_rows;

  return (
    <header className="sticky top-0 z-40 h-13 w-full border-b border-border bg-card/95 backdrop-blur-md px-3 sm:px-5 flex items-center justify-between transition-colors">
      {/* Left side: Brand + Mobile Trigger */}
      <div className="flex items-center gap-3">
        {/* Mobile menu trigger */}
        <Button
          variant="ghost"
          size="icon-sm"
          className="md:hidden"
          onClick={onOpenMobileMenu}
          aria-label="Open menu"
        >
          <Menu className="w-4 h-4" />
        </Button>

        {/* Brand */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('dashboard')}
          className="flex items-center gap-2.5 cursor-pointer select-none group"
        >
          <div className="w-7 h-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center font-black shadow-xs">
            <Zap className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-sm sm:text-base tracking-tight text-foreground group-hover:text-primary transition-colors">
              NIFTY<span className="text-primary font-black">FIRST</span>
            </span>
            <Badge variant="outline" className="hidden sm:inline-flex text-[9px] px-1.5 py-0 font-mono font-bold tracking-wider uppercase text-muted-foreground border-border">
              v2.0
            </Badge>
          </div>
        </div>
      </div>

      {/* Right side: Global Indicators & Controls */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* System Health Status Pill */}
        <div
          onClick={() => onNavigateTab && onNavigateTab('system')}
          className="cursor-pointer hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/80 bg-muted/40 hover:bg-muted transition-colors text-[11px] font-mono"
        >
          <span className="relative flex h-2 w-2">
            <span
              className={cn(
                'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                isHealthy ? 'bg-emerald-400' : 'bg-amber-400'
              )}
            />
            <span
              className={cn(
                'relative inline-flex rounded-full h-2 w-2',
                isHealthy ? 'bg-emerald-500' : 'bg-amber-500'
              )}
            />
          </span>
          <span className="text-muted-foreground font-sans">System:</span>
          <span className={cn('font-bold', isHealthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
            {isHealthy ? 'HEALTHY' : 'CHECK'}
          </span>
          {eodCount && (
            <span className="text-muted-foreground/80 hidden lg:inline-block">
              · {Number(eodCount).toLocaleString()} EOD
            </span>
          )}
        </div>

        {/* Alerts count shortcut */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onNavigateTab && onNavigateTab('alerts')}
          className={cn(
            'relative h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground',
            activeTab === 'alerts' && 'bg-accent text-foreground'
          )}
          title="Watchlist Alerts"
        >
          <Bell className="w-3.5 h-3.5 mr-1" />
          <span className="hidden sm:inline">Alerts</span>
          {alertsCount > 0 && (
            <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold font-mono bg-rose-500 text-white">
              {alertsCount}
            </span>
          )}
        </Button>

        {/* Theme Switcher */}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          className="text-muted-foreground hover:text-foreground cursor-pointer"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-slate-700" />
          )}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </div>
    </header>
  );
}
