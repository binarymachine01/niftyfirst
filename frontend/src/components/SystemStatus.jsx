import React, { useState, useEffect, useRef } from 'react';
import { Database, CheckCircle2, RefreshCw, Terminal, Layers, Play, Square, Clock, X, AlertTriangle, Check, Copy, ChevronRight, FileText } from 'lucide-react';
import { api } from '../services/api';

export default function SystemStatus({ systemStatus, onRefreshStatus }) {
  const [loading, setLoading] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [taskData, setTaskData] = useState(null);
  const [recentTasks, setRecentTasks] = useState([]);
  const [showLogModal, setShowLogModal] = useState(false);

  // Script Form States
  const [insiderMode, setInsiderMode] = useState('daily'); // daily, quick, 5pages, full
  const [nseMode, setNseMode] = useState('today'); // today, date, range
  const [nseDate, setNseDate] = useState('2026-08-20');
  const [nseStartDate, setNseStartDate] = useState('2026-08-01');
  const [nseEndDate, setNseEndDate] = useState('2026-08-20');
  const [nseForce, setNseForce] = useState(false);

  const logContainerRef = useRef(null);
  const db = systemStatus?.database;

  // Poll for active task status
  useEffect(() => {
    let interval = null;
    if (activeTaskId) {
      interval = setInterval(async () => {
        try {
          const res = await api.getTaskStatus(activeTaskId);
          if (res?.task) {
            setTaskData(res.task);
            if (res.task.status !== 'RUNNING') {
              clearInterval(interval);
              // Refresh database stats on completion
              onRefreshStatus();
              fetchRecentTasks();
            }
          }
        } catch (err) {
          console.error(err);
        }
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeTaskId]);

  // Autoscroll terminal logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [taskData?.logs]);

  const fetchRecentTasks = async () => {
    try {
      const res = await api.getTasks();
      if (res?.tasks) setRecentTasks(res.tasks);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchRecentTasks();
  }, []);

  const handleRunInsider = async () => {
    let args = [];
    if (insiderMode === 'quick') args = ['--max-pages', '1'];
    else if (insiderMode === '5pages') args = ['--max-pages', '5'];
    else if (insiderMode === 'full') args = ['--full-sync'];

    try {
      const res = await api.runScript('insider_data_extractor', args);
      if (res?.task?.task_id) {
        setActiveTaskId(res.task.task_id);
        setShowLogModal(true);
      }
    } catch (err) {
      alert(`Failed to start script: ${err.response?.data?.detail || err.message}`);
    }
  };

  const handleRunNSE = async () => {
    let args = [];
    if (nseMode === 'today') args = ['--today'];
    else if (nseMode === 'date') args = ['--date', nseDate];
    else if (nseMode === 'range') args = ['--from', nseStartDate, '--to', nseEndDate];

    if (nseForce) {
      args.push('--force');
    }

    try {
      const res = await api.runScript('nse_eod', args);
      if (res?.task?.task_id) {
        setActiveTaskId(res.task.task_id);
        setShowLogModal(true);
      }
    } catch (err) {
      alert(`Failed to start script: ${err.response?.data?.detail || err.message}`);
    }
  };

  const handleRunAll = async () => {
    try {
      const res = await api.runScript('all', []);
      if (res?.task?.task_id) {
        setActiveTaskId(res.task.task_id);
        setShowLogModal(true);
      }
    } catch (err) {
      alert(`Failed to start batch run: ${err.response?.data?.detail || err.message}`);
    }
  };

  const handleStopTask = async () => {
    if (!activeTaskId) return;
    try {
      await api.stopTask(activeTaskId);
    } catch (err) {
      console.error(err);
    }
  };

  const tables = [
    {
      name: 'Equities EOD Candles',
      table: 'nse_equity_eod',
      count: db?.eod_rows || 0,
      description: 'Historical Bhavcopy daily OHLCV & delivery statistics',
      extra: db?.min_eod_date ? `${db.min_eod_date} to ${db.max_eod_date}` : 'N/A',
      color: 'text-cyan-400',
      borderAccent: 'border-cyan-500/30',
    },
    {
      name: 'Insider Trading Deals',
      table: 'stockedge_insider_deals',
      count: db?.insider_deals || 0,
      description: 'Promoter & employee PIT trade disclosures',
      extra: 'SEBI PIT Disclosures',
      color: 'text-emerald-400',
      borderAccent: 'border-emerald-500/30',
    },
    {
      name: 'SAST Substantial Deals',
      table: 'stockedge_sast_deals',
      count: db?.sast_deals || 0,
      description: 'Substantial Acquisition of Shares & Takeovers',
      extra: 'SEBI SAST Regulations',
      color: 'text-purple-400',
      borderAccent: 'border-purple-500/30',
    },
    {
      name: 'Institutional Block Deals',
      table: 'stockedge_block_deals',
      count: db?.block_deals || 0,
      description: 'Exchange block window institutional transactions',
      extra: 'Min ₹10 Crore / 5L Shares',
      color: 'text-amber-400',
      borderAccent: 'border-amber-500/30',
    },
    {
      name: 'Market Bulk Deals',
      table: 'stockedge_bulk_deals',
      count: db?.bulk_deals || 0,
      description: 'Deals exceeding 0.5% of total company equity',
      extra: 'Exchange Bulk Window',
      color: 'text-blue-400',
      borderAccent: 'border-blue-500/30',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Overview Status Banner */}
      <div className="glass-panel p-6 rounded-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3.5 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 shadow-lg shadow-emerald-500/10">
              <Database className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-extrabold text-white tracking-tight">
                  PostgreSQL Data Cluster & Pipeline Control
                </h2>
                <span className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Operational
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Connected to database <code className="text-cyan-300 font-bold">nse_market_data</code> on port <code className="text-slate-300">5432</code>
              </p>
            </div>
          </div>

          <button
            onClick={async () => {
              setLoading(true);
              await onRefreshStatus();
              await fetchRecentTasks();
              setLoading(false);
            }}
            disabled={loading}
            className="btn-secondary text-xs py-2 px-3.5 flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh Telemetry
          </button>
        </div>
      </div>

      {/* Interactive Script Execution Cards (Run from UI) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-extrabold text-white tracking-tight flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            Interactive Ingestion Pipelines (Execute Live from UI)
          </h3>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Card 1: Insider Trading & Deals Extractor */}
          <div className="glass-panel p-5 rounded-2xl flex flex-col justify-between border-t-2 border-cyan-500/40">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white tracking-wide">StockEdge Deals Extractor</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  Deduplication Engine
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Extracts Block, Bulk, Insider Trading, and SAST deals into PostgreSQL with automatic duplicate skipping.
              </p>

              {/* Options */}
              <div className="space-y-2 mb-4">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                  Execution Mode
                </label>
                <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
                  {[
                    { id: 'daily', label: 'Daily Sync', desc: 'Stops on DB duplicate' },
                    { id: 'quick', label: '1 Page Test', desc: 'Quick 20 deals' },
                    { id: '5pages', label: '5 Pages', desc: '100 deals fetch' },
                    { id: 'full', label: 'Full Sync', desc: 'Deep historical sync' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setInsiderMode(opt.id)}
                      className={`p-2 rounded-xl text-left border transition-all ${
                        insiderMode === opt.id
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-bold'
                          : 'bg-slate-950/60 text-slate-400 border-white/5 hover:border-white/15'
                      }`}
                    >
                      <div className="text-[11px]">{opt.label}</div>
                      <div className="text-[9px] text-slate-500 font-sans">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleRunInsider}
              disabled={taskData?.status === 'RUNNING'}
              className="btn-primary w-full py-2.5 text-xs tracking-wider uppercase font-bold disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-slate-950" /> Run Deals Ingestion
            </button>
          </div>

          {/* Card 2: NSE EOD Bhavcopy Ingestion */}
          <div className="glass-panel p-5 rounded-2xl flex flex-col justify-between border-t-2 border-emerald-500/40">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white tracking-wide">NSE EOD Bhavcopy Pipeline</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  CM + F&O + Indices
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Downloads daily official NSE Bhavcopies with delivery statistics and bulk upserts into `nse_equity_eod`.
              </p>

              {/* Options */}
              <div className="space-y-2 mb-4">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                  Date Selection
                </label>
                <div className="grid grid-cols-3 gap-1.5 text-xs font-mono">
                  {[
                    { id: 'today', label: 'Today' },
                    { id: 'date', label: 'Single Date' },
                    { id: 'range', label: 'Date Range' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setNseMode(opt.id)}
                      className={`p-2 rounded-xl text-center border transition-all ${
                        nseMode === opt.id
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold'
                          : 'bg-slate-950/60 text-slate-400 border-white/5 hover:border-white/15'
                      }`}
                    >
                      <div className="text-[11px]">{opt.label}</div>
                    </button>
                  ))}
                </div>

                {nseMode === 'date' && (
                  <input
                    type="date"
                    value={nseDate}
                    onChange={(e) => setNseDate(e.target.value)}
                    className="glass-input w-full text-xs font-mono mt-2"
                  />
                )}

                {nseMode === 'range' && (
                  <div className="grid grid-cols-2 gap-2 mt-2 font-mono text-xs">
                    <input
                      type="date"
                      value={nseStartDate}
                      onChange={(e) => setNseStartDate(e.target.value)}
                      className="glass-input w-full text-xs"
                    />
                    <input
                      type="date"
                      value={nseEndDate}
                      onChange={(e) => setNseEndDate(e.target.value)}
                      className="glass-input w-full text-xs"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-white/5">
                  <input
                    type="checkbox"
                    id="nseForceCheck"
                    checked={nseForce}
                    onChange={(e) => setNseForce(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 focus:ring-offset-0 cursor-pointer h-3.5 w-3.5"
                  />
                  <label htmlFor="nseForceCheck" className="text-[11px] text-slate-400 cursor-pointer select-none">
                    Force re-download / overwrite if date exists
                  </label>
                </div>
              </div>
            </div>

            <button
              onClick={handleRunNSE}
              disabled={taskData?.status === 'RUNNING'}
              className="btn-secondary w-full py-2.5 text-xs tracking-wider uppercase font-bold text-emerald-300 hover:text-white disabled:opacity-50 border-emerald-500/30"
            >
              <Play className="w-3.5 h-3.5 fill-emerald-400 text-emerald-400" /> Run Bhavcopy Ingestion
            </button>
          </div>

          {/* Card 3: Batch All Pipelines */}
          <div className="glass-panel p-5 rounded-2xl flex flex-col justify-between border-t-2 border-purple-500/40">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white tracking-wide">Batch Sequential Execution</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  Full Pipeline
                </span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Executes all registered market data pipelines (NSE EOD Bhavcopy and StockEdge Deals) sequentially.
              </p>

              <div className="p-3 rounded-xl bg-slate-950/70 border border-white/5 text-xs text-slate-300 space-y-1 mb-4">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-purple-400" /> 1. NSE Bhavcopy (Today)
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-purple-400" /> 2. Insider Deals Extractor
                </div>
              </div>
            </div>

            <button
              onClick={handleRunAll}
              disabled={taskData?.status === 'RUNNING'}
              className="btn-secondary w-full py-2.5 text-xs tracking-wider uppercase font-bold text-purple-300 hover:text-white disabled:opacity-50 border-purple-500/30"
            >
              <Play className="w-3.5 h-3.5 fill-purple-400 text-purple-400" /> Run All Daily Pipelines
            </button>
          </div>
        </div>
      </div>

      {/* Database Table Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {tables.map((t, idx) => (
          <div
            key={idx}
            className={`glass-panel p-5 flex flex-col justify-between rounded-2xl border-t-2 ${t.borderAccent} hover:-translate-y-1 transition-all duration-200`}
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-white tracking-wide">{t.name}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-white/5">
                  {t.table}
                </span>
              </div>
              <div className={`text-3xl font-black font-mono tracking-tight ${t.color} my-2`}>
                {t.count.toLocaleString()} <span className="text-xs font-normal text-slate-400 font-sans">Rows</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">{t.description}</p>
            </div>

            <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-slate-500 font-mono">
              <span>Scope:</span>
              <span className="text-slate-300 font-medium">{t.extra}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Live Terminal Modal / Drawer */}
      {showLogModal && taskData && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel-elevated w-full max-w-4xl max-h-[85vh] rounded-2xl overflow-hidden flex flex-col border border-cyan-500/30 shadow-2xl">
            {/* Modal Header */}
            <div className="p-4 bg-[#0a0e1a] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Terminal className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white">{taskData.script_name}</h3>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                      taskData.status === 'RUNNING'
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 animate-pulse'
                        : taskData.status === 'SUCCESS'
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                    }`}>
                      {taskData.status}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 truncate max-w-md">
                    {taskData.command}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {taskData.status === 'RUNNING' && (
                  <button
                    onClick={handleStopTask}
                    className="btn-secondary text-xs py-1.5 px-3 text-rose-400 hover:text-rose-300 border-rose-500/30"
                  >
                    <Square className="w-3.5 h-3.5 fill-rose-400" /> Stop Process
                  </button>
                )}
                <button
                  onClick={() => setShowLogModal(false)}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Terminal Log Console */}
            <div
              ref={logContainerRef}
              className="flex-1 p-4 bg-[#050811] overflow-y-auto font-mono text-xs text-slate-300 space-y-1 max-h-[500px]"
            >
              {taskData.logs?.length === 0 ? (
                <div className="text-slate-500 flex items-center gap-2 py-4">
                  <span className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                  Initializing process and connecting output stream...
                </div>
              ) : (
                taskData.logs.map((l, idx) => (
                  <div key={idx} className="flex items-start gap-3 hover:bg-white/[0.02] py-0.5 px-1 rounded">
                    <span className="text-slate-600 select-none text-[10px] font-mono">{l.time}</span>
                    <span className="flex-1 whitespace-pre-wrap leading-relaxed text-slate-200">
                      {l.text}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 bg-[#0a0e1a] border-t border-white/10 flex items-center justify-between text-xs text-slate-400 font-mono">
              <div>
                Started: <span className="text-slate-200">{taskData.start_time?.split('T')[1]?.split('.')[0]}</span>
                {taskData.end_time && (
                  <> | Finished: <span className="text-slate-200">{taskData.end_time?.split('T')[1]?.split('.')[0]}</span></>
                )}
              </div>
              <button
                onClick={() => setShowLogModal(false)}
                className="btn-primary py-1 px-4 text-xs font-bold"
              >
                Close Console
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
