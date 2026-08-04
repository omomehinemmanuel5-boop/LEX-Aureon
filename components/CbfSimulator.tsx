'use client';

/**
 * CbfSimulator — interactive, client-side CBF simulation.
 * 
 * Redesigned for beauty and clarity. Uses high-fidelity SVG paths,
 * animated drawing, and a refined "Basin Intelligence" aesthetic.
 */

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';

// ── Theme constants ──────────────────────────────────────────────────────
const G = { 
  gold: '#c9a84c', 
  goldL: '#e8c96d', 
  goldGlow: 'rgba(201, 168, 76, 0.3)',
  red: '#ef4444', 
  redGlow: 'rgba(239, 68, 68, 0.2)',
  muted: '#94a3b8',
  bg: '#0f172a',
  card: 'rgba(30, 41, 59, 0.5)'
};

// ── Deterministic RNG — Mulberry32 (mirrors backend) ─────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussClip(rng: () => number, sigma: number, clip: number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(-clip, Math.min(clip, z0 * sigma));
}

// ── Math (mirrors lib/cbf_simulation.ts) ─────────────────────────────────
const NOISE_SIGMA = 0.08;
const NOISE_CLIP  = 0.15;
const MU_LYAP     = 2.0;
const LYAP_FLOOR  = 1e-9;
const NORMALIZE_EPS = 1e-12;

// Governor params
const TAU_GOV       = 0.25;
const THETA_0       = 1.0;
const THETA_MIN     = 0.1;
const THETA_MAX     = 5.0;
const ALPHA_THETA   = 0.8;
const BETA_THETA    = 0.05;
const DEADZONE      = 0.01;
const TARGET_MARGIN = 0.33;
const LAMBDA_GAIN   = 0.2;
const MAX_FORCE_NORM = 1.0;
const MARGIN_CUTOFF = 0.1;

type Vec3 = [number, number, number];

function lyapunovVz(x: Vec3, tau: number): number {
  const barrier = -(x[0] * Math.log(Math.max(x[0], LYAP_FLOOR))
                   + x[1] * Math.log(Math.max(x[1], LYAP_FLOOR))
                   + x[2] * Math.log(Math.max(x[2], LYAP_FLOOR))) / 3;
  let penaltySum = 0;
  for (let i = 0; i < 3; i++) {
    const v = Math.max(0, tau - x[i]);
    penaltySum += v * v;
  }
  return barrier + (MU_LYAP / 2) * penaltySum;
}

function replicator(x: Vec3, alpha: number): Vec3 {
  const a = 0.5;
  const f: Vec3 = [
    a - alpha * (x[1] + x[2]),
    a - alpha * (x[0] + x[2]),
    a - alpha * (x[0] + x[1]),
  ];
  const fBar = x[0] * f[0] + x[1] * f[1] + x[2] * f[2];
  return [x[0] * (f[0] - fBar), x[1] * (f[1] - fBar), x[2] * (f[2] - fBar)];
}

function intrinsicDynamics(x: Vec3, rng: () => number, alpha: number): Vec3 {
  const rep = replicator(x, alpha);
  const nRaw: Vec3 = [
    gaussClip(rng, NOISE_SIGMA, NOISE_CLIP),
    gaussClip(rng, NOISE_SIGMA, NOISE_CLIP),
    gaussClip(rng, NOISE_SIGMA, NOISE_CLIP),
  ];
  const nMean = (nRaw[0] + nRaw[1] + nRaw[2]) / 3;
  return [
    rep[0] + nRaw[0] - nMean,
    rep[1] + nRaw[1] - nMean,
    rep[2] + nRaw[2] - nMean,
  ];
}

function governorG(x: Vec3, tauGov: number): Vec3 {
  const phi: Vec3 = [
    Math.max(0, tauGov - x[0]),
    Math.max(0, tauGov - x[1]),
    Math.max(0, tauGov - x[2]),
  ];
  const phiBar = (phi[0] + phi[1] + phi[2]) / 3;
  return [phi[0] - phiBar, phi[1] - phiBar, phi[2] - phiBar];
}

function computeCCP(x: Vec3): number {
  const centroid = 1 / 3;
  const variance = (x[0] - centroid) ** 2 + (x[1] - centroid) ** 2 + (x[2] - centroid) ** 2;
  const ccpBase = Math.max(0, 1 - 1.5 * variance);
  return Math.min(1, Math.max(0, ccpBase));
}

function computeIEC(x: Vec3): number {
  return Math.min(1, Math.max(0, 3 * Math.min(x[0], x[1], x[2])));
}

function computePhi(x: Vec3, iecTarget: number): number {
  const w1 = 1.0;
  const w2 = 0.5;
  const ccp = computeCCP(x);
  const iec = computeIEC(x);
  return -w1 * ccp + w2 * (iec - iecTarget) ** 2;
}

function capForce(v: Vec3, maxNorm: number): Vec3 {
  const norm = Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]);
  if (norm > maxNorm && norm > 0) {
    const scale = maxNorm / norm;
    return [v[0] * scale, v[1] * scale, v[2] * scale];
  }
  return [v[0], v[1], v[2]];
}

function basinForce(x: Vec3, iecTarget: number): Vec3 {
  const eps = 1e-4;
  const grad: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const xUp: Vec3 = [x[0], x[1], x[2]];
    const xDn: Vec3 = [x[0], x[1], x[2]];
    xUp[i] += eps;
    xDn[i] -= eps;
    grad[i] = (computePhi(xUp, iecTarget) - computePhi(xDn, iecTarget)) / (2 * eps);
  }
  const meanGrad = (grad[0] + grad[1] + grad[2]) / 3;
  return capForce([
    -(grad[0] - meanGrad) * LAMBDA_GAIN,
    -(grad[1] - meanGrad) * LAMBDA_GAIN,
    -(grad[2] - meanGrad) * LAMBDA_GAIN,
  ], MAX_FORCE_NORM);
}

function cbfSafetyFilter(x: Vec3, f: Vec3, uDes: Vec3, tau: number, dt: number): Vec3 {
  const uMin: Vec3 = [
    (tau - x[0]) / dt - f[0],
    (tau - x[1]) / dt - f[1],
    (tau - x[2]) / dt - f[2],
  ];
  const u: Vec3 = [uDes[0], uDes[1], uDes[2]];
  for (let iter = 0; iter < 5; iter++) {
    const active: number[] = [];
    for (let i = 0; i < 3; i++) if (u[i] < uMin[i]) active.push(i);
    if (active.length === 0) break;
    const inactive: number[] = [];
    for (let i = 0; i < 3; i++) if (!active.includes(i)) inactive.push(i);
    for (const i of active) u[i] = uMin[i];
    const currentSum = u[0] + u[1] + u[2];
    if (Math.abs(currentSum) < NORMALIZE_EPS) break;
    if (inactive.length > 0) {
      const excessPer = currentSum / inactive.length;
      for (const j of inactive) u[j] -= excessPer;
    } else {
      const meanU = currentSum / 3;
      u[0] -= meanU; u[1] -= meanU; u[2] -= meanU;
    }
  }
  return u;
}

function normalizeSimplex(x: Vec3): Vec3 {
  const clamped: Vec3 = [Math.max(0, x[0]), Math.max(0, x[1]), Math.max(0, x[2])];
  const total = clamped[0] + clamped[1] + clamped[2];
  if (total <= NORMALIZE_EPS) return [1 / 3, 1 / 3, 1 / 3];
  if (Math.abs(total - 1) < 1e-10) return clamped;
  return [clamped[0] / total, clamped[1] / total, clamped[2] / total];
}

function projectToSimplexFloor(x: Vec3, floor: number): Vec3 {
  const y = [x[0] - floor, x[1] - floor, x[2] - floor];
  const target = 1.0 - 3 * floor;
  const u = [...y].sort((a, b) => b - a);
  let cssv = 0, rho = 0;
  for (let j = 0; j < 3; j++) {
    cssv += u[j];
    if (u[j] - (cssv - target) / (j + 1) > 0) rho = j;
  }
  const theta = (u.slice(0, rho + 1).reduce((a, b) => a + b, 0) - target) / (rho + 1);
  const xProj = y.map(v => Math.max(v - theta, 0) + floor);
  const total = xProj[0] + xProj[1] + xProj[2];
  return [xProj[0] / total, xProj[1] / total, xProj[2] / total];
}

// ── Simulation types ─────────────────────────────────────────────────────
interface SimStep {
  t: number;
  M: number;
  V: number;
  dV: number;
  C: number;
  R: number;
  S: number;
}

interface SimResult {
  trajectory: SimStep[];
  min_M: number;
  safety_violated: boolean;
  invariance_violations: number;
  stability_ratio: number;
  max_deviation: number;
  fpl1_classification: string;
  lyapunov_v0: number;
  steps: number;
  dt: number;
  seed: number;
  tau_cbf: number;
}

// ── Core simulation (mirrors lib/cbf_simulation.ts simulateCbf) ──────────
function runSimulation(
  steps: number,
  dt: number,
  seed: number,
  tauCbf: number,
  projection: 'duchi' | 'naive',
): SimResult {
  const rng = mulberry32(seed);
  let x: Vec3 = [1 / 3, 1 / 3, 1 / 3];
  let theta = THETA_0;

  const trajectory: SimStep[] = [];
  let minMGlobal = 1;
  let invarianceViolations = 0;
  let deltaVNegative = 0;
  let deltaVPositive = 0;
  let correctedPositive = 0;
  const lyapunovValues: number[] = [];
  const deltaVSeries: number[] = [];

  for (let t = 0; t < steps; t++) {
    const f = intrinsicDynamics(x, rng, 0.5);

    // Governor force
    const G = governorG(x, TAU_GOV);
    const uGov: Vec3 = [theta * G[0], theta * G[1], theta * G[2]];

    // Basin force (with descent guard)
    let uBasin: Vec3 = [0, 0, 0];
    if (Math.min(x[0], x[1], x[2]) >= MARGIN_CUTOFF) {
      uBasin = basinForce(x, 1 / 3);
      const phiPrev = computePhi(x, 1 / 3);
      const xCandRaw: Vec3 = [
        x[0] + dt * (f[0] + uGov[0] + uBasin[0]),
        x[1] + dt * (f[1] + uGov[1] + uBasin[1]),
        x[2] + dt * (f[2] + uGov[2] + uBasin[2]),
      ];
      const xCand = normalizeSimplex(xCandRaw);
      const phiCand = computePhi(xCand, 1 / 3);
      if (phiCand > phiPrev) {
        uBasin = [0.5 * uBasin[0], 0.5 * uBasin[1], 0.5 * uBasin[2]];
      }
    }

    // CBF filter applied LAST
    const uDes: Vec3 = [uGov[0] + uBasin[0], uGov[1] + uBasin[1], uGov[2] + uBasin[2]];
    const uSafe = cbfSafetyFilter(x, f, uDes, tauCbf, dt);

    // State update
    const totalForce: Vec3 = [f[0] + uSafe[0], f[1] + uSafe[1], f[2] + uSafe[2]];
    const xNextRaw: Vec3 = [
      x[0] + dt * totalForce[0],
      x[1] + dt * totalForce[1],
      x[2] + dt * totalForce[2],
    ];
    const preProjBelow = xNextRaw[0] < tauCbf || xNextRaw[1] < tauCbf || xNextRaw[2] < tauCbf;
    const xNext = projection === 'duchi'
      ? projectToSimplexFloor(xNextRaw, tauCbf)
      : normalizeSimplex(xNextRaw);

    if (preProjBelow && (xNext[0] < tauCbf || xNext[1] < tauCbf || xNext[2] < tauCbf)) {
      invarianceViolations += 1;
    }
    x = xNext;

    const Vt = lyapunovVz(x, tauCbf);
    lyapunovValues.push(Vt);
    const deltaV = lyapunovValues.length <= 1 ? 0 : (lyapunovValues[lyapunovValues.length - 1] - lyapunovValues[lyapunovValues.length - 2]);
    if (lyapunovValues.length > 1) {
      deltaVSeries.push(deltaV);
      if (deltaV < 0) deltaVNegative++;
      else if (deltaV > 0) deltaVPositive++;
    }

    const Mnew = Math.min(x[0], x[1], x[2]);
    if (Mnew < minMGlobal) minMGlobal = Mnew;

    // Adaptive gain
    const e = Math.max(0, TARGET_MARGIN - Mnew);
    if (e > DEADZONE) {
      theta = theta + ALPHA_THETA * e - BETA_THETA * (theta - THETA_0);
      theta = Math.max(THETA_MIN, Math.min(THETA_MAX, theta));
    }

    trajectory.push({
      t,
      M: +Mnew.toFixed(6),
      V: +Vt.toFixed(8),
      dV: +deltaV.toFixed(8),
      C: +x[0].toFixed(6),
      R: +x[1].toFixed(6),
      S: +x[2].toFixed(6),
    });
  }

  // Classification
  const totalDeltaSteps = Math.max(1, lyapunovValues.length - 1);
  for (let i = 0; i < deltaVSeries.length - 1; i++) {
    if (deltaVSeries[i] > 0 && deltaVSeries[i + 1] < 0) correctedPositive++;
  }
  const stabilityRatio = (deltaVNegative + correctedPositive) / totalDeltaSteps;
  const v0 = lyapunovValues[0] ?? 0;
  const maxDeviation = lyapunovValues.length
    ? Math.max(...lyapunovValues.map(v => v - v0))
    : 0;
  const fpl1 = stabilityRatio > 0.6 && invarianceViolations === 0 && maxDeviation < 0.25
    ? 'LYAPUNOV STABLE + FORWARD INVARIANT'
    : 'NOT PROVEN';

  return {
    trajectory,
    min_M: +minMGlobal.toFixed(6),
    safety_violated: minMGlobal < tauCbf - 1e-9,
    invariance_violations: invarianceViolations,
    stability_ratio: +stabilityRatio.toFixed(6),
    max_deviation: +maxDeviation.toFixed(8),
    fpl1_classification: fpl1,
    lyapunov_v0: +v0.toFixed(8),
    steps,
    dt,
    seed,
    tau_cbf: tauCbf,
  };
}

// ── Trajectory Chart (Enhanced SVG) ──────────────────────────────────────
function TrajectoryChart({
  governed,
  ungoverned,
  tau,
  showVz,
  progress,
}: {
  governed: SimStep[];
  ungoverned: SimStep[];
  tau: number;
  showVz: boolean;
  progress: number;
}) {
  const W = 800, H = 260, PAD = 20;
  
  const gVisible = governed.slice(0, Math.floor(governed.length * progress));
  const uVisible = ungoverned.slice(0, Math.floor(ungoverned.length * progress));

  const vMax = Math.max(...governed.map(s => s.V), ...ungoverned.map(s => s.V));
  const vMin = Math.min(...governed.map(s => s.V), ...ungoverned.map(s => s.V));
  const yMax = 0.5;

  const toXY = (steps: SimStep[]) => {
    if (steps.length === 0) return "";
    return steps.map((s, i) => {
      const x = PAD + (i / Math.max(1, governed.length - 1)) * (W - 2 * PAD);
      const raw = showVz ? s.V : s.M;
      const yRange = showVz ? vMax - vMin : yMax;
      const yBase = showVz ? vMin : 0;
      const y = PAD + (1 - Math.max(0, raw - yBase) / Math.max(yRange, 0.001)) * (H - 2 * PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  };

  const floorY = showVz
    ? PAD + (1 - Math.max(0, (vMin > 0 ? vMin : 0) / Math.max(vMax - vMin, 0.001))) * (H - 2 * PAD)
    : PAD + (1 - tau / Math.max(yMax, 0.001)) * (H - 2 * PAD);

  return (
    <div className="relative group">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto drop-shadow-2xl overflow-visible" role="img">
        <defs>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={G.gold} stopOpacity="0.2" />
            <stop offset="50%" stopColor={G.gold} stopOpacity="1" />
            <stop offset="100%" stopColor={G.goldL} stopOpacity="1" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
            <feMerge>
              <feMergeNode in="coloredBlur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <line key={i} x1={PAD + p * (W - 2 * PAD)} y1={PAD} x2={PAD + p * (W - 2 * PAD)} y2={H - PAD} 
            stroke="white" strokeOpacity="0.05" strokeWidth="1" />
        ))}
        
        {/* Floor line */}
        {!showVz && (
          <g>
            <line x1={PAD} y1={floorY} x2={W - PAD} y2={floorY}
              stroke={G.gold} strokeWidth={1} strokeDasharray="4 4" opacity={0.3} />
            <text x={W - PAD + 5} y={floorY + 3} className="fill-slate-500 font-mono text-[9px]">
              τ = {tau.toFixed(2)}
            </text>
          </g>
        )}

        {/* Ungoverned path */}
        <polyline points={toXY(uVisible)} fill="none"
          stroke={G.red} strokeWidth={1.5} opacity={0.4} strokeLinejoin="round" />
        
        {/* Governed path */}
        <polyline points={toXY(gVisible)} fill="none"
          stroke="url(#goldGrad)" strokeWidth={2.5} filter="url(#glow)" strokeLinejoin="round" />

        {/* Current point markers */}
        {gVisible.length > 0 && (
          <circle 
            cx={PAD + ((gVisible.length - 1) / Math.max(1, governed.length - 1)) * (W - 2 * PAD)}
            cy={toXY([gVisible[gVisible.length - 1]]).split(',')[1]}
            r="4" fill={G.goldL} filter="url(#glow)"
          />
        )}
      </svg>
    </div>
  );
}

// ── Parameter Slider ─────────────────────────────────────────────────────
function ParamSlider({ label, value, min, max, step, onChange }: any) {
  return (
    <div className="flex flex-col gap-2 group">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 group-hover:text-slate-300 transition-colors">
          {label}
        </span>
        <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/50 px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/5">
          {value}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[#c9a84c] hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors"
      />
    </div>
  );
}

function ClassificationBadge({ classification }: { classification: string }) {
  const isPass = classification.includes('STABLE');
  return (
    <div className={`px-2 py-0.5 rounded text-[9px] font-mono border transition-all duration-500 ${
      isPass 
        ? 'bg-[#c9a84c]/10 text-[#c9a84c] border-[#c9a84c]/30 shadow-[0_0_10px_rgba(201,168,76,0.1)]' 
        : 'bg-red-500/10 text-red-400 border-red-500/20'
    }`}>
      {classification}
    </div>
  );
}

export default function CbfSimulator() {
  const [dt, setDt] = useState(0.1);
  const [seed, setSeed] = useState(42);
  const [tau, setTau] = useState(0.05);
  const [steps, setSteps] = useState(200);
  const [projection, setProjection] = useState<'duchi' | 'naive'>('duchi');
  const [showVz, setShowVz] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);

  const governed = useMemo(() => runSimulation(steps, dt, seed, tau, projection), [steps, dt, seed, tau, projection]);
  const ungoverned = useMemo(() => runSimulation(steps, dt, seed, tau, 'naive'), [steps, dt, seed, tau]);

  useEffect(() => {
    if (isPlaying) {
      setProgress(0);
      let start: number;
      const duration = 1500; // 1.5s animation
      const animate = (time: number) => {
        if (!start) start = time;
        const elapsed = time - start;
        const p = Math.min(elapsed / duration, 1);
        setProgress(p);
        if (p < 1) requestAnimationFrame(animate);
        else setIsPlaying(false);
      };
      const frame = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(frame);
    }
  }, [governed, isPlaying]);

  const horizon = +(steps * dt).toFixed(1);

  return (
    <div className="rounded-2xl border p-6 sm:p-8 bg-white/50 dark:bg-slate-900/40 backdrop-blur-sm border-slate-200 dark:border-white/10 shadow-xl relative overflow-hidden group/card">
      {/* Decorative background glow */}
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-[#c9a84c]/5 blur-[100px] pointer-events-none" />
      
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
        <div className="flex flex-col">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-[0.2em] flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#c9a84c] animate-pulse" />
            CBF Dynamics Simulator
          </h3>
          <span className="text-[10px] font-mono text-slate-500 mt-1">
            Mulberry32 Deterministic PRNG · {horizon}s Horizon
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setIsPlaying(true)}
            className="p-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all active:scale-95"
            title="Re-run Simulation"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={isPlaying ? 'animate-spin' : ''}>
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mb-8">
        <ParamSlider label="dt (Step Size)" value={dt} min={0.05} max={1.0} step={0.05} onChange={setDt} />
        <ParamSlider label="Entropy Seed" value={seed} min={1} max={999} step={1} onChange={setSeed} />
        <ParamSlider label="τ (Safety Floor)" value={tau} min={0.01} max={0.15} step={0.01} onChange={setTau} />
        <ParamSlider label="Integration Steps" value={steps} min={50} max={500} step={25} onChange={setSteps} />
      </div>

      <div className="flex items-center gap-6 mb-6 text-[10px] font-mono border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <span className="text-slate-500 uppercase tracking-widest">Mode:</span>
          <div className="flex bg-slate-100 dark:bg-black/20 rounded-lg p-1 border border-slate-200 dark:border-white/5">
            <button onClick={() => setProjection('duchi')} className={`px-3 py-1 rounded-md transition-all ${projection === 'duchi' ? 'bg-white dark:bg-[#c9a84c]/20 text-[#c9a84c] shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Duchi</button>
            <button onClick={() => setProjection('naive')} className={`px-3 py-1 rounded-md transition-all ${projection === 'naive' ? 'bg-white dark:bg-red-500/20 text-red-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Naive</button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-slate-500 uppercase tracking-widest">Metric:</span>
          <div className="flex bg-slate-100 dark:bg-black/20 rounded-lg p-1 border border-slate-200 dark:border-white/5">
            <button onClick={() => setShowVz(false)} className={`px-3 py-1 rounded-md transition-all ${!showVz ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Margin (M)</button>
            <button onClick={() => setShowVz(true)} className={`px-3 py-1 rounded-md transition-all ${showVz ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}>Lyapunov (Vz)</button>
          </div>
        </div>
      </div>

      <TrajectoryChart governed={governed.trajectory} ungoverned={ungoverned.trajectory} tau={tau} showVz={showVz} progress={progress} />

      <div className="grid sm:grid-cols-2 gap-8 mt-8 border-t border-white/5 pt-6">
        {/* Stats Column 1 */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Governed Arm</span>
            <ClassificationBadge classification={governed.fpl1_classification} />
          </div>
          <div className="grid grid-cols-2 gap-y-2 text-[11px] font-mono">
            <span className="text-slate-500">Stability Ratio</span>
            <span className="text-slate-900 dark:text-white text-right">{governed.stability_ratio.toFixed(4)}</span>
            <span className="text-slate-500">Invariance Violations</span>
            <span className={`text-right ${governed.invariance_violations > 0 ? 'text-red-400' : 'text-green-400'}`}>{governed.invariance_violations}</span>
            <span className="text-slate-500">Min Margin M</span>
            <span className="text-slate-900 dark:text-white text-right">{governed.min_M.toFixed(4)}</span>
          </div>
        </div>

        {/* Stats Column 2 */}
        <div className="space-y-4 opacity-60 hover:opacity-100 transition-opacity">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Ungoverned Arm</span>
            <ClassificationBadge classification={ungoverned.fpl1_classification} />
          </div>
          <div className="grid grid-cols-2 gap-y-2 text-[11px] font-mono">
            <span className="text-slate-500">Stability Ratio</span>
            <span className="text-slate-900 dark:text-white text-right">{ungoverned.stability_ratio.toFixed(4)}</span>
            <span className="text-slate-500">Invariance Violations</span>
            <span className="text-red-400 text-right">{ungoverned.invariance_violations}</span>
            <span className="text-slate-500">Min Margin M</span>
            <span className="text-slate-900 dark:text-white text-right">{ungoverned.min_M.toFixed(4)}</span>
          </div>
        </div>
      </div>

      {projection === 'naive' && (
        <div className="mt-6 p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-[10px] font-mono text-red-400 leading-relaxed animate-in fade-in slide-in-from-top-2">
          <span className="font-bold mr-2">⚠ ARCHITECTURAL REGRESSION:</span>
          Naive x/Σx projection fails to respect the safety floor. This mirrors the 2026-07-21 bug. 
          Switch to <span className="text-white font-bold">Duchi</span> to restore forward invariance.
        </div>
      )}

      <div className="mt-6 text-[10px] font-mono text-slate-500 leading-relaxed italic">
        * Seeded finite-horizon numerical certificate. Global analytical Lyapunov proof (Open Problem 1) remains open.
      </div>
    </div>
  );
}
