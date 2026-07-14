'use client';
import { useState, useEffect } from 'react';

interface LiveState {
  state: { C: number; R: number; S: number; M: number | null };
  total_runs: number;
}

interface Stats {
  total_receipts?: number;
  governed_turns?: number;
  intervention_rate_pct?: number;
  avg_stability_margin?: number;
}

export default function LiveStatsBar() {
  const [liveState, setLiveState]         = useState<LiveState | null>(null);
  const [stats, setStats]                 = useState<Stats | null>(null);
  const [interceptRate, setInterceptRate] = useState<number | null>(null);
  const [receiptCount, setReceiptCount]   = useState<number | null>(null);
  const [flash, setFlash]                 = useState(false);
  const [loaded, setLoaded]               = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [stateRes, auditsRes, statsRes] = await Promise.all([
          fetch('/api/live-state'),
          fetch('/api/audits/recent?limit=20'),
          fetch('/api/stats'),
        ]);
        if (stateRes.ok) {
          const d = await stateRes.json() as LiveState;
          setFlash(true);
          setLiveState(d);
          setTimeout(() => setFlash(false), 400);
        }
        if (auditsRes.ok) {
          const d = await auditsRes.json() as { receipts?: { intervention: boolean }[]; total?: number };
          const r = d.receipts ?? [];
          if (r.length > 0) setInterceptRate(Math.round(r.filter(x => x.intervention).length / r.length * 100));
        }
        // Canonical receipt total: /api/stats reads COUNT(*) over praxis_receipts —
        // the single source of truth. Prefer it over the audits-page total (which
        // can reflect the page limit). Falls back gracefully if stats is down.
        if (statsRes.ok) {
          const s = await statsRes.json() as Stats;
          setStats(s);
          if (typeof s.total_receipts === 'number') setReceiptCount(s.total_receipts);
        }
      } catch { /* keep existing */ } finally { setLoaded(true); }
    };
    load();
    // fix (2026-07-10): 10s -> 60s. /api/live-state, /api/audits/recent, and
    // /api/stats all now carry server-side caching (60s/30s/300s respectively
    // — see each route's 2026-07-10 fix note) to address Turso reporting
    // ~80% of its row-read quota consumed. Polling faster than the fastest
    // of those cache windows only re-fetched the same cached response
    // repeatedly without ever seeing fresher data — wasted requests, no
    // benefit. 60s matches /api/live-state's window (the fastest-changing of
    // the three) without polling faster than any of them can actually update.
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  const M            = liveState?.state?.M ?? null;
  const healthColor  = M === null ? '#c9a84c' : M > 0.15 ? '#10b981' : M > 0.05 ? '#f59e0b' : '#ef4444';
  const healthLabel  = M === null ? '—'       : M > 0.15 ? 'SAFE'    : M > 0.05 ? 'ALERT'   : 'CRITICAL';

  // Governed-turns cell prefers the canonical count of persisted receipts
  // (praxis_receipts) from /api/stats, falling back to the run_stats counter.
  const governedTurns = stats?.governed_turns ?? liveState?.total_runs ?? null;

  // Every cell below reads live deployment state and refreshes on a 60s poll.
  const cells = [
    {
      label: 'Governed Turns',
      value: !loaded ? '…' : governedTurns !== null ? governedTurns.toLocaleString() : '—',
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
      label: 'Audit Receipts',
      value: !loaded ? '…' : receiptCount !== null ? receiptCount.toLocaleString() : '—',
      sub:   'SHA-256 · append-only · canonical',
      color: '#10b981',
      pulse: true,
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
              <span className="text-[10px] font-mono text-slate-600 dark:text-slate-500 whitespace-nowrap font-bold uppercase tracking-wider">{label}</span>
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
