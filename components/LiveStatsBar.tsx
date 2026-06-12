'use client';
import { useState, useEffect } from 'react';

const G = { gold: '#c9a84c', navy: '#07070d', navyL: '#0d0d1a' } as const;

// ── Published benchmark constants ─────────────────────────────────────────────
// Source: HarmBench (200) + JailbreakBench (200) + AdvBench (520) = 920 governed prompts
// ASR = 0/920 bypasses. Update this value if new benchmark runs are added.
const PUBLISHED_ASR_PCT  = '0.0%';
const PUBLISHED_PROMPTS  = '920';

interface LiveState {
  state: { C: number; R: number; S: number; M: number | null };
  total_runs: number;
}

// Skeleton pill shown while waiting for first API response
function Skeleton() {
  return (
    <div className="h-4 w-10 rounded animate-pulse mx-auto" style={{ background: 'rgba(255,255,255,0.05)' }} />
  );
}

export default function LiveStatsBar() {
  const [liveState, setLiveState] = useState<LiveState | null>(null);
  const [interceptRate, setInterceptRate] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [stateRes, auditsRes] = await Promise.all([
          fetch('/api/live-state', { cache: 'no-store' }),
          fetch('/api/audits/recent?limit=20', { cache: 'no-store' }),
        ]);
        if (stateRes.ok) {
          const d = await stateRes.json() as LiveState;
          setFlash(true);
          setLiveState(d);
          setTimeout(() => setFlash(false), 400);
        }
        if (auditsRes.ok) {
          const d = await auditsRes.json() as { receipts?: { intervention: boolean }[] };
          const receipts = d.receipts ?? [];
          if (receipts.length > 0) {
            setInterceptRate(
              Math.round(receipts.filter(r => r.intervention).length / receipts.length * 100)
            );
          }
        }
      } catch {
        // silently keep existing values
      } finally {
        setLoaded(true);
      }
    };
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  const M = liveState?.state?.M ?? null;
  const healthColor  = M === null ? G.gold : M > 0.15 ? '#22c55e' : M > 0.05 ? '#f59e0b' : '#ef4444';
  const healthLabel  = M === null ? '—'    : M > 0.15 ? 'SAFE'    : M > 0.05 ? 'ALERT'   : 'CRITICAL';

  type Cell = { label: string; value: React.ReactNode; sub: string; color: string; dot: boolean };

  const [benchmarks, setBenchmarks] = useState<{ n_total: number; governed_score: number }[]>([]);
  
  useEffect(() => {
    fetch('/api/benchmarks').then(r => r.json()).then(d => {
      if (d.benchmarks) setBenchmarks(d.benchmarks);
    }).catch(() => {});
  }, []);

  const totalPrompts = benchmarks.reduce((acc, b) => acc + (b.n_total || 0), 0) || 920;
  const avgAsr = benchmarks.length > 0 
    ? (benchmarks.reduce((acc, b) => acc + (b.governed_score || 0), 0) / benchmarks.length) * 100
    : 0.0;

  const cells: Cell[] = [
    {
      label: 'Governed Turns',
      value: !loaded ? <Skeleton /> : liveState?.total_runs != null
        ? liveState.total_runs.toLocaleString() : '—',
      sub:   'total handled',
      color: G.gold,
      dot:   true,
    },
    {
      label: 'M Score',
      value: !loaded ? <Skeleton /> : M !== null ? `${(M * 100).toFixed(1)}%` : '—',
      sub:   healthLabel,
      color: healthColor,
      dot:   false,
    },
    {
      label: 'Intercept Rate',
      value: !loaded ? <Skeleton /> : interceptRate !== null ? `${interceptRate}%` : '—',
      sub:   'last 20 turns',
      color: '#ef4444',
      dot:   false,
    },
    {
      label: 'Benchmark ASR',
      value: `${avgAsr.toFixed(1)}%`,
      sub:   `${totalPrompts} governed`,
      color: '#10b981',
      dot:   false,
    },
    {
      label: 'Governor',
      value: 'LIVE',
      sub:   'SovereignKernel v2',
      color: '#22c55e',
      dot:   true,
    },
  ];

  return (
    <div
      className="border-y overflow-x-auto bg-black/5 dark:bg-[#0d0d1a] border-black/10 dark:border-white/5"
    >
      <div className="flex" style={{ minWidth: 480 }}>
        {cells.map(({ label, value, sub, color, dot }, i) => (
          <div
            key={label}
            className="flex-1 px-4 sm:px-5 py-3 text-center"
            style={{
              borderRight: i < cells.length - 1 ? '1px solid rgba(0,0,0,0.08)' : 'none',
            }}
          >
            <div className="flex items-center justify-center gap-1.5 mb-0.5">
              {dot && (
                <span
                  className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
                  style={{ background: color }}
                />
              )}
              <span className="text-xs font-mono text-slate-500 dark:text-slate-500 whitespace-nowrap font-bold">
                {label}
              </span>
            </div>
            <div
              className={`text-xl font-black font-mono leading-none tabular-nums transition-opacity ${flash ? 'opacity-50' : 'opacity-100'}`}
              style={{ color }}
            >
              {value}
            </div>
            <div
              className="text-[10px] font-mono mt-0.5 whitespace-nowrap font-bold"
              style={{ color: `${color}` }}
            >
              {sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
