'use client';

import { useState, useEffect } from 'react';

const GOLD = '#c9a84c';

// Thresholds — must match lib/kernel constants
const TAU_RECOVERY = 0.15;
const TAU_FLOOR    = 0.05;

function healthOf(m: number) {
  if (m > TAU_RECOVERY) return { label: 'SAFE',     color: '#22c55e' };
  if (m > TAU_FLOOR)    return { label: 'WARNING',  color: '#f59e0b' };
  return                       { label: 'CRITICAL', color: '#ef4444' };
}

export default function HeroTicker() {
  // null = not yet loaded from API (never show a fake number)
  const [M, setM] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const fetchState = async () => {
      try {
        const r = await fetch('/api/live-state', { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json() as { state?: { M?: number | null } };
        const newM = d.state?.M ?? null;
        if (newM === null) return;          // DB returned null — keep previous or blank
        setM(newM);
        setFlash(true);
        setTimeout(() => setFlash(false), 400);
      } catch {
        // Network error — silently keep whatever we had
      }
    };

    fetchState();
    const id = setInterval(fetchState, 3000); // More frequent updates for "Live" feel
    return () => clearInterval(id);
  }, []);

  const { label: healthLabel, color: healthColor } =
    M !== null ? healthOf(M) : { label: '…', color: GOLD };

  return (
    <div
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-mono transition-all duration-300 ${flash ? 'opacity-60' : 'opacity-100'} bg-black/80 dark:bg-black/80 border-black/10 dark:border-white/10 shadow-lg`}
      style={{
        color: GOLD,
        backdropFilter: 'blur(8px)',
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: healthColor }} />
      <span>Canonical M-Score:</span>
      <span className="font-black" style={{ color: healthColor }}>
        {M !== null ? `${(M * 100).toFixed(1)}%` : 'SYNCING...'}
      </span>
      <span style={{ color: 'rgba(201,168,76,0.4)' }}>·</span>
      <span>
        STABILITY:{' '}
        <span style={{ color: healthColor }}>{healthLabel}</span>
      </span>
      <span style={{ color: 'rgba(201,168,76,0.4)' }}>·</span>
      <span>Source: <span style={{ color: '#c9a84c' }}>SovereignKernel v2</span></span>
    </div>
  );
}
