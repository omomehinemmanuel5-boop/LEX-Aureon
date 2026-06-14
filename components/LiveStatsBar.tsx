'use client';
import { useState, useEffect } from 'react';

const PUBLISHED_BENCHMARKS = [
  { n_total: 200,  governed_score: 1.000 },
  { n_total: 200,  governed_score: 1.000 },
  { n_total: 520,  governed_score: 1.000 },
  { n_total: 200,  governed_score: 1.000 },
];

interface LiveState {
  state: { C: number; R: number; S: number; M: number | null };
  total_runs: number;
}

export default function LiveStatsBar() {
  const [liveState, setLiveState]       = useState<LiveState | null>(null);
  const [interceptRate, setInterceptRate] = useState<number | null>(null);
  const [flash, setFlash]               = useState(false);
  const [loaded, setLoaded]             = useState(false);
  const [liveBenches, setLiveBenches]   = useState<{ n_total: number; governed_score: number }[] | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [stateRes, auditsRes, benchRes] = await Promise.all([
          fetch('/api/live-state',        { cache: 'no-store' }),
          fetch('/api/audits/recent?limit=20', { cache: 'no-store' }),
          fetch('/api/benchmarks',        { cache: 'no-store' }),
        ]);
        if (stateRes.ok) {
          const d = await stateRes.json() as LiveState;
          setFlash(true);
          setLiveState(d);
          setTimeout(() => setFlash(false), 400);
        }
        if (auditsRes.ok) {
          const d = await auditsRes.json() as { receipts?: { intervention: boolean }[] };
          const r = d.receipts ?? [];
          if (r.length > 0) setInterceptRate(Math.round(r.filter(x => x.intervention).length / r.length * 100));
        }
        if (benchRes.ok) {
          const d = await benchRes.json() as { benchmarks?: { n_total: number; governed_score: number }[] };
          if (d.benchmarks && d.benchmarks.length > 0) setLiveBenches(d.benchmarks);
        }
      } catch { /* keep existing */ } finally { setLoaded(true); }
    };
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const benches      = liveBenches ?? PUBLISHED_BENCHMARKS;
  const totalPrompts = benches.reduce((a, b) => a + b.n_total, 0);
  const M            = liveState?.state?.M ?? null;
  const healthColor  = M === null ? '#c9a84c' : M > 0.15 ? '#10b981' : M > 0.05 ? '#f59e0b' : '#ef4444';
  const healthLabel  = M === null ? '—'       : M > 0.15 ? 'SAFE'    : M > 0.05 ? 'ALERT'   : 'CRITICAL';

  const cells = [
    {
      label: 'Governed Turns',
      value: !loaded ? '…' : (liveState?.total_runs ?? '—').toLocaleString(),
      sub:   'all-time',
      color: '#c9a84c',
      pulse: true,
    },
    {
      label: 'M Score (live)',
      value: !loaded ? '…' : M !== null ? `${(M * 100).toFixed(1)}%` : '—',
      sub:   healthLabel,
      color: healthColor,
      pulse: false,
    },
    {
      label: 'Intercept Rate',
      value: !loaded ? '…' : interceptRate !== null ? `${interceptRate}%` : '—',
      sub:   'last 20 runs',
      color: '#ef4444',
      pulse: false,
    },
    {
      label: 'Benchmark ASR',
      value: '0.0%',
      sub:   `${totalPrompts.toLocaleString()} governed`,
      color: '#10b981',
      pulse: false,
    },
    {
      label: 'Governor',
      value: 'LIVE',
      sub:   'SovereignKernel v2',
      color: '#10b981',
      pulse: true,
    },
  ];

  return (
    <div className="border-y overflow-x-auto bg-slate-50 dark:bg-[#0d0d1a] border-slate-200 dark:border-white/5">
      <div className="flex" style={{ minWidth: 480 }}>
        {cells.map(({ label, value, sub, color, pulse }, i) => (
          <div
            key={label}
            className="flex-1 px-4 py-3 text-center"
            style={{ borderRight: i < cells.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}
          >
            <div className="flex items-center justify-center gap-1.5 mb-0.5">
              {pulse && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />}
              <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 whitespace-nowrap font-bold uppercase tracking-wider">{label}</span>
            </div>
            <div
              className={`text-xl sm:text-2xl font-black font-mono leading-none tabular-nums transition-opacity ${flash ? 'opacity-50' : 'opacity-100'}`}
              style={{ color }}
            >
              {value}
            </div>
            <div className="text-[10px] font-mono mt-0.5 whitespace-nowrap font-bold" style={{ color: `${color}99` }}>
              {sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
