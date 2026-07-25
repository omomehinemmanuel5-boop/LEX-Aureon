'use client';

import { useState, useEffect } from 'react';

const GOLD = '#c9a84c';

const TAU_RECOVERY = 0.15;
const TAU_FLOOR    = 0.05;

function healthOf(m: number) {
  if (m > TAU_RECOVERY) return { label: 'SAFE',     color: '#16a34a' };
  if (m > TAU_FLOOR)    return { label: 'WARNING',  color: '#d97706' };
  return                       { label: 'CRITICAL', color: '#dc2626' };
}

export default function HeroTicker() {
  const [M, setM] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  // 2026-07-20: consecutive fetch failures. During the 2026-07-14 Turso
  // incident this ticker showed "SYNCING…" indefinitely — an eternal loading
  // state is a lie when the backend is down. After 2 consecutive failures we
  // say "UNAVAILABLE" instead; any success resets.
  const [failures, setFailures] = useState(0);

  useEffect(() => {
    const fetchState = async () => {
      try {
        // fix (2026-07-13) — READ EXHAUSTION: was `cache: 'no-store'` on a
        // 3s interval, on a component mounted on every landing-page visit.
        // /api/live-state carries a real 60s server-side Cache-Control
        // (see that route) — no-store explicitly bypassed it, forcing a
        // fresh Turso read on every single tick regardless. This was one of
        // six components with the same pattern (see also SimplexDemoClient,
        // LiveAuditFeed, GovernanceFeed, LyapunovVisualizer,
        // observability/page.tsx) found while diagnosing Turso's read quota
        // being exhausted. Plain fetch() now, so the browser/CDN honors the
        // route's own Cache-Control instead of forcing it fresh — and the
        // poll interval is raised to match that 60s window, since polling
        // faster than the cache TTL was never buying real freshness (same
        // reasoning already applied to LiveStatsBar on 2026-07-10).
        const r = await fetch('/api/live-state');
        if (!r.ok) { setFailures(f => f + 1); return; }
        const d = await r.json() as { state?: { M?: number | null } };
        const newM = d.state?.M ?? null;
        if (newM === null) { setFailures(f => f + 1); return; }
        setFailures(0);
        setM(newM);
        setFlash(true);
        setTimeout(() => setFlash(false), 400);
      } catch {
        setFailures(f => f + 1); // keep existing value, but stop claiming "syncing" forever
      }
    };

    fetchState();
    const id = setInterval(fetchState, 60_000);
    return () => clearInterval(id);
  }, []);

  const unavailable = M === null && failures >= 2;
  const { label: healthLabel, color: healthColor } =
    M !== null ? healthOf(M)
    : unavailable ? { label: 'OFFLINE', color: '#64748b' }
    : { label: '…', color: GOLD };

  return (
    <div
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-mono transition-opacity duration-300 ${flash ? 'opacity-60' : 'opacity-100'}`}
      style={{
        color: GOLD,
        backdropFilter: 'blur(8px)',
        borderColor: `${GOLD}30`,
        background: 'rgba(201,168,76,0.06)',
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0" style={{ background: healthColor }} />
      <span className="text-slate-600 dark:text-slate-500">Canonical M-Score:</span>
      <span className="font-black" style={{ color: healthColor }}>
        {M !== null ? `${(M * 100).toFixed(1)}%` : unavailable ? 'UNAVAILABLE' : 'SYNCING…'}
      </span>
      <span className="text-slate-300 dark:text-slate-700">·</span>
      <span className="text-slate-600 dark:text-slate-500">
        <span style={{ color: healthColor }}>{healthLabel}</span>
      </span>
      <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">·</span>
      <span className="text-slate-600 dark:text-slate-600 hidden sm:inline">SovereignKernel v2</span>
    </div>
  );
}
