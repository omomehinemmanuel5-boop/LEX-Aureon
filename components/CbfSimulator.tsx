'use client';

/** Mobile-first landing-page presentation of the reference CBF simulator. */
import { useEffect, useMemo, useState } from 'react';
import { simulateCbf, simulateCbfComparison } from '@/lib/cbf_simulation';

type Point = { t: number; M: number; C: number; R: number; S: number };

const GOLD = '#c9a84c';
const GOLD_LIGHT = '#e8c96d';
const RED = '#ef4444';
const TAU = 0.05;
const SEED = 42;
const STEPS = 150;

function line(points: Point[], pick: (p: Point) => number, width: number, height: number, min: number, max: number) {
  if (!points.length) return '';
  return points.map((p, i) => {
    const x = 8 + (i / Math.max(1, points.length - 1)) * (width - 16);
    const y = height - 10 - ((pick(p) - min) / Math.max(max - min, 0.0001)) * (height - 20);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function MarginChart({ governed, ungoverned, visible }: { governed: Point[]; ungoverned: Point[]; visible: number }) {
  const W = 680, H = 190;
  const values = [...governed, ...ungoverned].map(p => p.M);
  const min = Math.min(...values);
  const max = Math.max(...values, min + 0.0001);
  const y = (v: number) => H - 10 - ((v - min) / Math.max(max - min, 0.0001)) * (H - 20);
  const floorY = TAU >= min && TAU <= max ? y(TAU) : null;
  const shownG = governed.slice(0, visible);
  const shownU = ungoverned.slice(0, visible);
  const currentG = shownG[shownG.length - 1];
  const currentU = shownU[shownU.length - 1];
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-2.5 sm:p-3">
      <div className="mb-2 flex items-center justify-between px-1 text-[9px] font-mono uppercase tracking-[0.16em] text-slate-500">
        <span>Safety margin M</span><span>same forcing · seed {SEED}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[165px] w-full sm:h-[205px]" role="img" aria-label="Governed versus ungoverned safety margin under the same disturbance">
        {[0.25, 0.5, 0.75].map(p => <line key={p} x1="8" x2={W - 8} y1={18 + p * (H - 36)} y2={18 + p * (H - 36)} stroke="white" strokeOpacity="0.05" />)}
        {floorY !== null && <line x1="8" x2={W - 8} y1={floorY} y2={floorY} stroke={GOLD} strokeOpacity="0.55" strokeDasharray="5 5" />}
        <polyline points={line(shownU, p => p.M, W, H, min, max)} fill="none" stroke={RED} strokeWidth="2" strokeOpacity="0.55" strokeLinejoin="round" />
        <polyline points={line(shownG, p => p.M, W, H, min, max)} fill="none" stroke={GOLD_LIGHT} strokeWidth="3" strokeLinejoin="round" />
        {currentU && <circle cx={8 + ((shownU.length - 1) / Math.max(1, governed.length - 1)) * (W - 16)} cy={y(currentU.M)} r="3" fill={RED} />}
        {currentG && <circle cx={8 + ((shownG.length - 1) / Math.max(1, governed.length - 1)) * (W - 16)} cy={y(currentG.M)} r="4" fill={GOLD_LIGHT} />}
        <text x="10" y="14" fill="#64748b" fontSize="9" fontFamily="monospace">{max.toFixed(2)}</text>
        <text x="10" y={H - 2} fill="#64748b" fontSize="9" fontFamily="monospace">{min.toFixed(2)}</text>
        {floorY !== null && <text x={W - 10} y={floorY - 5} textAnchor="end" fill="#c9a84c" fontSize="8" fontFamily="monospace">τ</text>}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-[9px] font-mono text-slate-500">
        <span><i className="mr-1.5 inline-block h-1.5 w-5 rounded-full bg-[#e8c96d]" />Governed</span>
        <span><i className="mr-1.5 inline-block h-1.5 w-5 rounded-full bg-red-500/70" />Ungoverned</span>
        <span className="text-[#c9a84c]">τ = {TAU.toFixed(2)}</span>
        {currentG && currentU && <span className="ml-auto text-slate-400">ΔM {((currentG.M - currentU.M)).toFixed(3)}</span>}
      </div>
    </div>
  );
}

function Simplex({ governed, ungoverned, governedPath, ungovernedPath }: { governed: Point; ungoverned: Point; governedPath: Point[]; ungovernedPath: Point[] }) {
  const W = 240, H = 200;
  const top: [number, number] = [W / 2, 16];
  const left: [number, number] = [20, H - 18];
  const right: [number, number] = [W - 20, H - 18];
  const xy = (c: number, r: number, s: number): [number, number] => [c * top[0] + r * left[0] + s * right[0], c * top[1] + r * left[1] + s * right[1]];
  const scale = 1 - 3 * TAU;
  const safeTop = xy(TAU + scale, TAU, TAU);
  const safeLeft = xy(TAU, TAU + scale, TAU);
  const safeRight = xy(TAU, TAU, TAU + scale);
  const pathPoints = (points: Point[]) => points.map(p => xy(p.C, p.R, p.S).join(',')).join(' ');
  const [gx, gy] = xy(governed.C, governed.R, governed.S);
  const [ux, uy] = xy(ungoverned.C, ungoverned.R, ungoverned.S);
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="mb-1 flex justify-between text-[9px] font-mono uppercase tracking-[0.14em] text-slate-500"><span>Constitutional simplex</span><span>C + R + S = 1</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mx-auto h-[175px] w-full max-w-[260px]" role="img" aria-label="Governed and ungoverned trajectories on the constitutional simplex">
        <polygon points={`${top.join(',')} ${left.join(',')} ${right.join(',')}`} fill="none" stroke="white" strokeOpacity="0.16" />
        <polygon points={`${safeTop.join(',')} ${safeLeft.join(',')} ${safeRight.join(',')}`} fill={GOLD} fillOpacity="0.05" stroke={GOLD} strokeOpacity="0.45" strokeDasharray="4 4" />
        <polyline points={pathPoints(ungovernedPath)} fill="none" stroke={RED} strokeOpacity="0.3" strokeWidth="1.5" />
        <polyline points={pathPoints(governedPath)} fill="none" stroke={GOLD_LIGHT} strokeOpacity="0.55" strokeWidth="2" />
        <circle cx={W / 2} cy={H / 2 + 24} r="3" fill="#60a5fa" fillOpacity="0.7" />
        <circle cx={ux} cy={uy} r="5" fill={RED} fillOpacity="0.85" />
        <circle cx={gx} cy={gy} r="6" fill={GOLD_LIGHT} />
        <text x={top[0]} y="10" textAnchor="middle" fill="#94a3b8" fontSize="10" fontFamily="monospace">C</text>
        <text x="10" y={H - 4} fill="#94a3b8" fontSize="10" fontFamily="monospace">R</text>
        <text x={W - 10} y={H - 4} textAnchor="end" fill="#94a3b8" fontSize="10" fontFamily="monospace">S</text>
      </svg>
      <div className="flex justify-center gap-4 text-[9px] font-mono text-slate-500"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#e8c96d]" />Governed</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" />Ungoverned</span></div>
    </div>
  );
}

function Stat({ label, value, good = false, bad = false }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return <div className="rounded-xl border border-white/10 bg-black/15 p-3"><div className="text-[9px] font-mono uppercase tracking-[0.12em] text-slate-500">{label}</div><div className={`mt-1 text-lg font-semibold ${good ? 'text-[#e8c96d]' : bad ? 'text-red-400' : 'text-white'}`}>{value}</div></div>;
}

export default function CbfSimulator() {
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
    let frame = 0;
    const tick = (time: number) => {
      if (!start) start = time;
      const p = Math.min(1, (time - start) / 1500);
      setVisible(Math.max(1, Math.floor(governed.length * p)));
      if (p < 1) frame = requestAnimationFrame(tick); else setPlaying(false);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, governed.length]);

  const replay = () => { setVisible(1); setPlaying(true); };
  const safe = comparison.safety_guarantee_holds && comparison.governed.invariance_violations === 0;
  const shownG = governed.slice(0, visible);
  const shownU = ungoverned.slice(0, visible);
  const currentG = shownG[shownG.length - 1] ?? gFinal;
  const currentU = shownU[shownU.length - 1] ?? uFinal;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#070b14] p-3 shadow-2xl sm:p-5">
      <div className="pointer-events-none absolute -right-24 -top-24 h-56 w-56 rounded-full bg-[#c9a84c]/10 blur-3xl" />
      <header className="relative mb-3 flex items-start justify-between gap-3 sm:mb-4">
        <div><div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.18em] text-[#c9a84c]"><span className="h-1.5 w-1.5 rounded-full bg-[#c9a84c]" />CBF Dynamics</div><h3 className="mt-1 text-base font-semibold text-white sm:text-lg">Same disturbance. Different safety.</h3><p className="mt-1 max-w-xl text-[10px] leading-relaxed text-slate-400 sm:text-xs">A seeded counterfactual: identical dynamics, with and without the barrier.</p></div>
        <button onClick={replay} className="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-mono text-slate-300 transition hover:bg-white/10" aria-label="Replay simulation">{playing ? 'RUNNING' : 'REPLAY'}</button>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:mb-4 sm:grid-cols-4">
        <Stat label="Gov. min M" value={comparison.governed.min_M.toFixed(3)} good />
        <Stat label="Ungov. min M" value={comparison.ungoverned.min_M.toFixed(3)} bad={comparison.ungoverned.min_M < TAU} />
        <Stat label="Violations" value={String(comparison.governed.invariance_violations)} good />
        <Stat label="Safety floor" value={TAU.toFixed(2)} />
      </div>

      <MarginChart governed={governed} ungoverned={ungoverned} visible={visible} />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Simplex governed={currentG} ungoverned={currentU} governedPath={shownG} ungovernedPath={shownU} />
        <div className="rounded-xl border border-white/10 bg-black/20 p-3">
          <div className="mb-3 flex items-center justify-between"><span className="text-[9px] font-mono uppercase tracking-[0.14em] text-slate-500">Numerical certificate</span><span className={`rounded-full border px-2 py-1 text-[8px] font-mono ${safe ? 'border-[#c9a84c]/30 bg-[#c9a84c]/10 text-[#e8c96d]' : 'border-red-500/20 bg-red-500/10 text-red-400'}`}>{safe ? 'FORWARD INVARIANT' : 'NOT PROVEN'}</span></div>
          <div className="space-y-3 text-[10px] font-mono"><div className="flex justify-between gap-3"><span className="text-slate-500">FPL-1</span><span className="text-right text-slate-200">{certificate.fpl1_classification}</span></div><div className="flex justify-between"><span className="text-slate-500">Descent ratio</span><span className="text-[#e8c96d]">{certificate.stability_ratio.toFixed(3)}</span></div><div className="flex justify-between"><span className="text-slate-500">Max ΔV excursion</span><span className="text-slate-200">{certificate.max_deviation.toFixed(3)}</span></div><div className="flex justify-between"><span className="text-slate-500">Integration</span><span className="text-slate-200">dt = {certificate.dt} · T = {certificate.steps}</span></div></div>
          <p className="mt-4 border-t border-white/10 pt-3 text-[9px] leading-relaxed text-slate-500">Seeded finite-horizon numerical certificate. It does not close the analytical global-proof problem.</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-between gap-2 text-[9px] font-mono text-slate-500"><span>Seed {SEED} · {STEPS} display steps · same forcing</span><span className="text-[#c9a84c]">Δ min-M: {comparison.improvement_min_M.toFixed(3)}</span></div>
    </section>
  );
}
