'use client';
  import { useState, useEffect, useRef } from 'react';

  const G = { gold: '#c9a84c', goldL: '#e8c96d', navy: '#07070d', navyL: '#0d0d1a' };

  interface LiveState {
    state: { C: number; R: number; S: number; M: number };
    total_runs: number;
  }

  function AnimNum({ value, decimals = 0 }: { value: number | null; decimals?: number }) {
    const [display, setDisplay] = useState(value);
    const prev = useRef(value);
    useEffect(() => {
      if (value === null || prev.current === value) { prev.current = value; return; }
      const start = prev.current ?? value;
      const duration = 600;
      const startTime = performance.now();
      const raf = (t: number) => {
        const p = Math.min((t - startTime) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        setDisplay(start + (value - start) * ease);
        if (p < 1) requestAnimationFrame(raf);
        else { setDisplay(value); prev.current = value; }
      };
      requestAnimationFrame(raf);
    }, [value, start]);
    if (display === null) return <span>—</span>;
    return <span>{display.toFixed(decimals)}</span>;
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
            setLiveState(prev => {
              if (prev?.total_runs !== d.total_runs) setFlash(true);
              return d;
            });
            setTimeout(() => setFlash(false), 400);
          }
          if (auditsRes.ok) {
            const d = await auditsRes.json() as { receipts?: { intervention: boolean }[] };
            const receipts = d.receipts ?? [];
            if (receipts.length > 0) {
              setInterceptRate(Math.round(receipts.filter(r => r.intervention).length / receipts.length * 100));
            }
          }
        } catch { /* silently fail, keep showing last known values */ }
      };
      load();
      const id = setInterval(load, 10000);
      return () => clearInterval(id);
    }, []);

    const M = liveState?.state?.M ?? null;
    const healthColor = M === null ? G.gold : M > 0.15 ? '#22c55e' : M > 0.05 ? '#f59e0b' : '#ef4444';
    const healthLabel = M === null ? '—' : M > 0.15 ? 'SAFE' : M > 0.05 ? 'ALERT' : 'CRITICAL';

    const cells = [
      {
        label: 'Governed Turns',
        value: liveState?.total_runs != null
          ? <span className={flash ? 'opacity-60' : ''}>{liveState.total_runs.toLocaleString()}</span>
          : <span className="animate-pulse text-slate-700">—</span>,
        sub: 'total handled',
        color: G.gold,
        dot: true,
      },
      {
        label: 'M Score',
        value: M !== null
          ? <span>{(M * 100).toFixed(1)}%</span>
          : <span className="animate-pulse text-slate-700">—</span>,
        sub: healthLabel,
        color: healthColor,
        dot: false,
      },
      {
        label: 'Intercept Rate',
        value: interceptRate !== null
          ? <span>{interceptRate}%</span>
          : <span className="animate-pulse text-slate-700">—</span>,
        sub: 'last 20 turns',
        color: '#ef4444',
        dot: false,
      },
      {
        label: 'Benchmark ASR',
        value: <span>0.0%</span>,
        sub: '920 governed',
        color: '#10b981',
        dot: false,
      },
      {
        label: 'Governor',
        value: <span>LIVE</span>,
        sub: 'SovereignKernel v2',
        color: '#22c55e',
        dot: true,
      },
    ];

    return (
      <div
        className="border-y overflow-x-auto scrollbar-hide"
        style={{ background: G.navyL, borderColor: `${G.gold}18` }}
      >
        <div
          className="flex divide-x"
          style={{
            minWidth: 'max-content',
            divideColor: `${G.gold}12`,
            borderColor: `${G.gold}12`,
          }}
        >
          {cells.map(({ label, value, sub, color, dot }) => (
            <div
              key={label}
              className="flex-1 px-5 py-3 text-center"
              style={{ minWidth: 120, borderRight: `1px solid ${G.gold}15` }}
            >
              <div className="flex items-center justify-center gap-1.5 mb-0.5">
                {dot && (
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0"
                    style={{ background: color }}
                  />
                )}
                <span className="text-xs font-mono text-slate-600 whitespace-nowrap">{label}</span>
              </div>
              <div
                className="text-xl font-black font-mono leading-none tabular-nums"
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
  