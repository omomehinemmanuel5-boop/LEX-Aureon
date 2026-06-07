'use client';
  import { useState, useEffect } from 'react';

  const G = { gold: '#c9a84c', navy: '#07070d', navyL: '#0d0d1a' } as const;

  interface LiveState {
    state: { C: number; R: number; S: number; M: number };
    total_runs: number;
  }

  export default function LiveStatsBar() {
    const [liveState, setLiveState] = useState<LiveState | null>(null);
    const [interceptRate, setInterceptRate] = useState<number | null>(null);
    const [flash, setFlash] = useState(false);

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
        }
      };
      load();
      const id = setInterval(load, 10000);
      return () => clearInterval(id);
    }, []);

    const M = liveState?.state?.M ?? null;
    const healthColor = M === null ? G.gold : M > 0.15 ? '#22c55e' : M > 0.05 ? '#f59e0b' : '#ef4444';
    const healthLabel = M === null ? '—' : M > 0.15 ? 'SAFE' : M > 0.05 ? 'ALERT' : 'CRITICAL';

    const cells: { label: string; value: string; sub: string; color: string; dot: boolean }[] = [
      {
        label: 'Governed Turns',
        value: liveState?.total_runs != null ? liveState.total_runs.toLocaleString() : '—',
        sub: 'total handled',
        color: G.gold,
        dot: true,
      },
      {
        label: 'M Score',
        value: M !== null ? `${(M * 100).toFixed(1)}%` : '—',
        sub: healthLabel,
        color: healthColor,
        dot: false,
      },
      {
        label: 'Intercept Rate',
        value: interceptRate !== null ? `${interceptRate}%` : '—',
        sub: 'last 20 turns',
        color: '#ef4444',
        dot: false,
      },
      {
        label: 'Benchmark ASR',
        value: '0.0%',
        sub: '920 governed',
        color: '#10b981',
        dot: false,
      },
      {
        label: 'Governor',
        value: 'LIVE',
        sub: 'SovereignKernel v2',
        color: '#22c55e',
        dot: true,
      },
    ];

    return (
      <div
        className="border-y overflow-x-auto"
        style={{ background: G.navyL, borderColor: `${G.gold}18` }}
      >
        <div className="flex" style={{ minWidth: 480 }}>
          {cells.map(({ label, value, sub, color, dot }, i) => (
            <div
              key={label}
              className="flex-1 px-4 sm:px-5 py-3 text-center"
              style={{
                borderRight: i < cells.length - 1 ? `1px solid ${G.gold}15` : 'none',
              }}
            >
              <div className="flex items-center justify-center gap-1.5 mb-0.5">
                {dot && (
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
                    style={{ background: color }}
                  />
                )}
                <span className="text-xs font-mono text-slate-600 whitespace-nowrap">
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
                className="text-xs font-mono mt-0.5 whitespace-nowrap"
                style={{ color: `${color}80` }}
              >
                {sub}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  