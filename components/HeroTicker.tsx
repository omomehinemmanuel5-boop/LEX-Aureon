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

  useEffect(() => {
    const fetchState = async () => {
      try {
        const r = await fetch('/api/live-state', { cache: 'no-store' });
        if (!r.ok) return;
        const d = await r.json() as { state?: { M?: number | null } };
        const newM = d.state?.M ?? null;
        if (newM === null) return;
        setM(newM);
        setFlash(true);
        setTimeout(() => setFlash(false), 400);
      } catch {
        // silently keep existing value
      }
    };

    fetchState();
    const id = setInterval(fetchState, 3000);
    return () => clearInterval(id);
  }, []);

  const { label: healthLabel, color: healthColor } =
    M !== null ? healthOf(M) : { label: '…', color: GOLD };

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
      <span className="text-slate-500 dark:text-slate-500">Canonical M-Score:</span>
      <span className="font-black" style={{ color: healthColor }}>
        {M !== null ? `${(M * 100).toFixed(1)}%` : 'SYNCING…'}
      </span>
      <span className="text-slate-300 dark:text-slate-700">·</span>
      <span className="text-slate-500 dark:text-slate-500">
        <span style={{ color: healthColor }}>{healthLabel}</span>
      </span>
      <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">·</span>
      <span className="text-slate-400 dark:text-slate-600 hidden sm:inline">SovereignKernel v2</span>
    </div>
  );
}
