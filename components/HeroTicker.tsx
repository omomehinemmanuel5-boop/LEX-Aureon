'use client';

import { useState, useEffect } from 'react';

const GOLD = '#c9a84c';

export default function HeroTicker() {
  const [M, setM] = useState<number>(0.226);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const fetchState = async () => {
      try {
        const r = await fetch('/api/live-state');
        if (!r.ok) return;
        const d = await r.json();
        const newM = d.state?.M ?? 0.226;
        setM(newM);
        setFlash(true);
        setTimeout(() => setFlash(false), 400);
      } catch {}
    };
    fetchState();
    const id = setInterval(fetchState, 5000);
    return () => clearInterval(id);
  }, []);

  // TAU_RECOVERY=0.15, TAU_FLOOR=0.05 — must match lib/kv.ts constants
  const health = M > 0.15 ? 'SAFE' : M > 0.05 ? 'WARNING' : 'CRITICAL';
  const healthColor = M > 0.15 ? '#22c55e' : M > 0.05 ? '#f59e0b' : '#ef4444';

  return (
    <div
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border text-xs font-mono transition-all duration-300 ${flash ? 'opacity-70' : 'opacity-100'}`}
      style={{
        borderColor: `${GOLD}30`,
        background: 'rgba(5,8,16,0.8)',
        color: GOLD,
        backdropFilter: 'blur(8px)',
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: healthColor }} />
      <span>Live M Score:</span>
      <span className="font-black" style={{ color: healthColor }}>
        {(M * 100).toFixed(1)}%
      </span>
      <span style={{ color: 'rgba(201,168,76,0.4)' }}>·</span>
      <span>
        STABILITY: <span style={{ color: healthColor }}>{health}</span>
      </span>
      <span style={{ color: 'rgba(201,168,76,0.4)' }}>·</span>
      <span>Governor: <span style={{ color: '#22c55e' }}>ACTIVE</span></span>
    </div>
  );
}
