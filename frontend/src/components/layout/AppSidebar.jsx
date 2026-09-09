import React from 'react';
import {
  LayoutDashboard,
  BarChart3,
  SlidersHorizontal,
  Layers,
  Search,
  Gauge,
  Bell,
  ShieldAlert,
  Activity,
  ChevronLeft,
  ChevronRight,
  Database,
  Terminal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export const NAVIGATION_ITEMS = [
  {
    group: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, badge: null },
    ],
  },
  {
    group: 'Quantitative Lab',
    items: [
      { id: 'backtest', label: 'Backtesting Lab', icon: BarChart3, badge: 'Strategy' },
      { id: 'screener', label: 'Smart Screener', icon: SlidersHorizontal, badge: 'Scanner' },
      { id: 'deals', label: 'Deals Explorer', icon: Layers, badge: 'Feeds' },
    ],
  },
  {
    group: 'Market Intelligence',
    items: [
      { id: 'stocks', label: 'Stock Intelligence', icon: Search, badge: 'Technicals' },
      { id: 'conviction', label: 'Insider Conviction', icon: Gauge, badge: 'Scoring' },
      { id: 'alerts', label: 'Alerts & Filters', icon: Bell, badgeKey: 'alerts' },
    ],
  },
  {
    group: 'Governance & Operations',
    items: [
      { id: 'symbol-matching', label: 'Symbol Governance', icon: ShieldAlert, badge: 'Safety' },
      { id: 'system', label: 'System Health', icon: Activity, badge: 'Pipelines' },
    ],
  },
];

export default function AppSidebar({
  activeTab,
  setActiveTab,
  collapsed = false,
  onToggleCollapsed,
  mobileOpen = false,
  onMobileOpenChange,
  alertsCount = 0,
}) {
  const handleSelect = (tabId) => {
    setActiveTab(tabId);
    if (onMobileOpenChange) onMobileOpenChange(false);
  };

  const renderNavGroup = (group, isMobile = false) => {
    return (
      <div key={group.group} className="space-y-1 mb-4">
        {(!collapsed || isMobile) && (
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1 select-none">
            {group.group}
          </p>
        )}
        {group.items.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const badgeVal = item.badgeKey === 'alerts' && alertsCount > 0 ? alertsCount : item.badge;

          return (
            <button
              key={item.id}
              onClick={() => handleSelect(item.id)}
              title={collapsed && !isMobile ? item.label : undefined}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-semibold transition-all select-none cursor-pointer',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                collapsed && !isMobile ? 'justify-center px-0' : 'justify-start'
              )}
            >
              <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-primary-foreground' : 'text-muted-foreground')} />

              {(!collapsed || isMobile) && (
                <span className="truncate flex-1 text-left">{item.label}</span>
              )}

              {(!collapsed || isMobile) && badgeVal && (
                <span
                  className={cn(
                    'text-[10px] font-mono px-1.5 py-0.2 rounded font-bold uppercase',
                    item.badgeKey === 'alerts'
                      ? 'bg-rose-500 text-white'
                      : isActive
                      ? 'bg-primary-foreground/20 text-primary-foreground'
                      : 'bg-muted text-muted-foreground border border-border/80'
                  )}
                >
                  {badgeVal}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col border-r border-border bg-sidebar shrink-0 transition-all duration-200 select-none z-30',
          collapsed ? 'w-16' : 'w-56 lg:w-60'
        )}
      >
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {NAVIGATION_ITEMS.map((g) => renderNavGroup(g, false))}
        </div>

        {/* Footer with Collapse Toggle */}
        <div className="p-2 border-t border-border flex items-center justify-between">
          {!collapsed && (
            <div className="px-2 py-1 text-[11px] font-mono text-muted-foreground flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              <span>NiftyFirst v2.0</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapsed}
            className={cn('text-muted-foreground hover:text-foreground', collapsed && 'mx-auto')}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </Button>
        </div>
      </aside>

      {/* Mobile Drawer Sheet */}
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetContent side="left" className="p-0 w-72 bg-sidebar border-border">
          <SheetHeader className="p-4 border-b border-border text-left">
            <SheetTitle className="text-sm font-black flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-primary text-primary-foreground flex items-center justify-center">
                ⚡
              </div>
              <span>NIFTYFIRST QUANT</span>
            </SheetTitle>
          </SheetHeader>
          <div className="p-3 overflow-y-auto">
            {NAVIGATION_ITEMS.map((g) => renderNavGroup(g, true))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
