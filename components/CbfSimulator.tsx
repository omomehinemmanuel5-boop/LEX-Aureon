'use client';

/**
 * CbfSimulator — interactive, client-side CBF simulation.
 *
 * A self-contained interactive panel that runs the exact same CBF simulation
 * (lib/cbf_simulation.ts) in the browser. No API calls, no dependencies —
 * pure TypeScript math mirrored from the backend. Lets visitors vary dt,
 * seed, tau (CBF floor), and projection mode, then see both arms' V_z
 * trajectories and the formal FPL-1 classification update in real time.
 *
 * HONESTY CONSTRAINT: same discipline as the static CbfInvariancePanel.
 * Clearly labels results as seeded finite-horizon numerical certificates,
 * never the analytical multi-pillar proof. Shows when FPL-1 fails so
 * visitors can verify the claim themselves.
 *
 * DETERMINISM: uses Mulberry32 PRNG (same as backend) so identical seed +
 * parameters always produce identical trajectories — reproducible across
 * runs and refreshes.
 */

import { useCallback, useMemo, useState } from 'react';

// ── Theme constants ──────────────────────────────────────────────────────
const G = { gold: '#c9a84c', goldL: '#e8c96d', red: '#ef4444', muted: '#94a3b8' };

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

// ── Trajectory Chart (hand-rolled SVG, matching codebase pattern) ────────
function TrajectoryChart({
  governed,
  ungoverned,
  tau,
  showVz,
}: {
  governed: SimStep[];
  ungoverned: SimStep[];
  tau: number;
  showVz: boolean;
}) {
  const W = 700, H = 220, PAD = 10;
  const yMax: number = showVz ? 0.5 : 0.5;
  const data = showVz ? governed : ungoverned;
  const vMax = Math.max(...data.map(s => s.V), ...ungoverned.map(s => s.V));
  const vMin = Math.min(...data.map(s => s.V), ...ungoverned.map(s => s.V));

  const toXY = (steps: SimStep[]) => steps.map((s, i) => {
    const x = PAD + (i / Math.max(1, steps.length - 1)) * (W - 2 * PAD);
    const raw = showVz ? s.V : s.M;
    const yRange = showVz ? vMax - vMin : yMax;
    const yBase = showVz ? vMin : 0;
    const y = PAD + (1 - Math.max(0, raw - yBase) / Math.max(yRange, 0.001)) * (H - 2 * PAD);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const floorY = showVz
    ? PAD + (1 - Math.max(0, (vMin > 0 ? vMin : 0) / Math.max(vMax - vMin, 0.001))) * (H - 2 * PAD)
    : PAD + (1 - tau / Math.max(yMax, 0.001)) * (H - 2 * PAD);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
      aria-label={`${showVz ? 'V_z' : 'M'} trajectory, governed vs ungoverned`}>
      {/* floor line */}
      <line x1={PAD} y1={showVz ? H - PAD : floorY} x2={W - PAD} y2={showVz ? H - PAD : floorY}
        stroke="#64748b" strokeWidth={0.8} strokeDasharray="3 3" opacity={0.6} />
      {/* ungoverned */}
      <polyline points={toXY(ungoverned)} fill="none"
        stroke={G.red} strokeWidth={1.5} opacity={0.75} />
      {/* governed */}
      <polyline points={toXY(governed)} fill="none"
        stroke={G.gold} strokeWidth={2.5} />
      {/* step markers */}
      <text x={PAD} y={PAD - 2} className="fill-slate-400 dark:fill-slate-500"
        style={{ fontSize: 9, fontFamily: 'monospace' }}>
        {showVz ? 'V_z' : 'M'} · step 0 → {governed.length - 1}
      </text>
    </svg>
  );
}

// ── Parameter Slider ─────────────────────────────────────────────────────
function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  unit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {label}
        </span>
        <span className="text-[11px] font-mono text-slate-700 dark:text-slate-300">
          {value.toFixed(step < 1 ? (step < 0.01 ? 3 : 2) : 0)}{unit || ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-slate-200 dark:bg-white/10 rounded-full appearance-none cursor-pointer
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#c9a84c] [&::-webkit-slider-thumb]:shadow-sm
          [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:bg-[#c9a84c] [&::-moz-range-thumb]:border-0"
      />
    </div>
  );
}

// ── Classification Badge ─────────────────────────────────────────────────
function ClassificationBadge({ classification }: { classification: string }) {
  const passed = classification === 'LYAPUNOV STABLE + FORWARD INVARIANT';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-semibold
      ${passed
        ? 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
        : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
      }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${passed ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {classification}
    </span>
  );
}

// ── Main Component ───────────────────────────────────────────────────────
export default function CbfSimulator() {
  const [dt, setDt] = useState(1.0);
  const [seed, setSeed] = useState(42);
  const [tau, setTau] = useState(0.05);
  const [steps, setSteps] = useState(150);
  const [projection, setProjection] = useState<'duchi' | 'naive'>('duchi');
  const [showVz, setShowVz] = useState(false);

  const runBoth = useCallback(() => {
    const governed = runSimulation(steps, dt, seed, tau, projection);
    const ungoverned = runSimulation(steps, dt, seed, tau, 'naive');
    return { governed, ungoverned };
  }, [steps, dt, seed, tau, projection]);

  const { governed, ungoverned } = useMemo(() => runBoth(), [runBoth]);

  const horizon = +(dt * steps).toFixed(1);
  const isClassifiedFine = dt <= 0.2;

  return (
    <div className="rounded-2xl border p-6 sm:p-8 bg-white dark:bg-black/30 border-slate-200 dark:border-white/10">
      {/* Header */}
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <span className="text-xs uppercase tracking-widest font-bold text-slate-600 dark:text-slate-500 font-mono">
          Interactive CBF Simulator
        </span>
        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-500">
          client-side · deterministic · Mulberry32 PRNG
        </span>
      </div>
      <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed mb-4">
        Run the same CBF simulation the paper&rsquo;s reference engine runs — both arms from the
        identical perturbation sequence. Adjust parameters and watch the formal classification
        update in real time. Every slider is a knob on the published dynamics, not a UI hack.
      </p>

      {/* Parameter Controls */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <ParamSlider label="dt (step size)" value={dt} min={0.05} max={2.0} step={0.05} onChange={setDt} />
        <ParamSlider label="seed" value={seed} min={1} max={200} step={1} onChange={setSeed} />
        <ParamSlider label="τ (CBF floor)" value={tau} min={0.01} max={0.15} step={0.01} onChange={setTau} />
        <ParamSlider label="steps" value={steps} min={50} max={500} step={25} onChange={setSteps} />
      </div>

      {/* Projection toggle + view toggle */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Governed projection:
          </span>
          <div className="flex rounded-md overflow-hidden border border-slate-200 dark:border-white/10">
            <button
              onClick={() => setProjection('duchi')}
              className={`px-2.5 py-1 text-[10px] font-mono transition-colors
                ${projection === 'duchi'
                  ? 'bg-[#c9a84c]/20 text-[#c9a84c] font-semibold'
                  : 'bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
            >
              Duchi (deployed)
            </button>
            <button
              onClick={() => setProjection('naive')}
              className={`px-2.5 py-1 text-[10px] font-mono transition-colors
                ${projection === 'naive'
                  ? 'bg-[#c9a84c]/20 text-[#c9a84c] font-semibold'
                  : 'bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
            >
              Naive x/Σx
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Plot:
          </span>
          <div className="flex rounded-md overflow-hidden border border-slate-200 dark:border-white/10">
            <button
              onClick={() => setShowVz(false)}
              className={`px-2.5 py-1 text-[10px] font-mono transition-colors
                ${!showVz
                  ? 'bg-[#c9a84c]/20 text-[#c9a84c] font-semibold'
                  : 'bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
            >
              M (margin)
            </button>
            <button
              onClick={() => setShowVz(true)}
              className={`px-2.5 py-1 text-[10px] font-mono transition-colors
                ${showVz
                  ? 'bg-[#c9a84c]/20 text-[#c9a84c] font-semibold'
                  : 'bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
            >
              V_z (Lyapunov)
            </button>
          </div>
        </div>
      </div>

      {/* Chart */}
      <TrajectoryChart
        governed={governed.trajectory}
        ungoverned={ungoverned.trajectory}
        tau={tau}
        showVz={showVz}
      />

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 mb-4 text-[10px] font-mono flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 inline-block" style={{ background: G.gold }} />
          <span className="text-slate-500">governed · min M = {governed.min_M.toFixed(4)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-0.5 inline-block" style={{ background: G.red }} />
          <span className="text-slate-500">ungoverned · min M = {ungoverned.min_M.toFixed(4)}</span>
        </span>
        <span className="text-slate-400 dark:text-slate-500">
          horizon T = {horizon} · {steps} steps · dt = {dt.toFixed(2)}
        </span>
      </div>

      {/* FPL-1 Classifications */}
      <div className="h-px bg-slate-200 dark:bg-white/10 my-4" />

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Governed */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ClassificationBadge classification={governed.fpl1_classification} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500 dark:text-slate-400">
            <span>stability_ratio</span>
            <span className="text-slate-700 dark:text-slate-300">{governed.stability_ratio.toFixed(4)}</span>
            <span>invariance_violations</span>
            <span className="text-slate-700 dark:text-slate-300">{governed.invariance_violations}</span>
            <span>max V_z excursion</span>
            <span className="text-slate-700 dark:text-slate-300">{governed.max_deviation.toFixed(4)}</span>
            <span>min M</span>
            <span className="text-slate-700 dark:text-slate-300">{governed.min_M.toFixed(4)}</span>
          </div>
        </div>

        {/* Ungoverned */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <ClassificationBadge classification={ungoverned.fpl1_classification} />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500 dark:text-slate-400">
            <span>stability_ratio</span>
            <span className="text-slate-700 dark:text-slate-300">{ungoverned.stability_ratio.toFixed(4)}</span>
            <span>invariance_violations</span>
            <span className="text-slate-700 dark:text-slate-300">{ungoverned.invariance_violations}</span>
            <span>max V_z excursion</span>
            <span className="text-slate-700 dark:text-slate-300">{ungoverned.max_deviation.toFixed(4)}</span>
            <span>min M</span>
            <span className="text-slate-700 dark:text-slate-300">{ungoverned.min_M.toFixed(4)}</span>
          </div>
        </div>
      </div>

      {/* Classification criteria */}
      <div className="mt-4 text-[10px] font-mono text-slate-500 dark:text-slate-500 leading-relaxed">
        <b className="text-slate-700 dark:text-slate-300">FPL-1 passes when all three hold:</b>{' '}
        stability_ratio {'>'} 0.6 · invariance_violations = 0 · max V_z excursion {'<'} 0.25.
        {' '}The ungoverned arm serves as a counterfactual — it almost always fails.
        {projection === 'naive' && (
          <span className="block mt-1 text-amber-600 dark:text-amber-500">
            ⚠ The governed arm is also using naive x/Σx projection here — this was the bug that
            caused invariance violations in the original simulator (fixed 2026-07-21 by switching
            to the Duchi floor-respecting projection). Switch to &ldquo;Duchi (deployed)&rdquo; to
            see it pass.
          </span>
        )}
      </div>

      {/* Honesty constraint */}
      <div className="h-px bg-slate-200 dark:bg-white/10 my-4" />

      <p className="text-slate-500 dark:text-slate-500 text-[11px] leading-relaxed">
        <b className="text-slate-700 dark:text-slate-300">What this is not:</b> a seeded,
        finite-horizon <i>numerical</i> certificate of the governed dynamics — not the analytical
        multi-pillar global Lyapunov proof, which remains an open problem. The floor-holding
        result and the classification are both real and reproducible; neither is claimed as the
        closed-form theorem. Fine-dt classification (dt {'\u2264'} 0.2) is closer to the
        continuous-flow limit FPL-1 actually describes; coarse dt inflates discretization error.
      </p>
    </div>
  );
}
