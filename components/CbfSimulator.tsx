'use client';

/**
 * CBF Dynamics Simulator — landing-page edition.
 *
 * Mobile-first presentation of the reference-grade simulator. The math stays
 * in lib/cbf_simulation.ts; this component is presentation only.
 */

import { useEffect, useMemo, useState } from 'react';
import { simulateCbf, simulateCbfComparison } from '@/lib/cbf_simulation';

type Point = {
  t: number;
  M: number;
  V: number;
  dV: number;
  C: number;
  R: number;
  S: number;
};

const GOLD = '#c9a84c';
const GOLD_LIGHT = '#e8c96d';
const RED = '#ef4444';
const TAU = 0.05;
const SEED = 42;
const STEPS = 150;

function pathFor(points: Point[], value: (p: Point) => number, width: number, height: number, pad = 8) {
  if (!points.length) return '';
  const values = points.map(value);
  const min = Math.min(...values);
  const max = Math.max(...values, min + 0.0001);
  return points.map((p, i) => {
    const x = pad + (i / Math.max(1, points.length - 1)) * (width - pad * 2);
    const y = height - pad - ((value(p) - min) / Math.max(max - min, 0.0001)) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function MiniChart({ governed, ungoverned, metric }: { governed: Point[]; ungoverned: Point[]; metric: 'M' | 'V' }) {
  const width = 680;
  const height = 210;
  const all = [...governed, ...ungoverned];
  const value = (p: Point) => metric === 'M' ? p.M : p.V;
  const vals = all.map(value);
  const min = Math.min(...vals);
  const max = Math.max(...vals, min + 0.0001);
  const scaleY = (v: number) => height - 18 - ((v - min) / Math.max(max - min, 0.0001)) * (height - 36);
  const floorY = metric === 'M' && TAU >= min && TAU <= max ? scaleY(TAU) : null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black/20 p-2 sm:p-3">
      <div className="mb-2 flex items-center justify-between px-1 text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500">
        <span>{metric === 'M' ? 'Safety margin M' : 'Lyapunov Vz'}</span>
        <span>seed {SEED}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[180px] w-full sm:h-[220px]" role="img" aria-label={`${metric === 'M' ? 'Safety margin' : 'Lyapunov'} comparison`}>
        {[0.25, 0.5, 0.75].map((p) => (
          <line key={p} x1={8} x2={width - 8} y1={18 + p * (height - 36)} y2={18 + p * (height - 36)} stroke="white" strokeOpacity="0.05" />
        ))}
        {floorY !== null && <line x1={8} x2={width - 8} y1={floorY} y2={floorY} stroke={GOLD} strokeOpacity="0.45" strokeDasharray="5 5" />}
        <polyline points={pathFor(ungoverned, value, width, height)} fill="none" stroke={RED} strokeWidth="2" strokeOpacity="0.55" strokeLinejoin="round" />
        <polyline points={pathFor(governed, value, width, height)} fill="none" stroke={GOLD_LIGHT} strokeWidth="3" strokeLinejoin="round" />
        <text x="10" y="14" fill="#64748b" fontSize="9" fontFamily="monospace">{max.toFixed(2)}</text>
        <text x="10" y={height - 4} fill="#64748b" fontSize="9" fontFamily="monospace">{min.toFixed(2)}</text>
      </svg>
      <div className="mt-1 flex flex-wrap items-center gap-3 px-1 text-[9px] font-mono text-slate-500">
        <span className="flex items-center gap-1.5"><i className="h-1.5 w-5 rounded-full" style={{ background: GOLD_LIGHT }} />Governed</span>
        <span className="flex items-center gap-1.5"><i className="h-1.5 w-5 rounded-full bg-red-500/70" />Ungoverned</span>
        {floorY !== null && <span className="text-[#c9a84c]">τ = {TAU.toFixed(2)}</span>}
      </div>
    </div>
  );
}

function Simplex({ governed, ungoverned }: { governed: Point; ungoverned: Point }) {
  const W = 240, H = 205;
  const top: [number, number] = [W / 2, 18];
  const left: [number, number] = [22, H - 20];
  const right: [number, number] = [W - 22, H - 20];
  const xy = (c: number, r: number, s: number): [number, number] => [
    c * top[0] + r * left[0] + s * right[0],
    c * top[1] + r * left[1] + s * right[1],
  ];
  const safeScale = 1 - 3 * TAU;
  const safeTop = xy(TAU + safeScale, TAU, TAU);
  const safeLeft = xy(TAU, TAU + safeScale, TAU);
  const safeRight = xy(TAU, TAU, TAU + safeScale);
  const [gx, gy] = xy(governed.C, governed.R, governed.S);
  const [ux, uy] = xy(ungoverned.C, ungoverned.R, ungoverned.S);

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="mb-1 flex items-center justify-between text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500">
        <span>Constitutional simplex</span><span>C + R + S = 1</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-[190px] w-full max-w-[280px]" role="img" aria-label="Governed and ungoverned state on the C R S simplex">
        <polygon points={`${top.join(',')} ${left.join(',')} ${right.join(',')}`} fill="none" stroke="white" strokeOpacity="0.16" />
        <polygon points={`${safeTop.join(',')} ${safeLeft.join(',')} ${safeRight.join(',')}`} fill={GOLD} fillOpacity="0.05" stroke={GOLD} strokeOpacity="0.45" strokeDasharray="4 4" />
        <circle cx={W / 2} cy={H / 2 + 25} r="3" fill="#60a5fa" fillOpacity="0.7" />
        <circle cx={ux} cy={uy} r="5" fill={RED} fillOpacity="0.8" />
        <circle cx={gx} cy={gy} r="6" fill={GOLD_LIGHT} />
        <text x={top[0]} y="12" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace">C</text>
        <text x="12" y={H - 6} textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace">R</text>
        <text x={W - 12} y={H - 6} textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace">S</text>
      </svg>
      <div className="flex justify-center gap-4 text-[9px] font-mono text-slate-500">
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#e8c96d]" />Governed</span>
        <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />Ungoverned</span>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'good' | 'bad' | 'default' }) {
  const toneClass = tone === 'good' ? 'text-[#e8c96d]' : tone === 'bad' ? 'text-red-400' : 'text-white';
  return (
    <div className="rounded-xl border border-white/10 bg-black/15 p-3">
      <div className="text-[9px] font-mono uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tracking-tight ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function CbfSimulator() {
  const [metric, setMetric] = useState<'M' | 'V'>('M');
  const [playing, setPlaying] = useState(true);
  const [visible, setVisible] = useState(STEPS);

  const comparison = useMemo(() => simulateCbfComparison({ seed: SEED, steps: STEPS }), []);
  const certificate = useMemo(() => simulateCbf({ seed: SEED, steps: 1500, dt: 0.1, cbfEnabled: true }), []);

  const governed = comparison.governed.trajectory as Point[];
  const ungoverned = comparison.ungoverned.trajectory as Point[];
  const gFinal = governed[governed.length - 1];
  const uFinal = ungoverned[ungoverned.length - 1];

  useEffect(() => {
    if (!playing) return;
    let start = 0;
    const duration = 1300;
    let frame = 0;
    const tick = (time: number) => {
      if (!start) start = time;
      const p = Math.min(1, (time - start) / duration);
      setVisible(Math.max(1, Math.floor(governed.length * p)));
      if (p < 1) frame = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, governed.length]);

  const shownG = governed.slice(0, visible);
  const shownU = ungoverned.slice(0, visible);
  const replay = () => { setVisible(1); setPlaying(true); };
  const safe = comparison.safety_guarantee_holds && comparison.governed.invariance_violations === 0;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#070b14] p-3 shadow-2xl sm:p-5">
      <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-[#c9a84c]/10 blur-3xl" />

      <header className="relative mb-3 flex items-start justify-between gap-3 sm:mb-4">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[#c9a84c]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#c9a84c]" /> CBF Dynamics
          </div>
          <h3 className="mt-1 text-base font-semibold text-white sm:text-lg">Safety under the same disturbance</h3>
          <p className="mt-1 max-w-xl text-[10px] leading-relaxed text-slate-400 sm:text-xs">
            A seeded counterfactual: identical dynamics, with and without the barrier.
          </p>
        </div>
        <button onClick={replay} className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-mono text-slate-300 transition hover:bg-white/10" aria-label="Replay simulation">
          {playing ? 'RUNNING' : 'REPLAY'}
        </button>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:mb-4 sm:grid-cols-4">
        <Stat label="Gov. min M" value={comparison.governed.min_M.toFixed(3)} tone="good" />
        <Stat label="Ungov. min M" value={comparison.ungoverned.min_M.toFixed(3)} tone={comparison.ungoverned.min_M < TAU ? 'bad' : 'default'} />
        <Stat label="Violations" value={String(comparison.governed.invariance_violations)} tone="good" />
        <Stat label="Safety floor" value={TAU.toFixed(2)} />
      </div>

      <div className="mb-3 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] p-1">
        <button onClick={() => setMetric('M')} className={`flex-1 rounded-md px-3 py-2 text-[10px] font-mono transition ${metric === 'M' ? 'bg-white/10 text-white' : 'text-slate-500'}`}>Margin M</button>
        <button onClick={() => setMetric('V')} className={`flex-1 rounded-md px-3 py-2 text-[10px] font-mono transition ${metric === 'V' ? 'bg-white/10 text-white' : 'text-slate-500'}`}>Lyapunov Vz</button>
      </div>

      <MiniChart governed={shownG} ungoverned={shownU} metric={metric} />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Simplex governed={gFinal} ungoverned={uFinal} />
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500">Certificate</span>
            <span className={`rounded-full border px-2 py-1 text-[8px] font-mono ${safe ? 'border-[#c9a84c]/30 bg-[#c9a84c]/10 text-[#e8c96d]' : 'border-red-500/20 bg-red-500/10 text-red-400'}`}>
              {safe ? 'FORWARD INVARIANT' : 'NOT PROVEN'}
            </span>
          </div>
          <div className="space-y-3 text-[10px] font-mono">
            <div className="flex justify-between gap-3"><span className="text-slate-500">FPL-1</span><span className="text-right text-slate-200">{certificate.fpl1_classification}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Descent ratio</span><span className="text-[#e8c96d]">{certificate.stability_ratio.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Max ΔV excursion</span><span className="text-slate-200">{certificate.max_deviation.toFixed(3)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Integration</span><span className="text-slate-200">dt = 0.1 · T = 150</span></div>
          </div>
          <p className="mt-4 border-t border-white/10 pt-3 text-[9px] leading-relaxed text-slate-500">
            Seeded finite-horizon numerical certificate. It does not close the analytical global-proof problem.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[9px] font-mono text-slate-500">
        <span>Seed {SEED} · {STEPS} display steps · same forcing for both arms</span>
        <span className="text-[#c9a84c]">Δ min-M: {comparison.improvement_min_M.toFixed(3)}</span>
      </div>
    </section>
  );
}
