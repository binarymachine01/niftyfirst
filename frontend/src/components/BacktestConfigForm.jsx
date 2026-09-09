import React, { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Play,
  Sparkles,
  Sliders,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  HelpCircle,
} from 'lucide-react';
import { api } from '@/services/api';

const ALL_CATEGORIES = [
  { name: 'Insider Trading', desc: 'Promoter & Executive Filings', badge: 'PIT' },
  { name: 'SAST Deals', desc: 'Substantial Acquisitions', badge: 'SAST' },
  { name: 'Block Deals', desc: 'Institutional Block Window', badge: 'Block' },
  { name: 'Bulk Deals', desc: 'Large Trades (>0.5%)', badge: 'Bulk' },
];

export default function BacktestConfigForm({ config, setConfig, onRunBacktest, loading }) {
  const [presets, setPresets] = useState([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    api.getPresetStrategies().then((res) => {
      if (res?.presets) setPresets(res.presets);
    }).catch((err) => console.error(err));
  }, []);

  const handleCategoryToggle = (categoryName) => {
    const current = config.categories || [];
    if (current.includes(categoryName)) {
      if (current.length > 1) {
        setConfig({ ...config, categories: current.filter((c) => c !== categoryName) });
      }
    } else {
      setConfig({ ...config, categories: [...current, categoryName] });
    }
  };

  const applyPreset = (preset) => {
    setConfig({
      ...config,
      ...preset.config,
    });
  };

  return (
    <Card>
      <CardHeader className="p-4 sm:p-5 border-b border-border/80">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-md bg-primary/10 text-primary">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm sm:text-base font-bold text-foreground">
                Strategy Parameters
              </CardTitle>
              <CardDescription className="text-xs">
                Quantitative simulation model inputs
              </CardDescription>
            </div>
          </div>

          {/* Preset Strategies Quick Select */}
          {presets.length > 0 && (
            <div className="w-44">
              <Select
                onValueChange={(val) => {
                  const found = presets.find((p) => p.id === val);
                  if (found) applyPreset(found);
                }}
              >
                <SelectTrigger className="h-7 text-[11px]">
                  <Sparkles className="w-3 h-3 text-amber-500 mr-1 shrink-0" />
                  <SelectValue placeholder="Presets..." />
                </SelectTrigger>
                <SelectContent>
                  {presets.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-5 space-y-4">
        {/* Deal Categories Selection */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label className="text-xs">Included Deal Categories</Label>
            <span className="text-[10px] text-muted-foreground font-mono">
              {config.categories?.length || 0} active
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {ALL_CATEGORIES.map((cat) => {
              const isSelected = config.categories?.includes(cat.name);
              return (
                <div
                  key={cat.name}
                  onClick={() => handleCategoryToggle(cat.name)}
                  className={`p-2.5 rounded-md border text-xs cursor-pointer select-none transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/[0.06] text-foreground font-semibold'
                      : 'border-border bg-card hover:bg-muted/50 text-muted-foreground'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs truncate">{cat.name}</span>
                    <Badge variant={isSelected ? 'default' : 'outline'} className="text-[9px] px-1 py-0">
                      {cat.badge}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Primary Parameters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          {/* Holding Days */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label htmlFor="holding_days">Holding Period</Label>
              <span className="font-mono text-xs font-bold text-foreground">
                {config.holding_days} Days
              </span>
            </div>
            <Input
              id="holding_days"
              type="number"
              min="1"
              max="250"
              value={config.holding_days}
              onChange={(e) =>
                setConfig({ ...config, holding_days: parseInt(e.target.value) || 1 })
              }
              className="font-mono text-xs h-8"
            />
          </div>

          {/* Action Filter */}
          <div className="space-y-1.5">
            <Label htmlFor="action_filter">Trade Direction</Label>
            <Select
              value={config.action}
              onValueChange={(val) => setConfig({ ...config, action: val })}
            >
              <SelectTrigger id="action_filter" className="h-8 text-xs font-semibold">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BUY">BUY Only (Long)</SelectItem>
                <SelectItem value="SELL">SELL Only (Short)</SelectItem>
                <SelectItem value="ALL">BUY & SELL</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Initial Capital */}
          <div className="space-y-1.5">
            <Label htmlFor="initial_capital">Portfolio Capital (₹)</Label>
            <Input
              id="initial_capital"
              type="number"
              step="100000"
              value={config.initial_capital}
              onChange={(e) =>
                setConfig({ ...config, initial_capital: parseFloat(e.target.value) || 100000 })
              }
              className="font-mono text-xs h-8"
            />
          </div>

          {/* Allocation per Position */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label htmlFor="position_size">Position Size</Label>
              <span className="font-mono text-xs font-bold text-foreground">
                {config.position_size_pct}%
              </span>
            </div>
            <Input
              id="position_size"
              type="number"
              min="1"
              max="100"
              value={config.position_size_pct}
              onChange={(e) =>
                setConfig({ ...config, position_size_pct: parseFloat(e.target.value) || 10 })
              }
              className="font-mono text-xs h-8"
            />
          </div>
        </div>

        {/* Advanced Risk Settings Toggle */}
        <div className="pt-2 border-t border-border/80">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full justify-between text-xs text-muted-foreground hover:text-foreground h-8 px-2"
          >
            <span>Risk Management (Stop-Loss & Target)</span>
            {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>

          {showAdvanced && (
            <div className="grid grid-cols-2 gap-3 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor="stop_loss">Stop Loss (%)</Label>
                <Input
                  id="stop_loss"
                  type="number"
                  step="0.5"
                  placeholder="Optional (e.g. 5)"
                  value={config.stop_loss_pct || ''}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      stop_loss_pct: e.target.value ? parseFloat(e.target.value) : null,
                    })
                  }
                  className="font-mono text-xs h-8"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="take_profit">Take Profit (%)</Label>
                <Input
                  id="take_profit"
                  type="number"
                  step="1"
                  placeholder="Optional (e.g. 20)"
                  value={config.take_profit_pct || ''}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      take_profit_pct: e.target.value ? parseFloat(e.target.value) : null,
                    })
                  }
                  className="font-mono text-xs h-8"
                />
              </div>
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className="p-4 sm:p-5 pt-0">
        <Button
          onClick={onRunBacktest}
          disabled={loading}
          className="w-full gap-2 font-bold shadow-sm"
        >
          {loading ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              Simulating Quantitative Model...
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" />
              Run Portfolio Simulation
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}
