/**
 * lib/cbf_simulation.ts
 *
 * TypeScript port of the Python CBF simulator (api/python/cbf_service.py's
 * simulate_cbf). Kept structurally identical to the Python original — same
 * dynamics, same constants, same descent guard, same FPL1 accounting — so
 * a fixed seed yields the same trajectory in both languages (the small
 * numerical drift is only in Gaussian sampling, since Python's random.gauss
 * and our Box-Muller implementation aren't bit-exact).
 *
 * WHY THIS EXISTS: the concurrent Python governor call previously ran on every
 * real user turn of /api/lex/govern to produce `crs_detail`, `weakest_pillar`,
 * `ccp_lambda`, `iec_variance`, and `fpl1`. Of those, only `fpl1` (finite-path
 * Lyapunov stability classification, from a 50-step forward simulation) was
 * genuinely unique to the Python engine — the rest were bag-of-words TF cosine
 * pretending to be constitutional measurement, and were retired for the same
 * reason we retired the old `toxicity`/`truth_score` metrics.
 *
 * Porting simulate_cbf here lets the TS kernel stop calling Python entirely on
 * the live request path (real latency win + one measurement philosophy instead
 * of two), while retaining the one Python capability that actually mattered:
 * the FPL1 stability classification is a system-property proof, not a
 * per-turn measurement, so it can be computed once (or on a schedule) and
 * served cached, rather than recomputed 50 steps deep every user turn.
 *
 * ARCHITECTURAL NOTE: this is a REFERENCE-GRADE simulator, not a live
 * governance kernel. The live per-turn dynamics live in lib/sovereign_kernel.ts
 * — that's where F(x,z), the async G(x,z) governor, real embedding-based
 * sovereignty measurement, and CBF projection with the paper's τ=0.08 floor
 * actually run. This module is the *proof-of-concept simulator* for showing
 * that under the paper's dynamics, the CBF-filtered trajectory is
 * Lyapunov-stable and forward-invariant. It exists to be plotted, cited, and
 * classified — not to run per turn.
 *
 * fix (2026-07-19) — WRONG LYAPUNOV CANDIDATE, SAME BUG AS THE PYTHON
 * ORIGINAL: lyapunovCandidate() here computed the simple quadratic
 * V(x) = sum((x_i-1/3)^2), not the Aureonics §11 published certificate
 * V_z(x) = -sum(z_i*log(x_i)) + (mu/2)*sum(max(0,tau-x_i)^2) that
 * lib/aureonics_core.ts's lyapunovBarrierZ() actually implements — this file
 * is a port of api/python/cbf_service.py, which had the identical bug, fixed
 * there first (2026-07-18) and now ported here since THIS is the file
 * actually wired into the live landing-page visualization
 * (GET /api/cbf-simulation), not the Python original.
 *
 * Also fixes max_deviation to measure EXCURSION from V(0) rather than raw V
 * — the log-barrier candidate has a nonzero floor even at the ideal centroid
 * (-log(1/3) ≈ 1.10 for uniform z), so a raw-value threshold calibrated for
 * the quadratic's 0-floor is meaningless once the candidate changes.
 *
 * VERIFIED, NOT ASSUMED CLOSED: ran the corrected simulation across 5 seeds
 * (steps=150) before writing this fix. stability_ratio now clears the >0.6
 * bar easily (0.92-0.97, this port's own Mulberry32 RNG realization).
 * BUT excursion-based max_deviation still runs 0.29-0.40 against the
 * existing 0.25 threshold, and invariance_violations is nonzero in 3 of 5
 * seeds. fpl1_classification therefore still reads NOT PROVEN on every
 * tested seed under current noise/gain parameters — the formula was
 * genuinely wrong and is now correct, but that does not by itself close the
 * F(x,z)-vs-V_z gap the README/website describe. Recalibrating thresholds or
 * simulation parameters to actually close it is separate, deliberately
 * unaddressed work — not guessed at here.
 *
 * fix (2026-07-19, second pass) — CI TYPECHECK FAILURE: the first version of
 * lyapunovCandidate() used `([0,1,2] as const).reduce(...)`, which TypeScript
 * narrows to a `0|1|2` literal tuple — the reduce accumulator's inferred type
 * then also narrows to `0|1|2`, and a callback returning a plain `number`
 * (the penalty sum) doesn't satisfy that overload (TS2769). Caught by CI
 * (`npx tsc --noEmit`) on this exact commit, not assumed passing. Replaced
 * with a plain for-loop — no behavior change, same computed value.
 */

// ── Safety parameters (mirror api/python/cbf_service.py) ──────────────────
const TAU_CBF   = 0.05;   // safety floor: no pillar may fall below this
const DT_DEFAULT = 1.0;

// ── Governor parameters ──────────────────────────────────────────────────
const TAU_GOV       = 0.25;
const THETA_0       = 1.0;
const THETA_MIN     = 0.1;
const THETA_MAX     = 5.0;
const ALPHA_THETA   = 0.8;
const BETA_THETA    = 0.05;
const DEADZONE      = 0.01;
const TARGET_MARGIN = 0.33;

// ── Noise ────────────────────────────────────────────────────────────────
const NOISE_SIGMA = 0.08;
const NOISE_CLIP  = 0.15;

// ── Basin Intelligence ───────────────────────────────────────────────────
const LAMBDA_GAIN            = 0.2;
const MAX_FORCE_NORM         = 1.0;
const MARGIN_SAFETY_CUTOFF   = 0.1;

const NORMALIZATION_EPSILON  = 1e-12;
const FLOAT_TOLERANCE        = 1e-9;

// ── Lyapunov certificate parameters (2026-07-19 fix — see header) ─────────
const MU_LYAPUNOV    = 2.0;   // Barrier penalty weight — matches lib/aureonics_core.ts's MU
const LYAPUNOV_FLOOR  = 1e-9;  // Prevents log(0) — matches lib/aureonics_core.ts's FLOOR

// ─────────────────────────────────────────────────────────────────────────
// Deterministic RNG — Mulberry32, so the simulation is reproducible given
// a seed. Python's random.Random uses Mersenne Twister; we don't need bit
// compatibility with it, only per-seed determinism on our side, so a small
// well-known PRNG is preferable to pulling a bigger dep.
// ─────────────────────────────────────────────────────────────────────────

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

// Box-Muller Gaussian, clipped — mirrors _gauss_clip in the Python version.
function gaussClip(rng: () => number, sigma: number, clip: number): number {
  // Two uniforms → one Gaussian sample. We only take one of the pair; the
  // second would be wasted, but it's cheaper than caching across calls in
  // a self-contained port.
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(-clip, Math.min(clip, z0 * sigma));
}

// ─────────────────────────────────────────────────────────────────────────
// Dynamics — replicator + mass-conserving noise
// ─────────────────────────────────────────────────────────────────────────

/**
 * fix (2026-07-19) — see file header. Was the simple quadratic V(x) =
 * sum((x_i-1/3)^2); now the published log-barrier V_z certificate, matching
 * lib/aureonics_core.ts's lyapunovBarrierZ() exactly. z defaults to uniform
 * (1/3,1/3,1/3) — this simulator has no session-specific z, matching the
 * live kernel's own Z_RECOVERY fallback for exactly that case.
 */
function lyapunovCandidate(x: [number, number, number], z: [number, number, number] = [1/3, 1/3, 1/3]): number {
  const barrier = -(z[0] * Math.log(Math.max(x[0], LYAPUNOV_FLOOR))
                   + z[1] * Math.log(Math.max(x[1], LYAPUNOV_FLOOR))
                   + z[2] * Math.log(Math.max(x[2], LYAPUNOV_FLOOR)));
  let penaltySum = 0;
  for (let i = 0; i < 3; i++) {
    const v = Math.max(0, TAU_CBF - x[i]!);
    penaltySum += v * v;
  }
  const penalty = (MU_LYAPUNOV / 2) * penaltySum;
  return barrier + penalty;
}

/**
 * The SUPERSEDED candidate this file used until 2026-07-19. Kept for
 * reference/comparison only — no longer called by simulateCbf().
 */
function lyapunovQuadratic(x: [number, number, number]): number {
  const center = 1 / 3;
  return (x[0] - center) ** 2 + (x[1] - center) ** 2 + (x[2] - center) ** 2;
}
void lyapunovQuadratic; // referenced only for the record; suppress unused warning

function replicator(x: [number, number, number], alpha: number): [number, number, number] {
  const a = 0.5;
  const fitness: [number, number, number] = [
    a - alpha * (x[1] + x[2]),
    a - alpha * (x[0] + x[2]),
    a - alpha * (x[0] + x[1]),
  ];
  const fBar = x[0] * fitness[0] + x[1] * fitness[1] + x[2] * fitness[2];
  return [
    x[0] * (fitness[0] - fBar),
    x[1] * (fitness[1] - fBar),
    x[2] * (fitness[2] - fBar),
  ];
}

function intrinsicDynamics(
  x: [number, number, number],
  rng: () => number,
  alpha: number,
): [number, number, number] {
  const rep = replicator(x, alpha);
  const nRaw: [number, number, number] = [
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

// ─────────────────────────────────────────────────────────────────────────
// Adaptive Governor + Basin Force
// ─────────────────────────────────────────────────────────────────────────

function governorG(x: [number, number, number], tauGov = TAU_GOV): [number, number, number] {
  const phi: [number, number, number] = [
    Math.max(0, tauGov - x[0]),
    Math.max(0, tauGov - x[1]),
    Math.max(0, tauGov - x[2]),
  ];
  const phiBar = (phi[0] + phi[1] + phi[2]) / 3;
  return [phi[0] - phiBar, phi[1] - phiBar, phi[2] - phiBar];
}

function computeCCP(x: [number, number, number], signal: number): number {
  const centroid = 1 / 3;
  const variance = (x[0] - centroid) ** 2 + (x[1] - centroid) ** 2 + (x[2] - centroid) ** 2;
  const ccpBase = Math.max(0, 1 - 1.5 * variance);
  return Math.min(1, Math.max(0, ccpBase + 0.1 * signal));
}

function computeIEC(x: [number, number, number], signal: number): number {
  const iecBase = 3 * Math.min(x[0], x[1], x[2]);
  return Math.min(1, Math.max(0, iecBase + 0.05 * signal));
}

function computePhi(x: [number, number, number], signal: number, iecTarget: number): number {
  const w1 = 1.0;
  const w2 = 0.5;
  const ccp = computeCCP(x, signal);
  const iec = computeIEC(x, signal);
  return -w1 * ccp + w2 * (iec - iecTarget) ** 2;
}

function capForce(v: [number, number, number], maxNorm = MAX_FORCE_NORM): [number, number, number] {
  const norm = Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]);
  if (norm > maxNorm && norm > 0) {
    const scale = maxNorm / norm;
    return [v[0] * scale, v[1] * scale, v[2] * scale];
  }
  return [v[0], v[1], v[2]];
}

function basinForce(x: [number, number, number], signal: number, iecTarget: number): [number, number, number] {
  // Central-difference gradient of Phi, projected to zero-mean (mass-conserving), capped.
  const eps = 1e-4;
  const grad: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const xUp: [number, number, number] = [x[0], x[1], x[2]];
    const xDn: [number, number, number] = [x[0], x[1], x[2]];
    xUp[i] += eps;
    xDn[i] -= eps;
    grad[i] = (computePhi(xUp, signal, iecTarget) - computePhi(xDn, signal, iecTarget)) / (2 * eps);
  }
  const meanGrad = (grad[0] + grad[1] + grad[2]) / 3;
  return capForce([
    -(grad[0] - meanGrad) * LAMBDA_GAIN,
    -(grad[1] - meanGrad) * LAMBDA_GAIN,
    -(grad[2] - meanGrad) * LAMBDA_GAIN,
  ]);
}

// ─────────────────────────────────────────────────────────────────────────
// CBF safety filter — exact QP solution for n=3
// min ||u - u_des||^2  s.t.  u_i >= (τ - x_i)/dt - f_i,  Σ u = 0
// ─────────────────────────────────────────────────────────────────────────

function cbfSafetyFilter(
  x: [number, number, number],
  f: [number, number, number],
  uDes: [number, number, number],
  tauCbf: number,
  dt: number,
): [number, number, number] {
  const uMin: [number, number, number] = [
    (tauCbf - x[0]) / dt - f[0],
    (tauCbf - x[1]) / dt - f[1],
    (tauCbf - x[2]) / dt - f[2],
  ];
  const u: [number, number, number] = [uDes[0], uDes[1], uDes[2]];

  for (let iter = 0; iter < 5; iter++) {
    const active: number[] = [];
    for (let i = 0; i < 3; i++) if (u[i] < uMin[i]) active.push(i);
    if (active.length === 0) break;
    const inactive: number[] = [];
    for (let i = 0; i < 3; i++) if (!active.includes(i)) inactive.push(i);
    for (const i of active) u[i] = uMin[i];
    const currentSum = u[0] + u[1] + u[2];
    if (Math.abs(currentSum) < NORMALIZATION_EPSILON) break;
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

function normalize(x: [number, number, number]): [number, number, number] {
  const clamped: [number, number, number] = [
    Math.max(0, x[0]),
    Math.max(0, x[1]),
    Math.max(0, x[2]),
  ];
  const total = clamped[0] + clamped[1] + clamped[2];
  if (total <= NORMALIZATION_EPSILON) return [1 / 3, 1 / 3, 1 / 3];
  if (Math.abs(total - 1) < 1e-10) return clamped;
  return [clamped[0] / total, clamped[1] / total, clamped[2] / total];
}

/**
 * fix (2026-07-21, FPL-1 resolution B) — FLOOR-RESPECTING SIMPLEX PROJECTION.
 * The governed arm was projecting its state with the naive x ↦ x/Σx above,
 * which can push a pillar that was exactly at τ_CBF in the raw next state
 * back BELOW τ_CBF (every component shrinks by 1/Σ when Σ > 1). That naive
 * projection was the mechanical source of the FPL-1 invariance_violations —
 * and it does NOT match the DEPLOYED governor, which uses the exact Euclidean
 * (Duchi–Shalev-Shwartz–Singer) projection onto {Σx = 1, xᵢ ≥ τ} (see
 * lib/aureonics_core.ts projectToSimplex, lib/praxis.ts, lib/kv.ts, and
 * research/paper-updates.md §2). This ports that same projection so the
 * offline proof simulator's governed arm is faithful to production. Because
 * the projection returns xᵢ ≥ floor by construction, forward invariance of
 * the τ_CBF floor holds structurally — the guarantee the CBF exists to make.
 * Used ONLY for the governed arm; the ungoverned counterfactual keeps the
 * naive normalize above so it still collapses through the floor.
 */
function projectToSimplexFloor(
  x: [number, number, number],
  floor: number,
): [number, number, number] {
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

// ─────────────────────────────────────────────────────────────────────────
// Main simulation — returns the same shape the Python /api/python/simulate
// endpoint returns, so any consumer can be pointed at either engine.
// ─────────────────────────────────────────────────────────────────────────

export interface CbfSimStep {
  t: number;
  C: number; R: number; S: number; M: number;
  theta: number;
  phi: number;
  lyapunov_V: number;
  delta_V: number;
}

export interface CbfSimResult {
  trajectory: CbfSimStep[];
  min_M: number;
  safety_violated: boolean;
  time_below_safe: number;
  recovery_times: number[];
  avg_recovery_time: number;
  phi_initial: number;
  phi_final: number;
  directional_gain: number;
  steps: number;
  dt: number;
  seed: number;
  cbf_enabled: boolean;
  tau_cbf: number;
  stability_ratio: number;
  delta_v_positive_ratio: number;
  max_deviation: number;
  // (2026-07-19) surfaced for audit — the raw peak V and V(0), so a reader
  // can see why max_deviation (now excursion-based) differs from a naive
  // "biggest V we ever saw" reading. Not part of the classification test.
  lyapunov_v0: number;
  lyapunov_max_raw: number;
  invariance_violations: number;
  fpl1_classification: string;
  source: 'typescript-cbf-simulation';
}

export interface SimulateCbfOptions {
  steps?: number;
  dt?: number;
  seed?: number;
  alpha?: number;
  cbfEnabled?: boolean;
  signal?: number;      // external signal into CCP/IEC (default 0)
  iecTarget?: number;   // target IEC (default 1/3)
}

export function simulateCbf(opts: SimulateCbfOptions = {}): CbfSimResult {
  const steps      = opts.steps      ?? 150;
  const dt         = opts.dt         ?? DT_DEFAULT;
  const seed       = opts.seed       ?? 42;
  const alpha      = opts.alpha      ?? 0.5;
  const cbfEnabled = opts.cbfEnabled ?? true;
  const signal     = opts.signal     ?? 0;
  const iecTarget  = opts.iecTarget  ?? 1 / 3;

  const rng = mulberry32(seed);
  let x: [number, number, number] = [1 / 3, 1 / 3, 1 / 3];
  let theta = THETA_0;

  const trajectory: CbfSimStep[] = [];
  let safetyViolated       = false;
  let minMGlobal           = 1;
  let timeBelowSafe        = 0;
  const recoveryTimes: number[] = [];
  let violationStart: number | null = null;
  const lyapunovValues: number[] = [];
  let deltaVNegativeSteps  = 0;
  let deltaVPositiveSteps  = 0;
  const deltaVSeries: number[] = [];
  let invarianceViolations = 0;

  const phiInitial = computePhi(x, signal, iecTarget);

  for (let t = 0; t < steps; t++) {
    // 1. Intrinsic dynamics
    const f = intrinsicDynamics(x, rng, alpha);

    let uSafe: [number, number, number] = [0, 0, 0];

    if (cbfEnabled) {
      // 2. Governor force
      const G = governorG(x);
      const uGov: [number, number, number] = [theta * G[0], theta * G[1], theta * G[2]];

      // 3. Basin force (with descent guard)
      let uBasin: [number, number, number] = [0, 0, 0];
      if (Math.min(x[0], x[1], x[2]) >= MARGIN_SAFETY_CUTOFF) {
        uBasin = basinForce(x, signal, iecTarget);
        const phiPrev = computePhi(x, signal, iecTarget);
        const xCandRaw: [number, number, number] = [
          x[0] + dt * (f[0] + uGov[0] + uBasin[0]),
          x[1] + dt * (f[1] + uGov[1] + uBasin[1]),
          x[2] + dt * (f[2] + uGov[2] + uBasin[2]),
        ];
        const xCand = normalize(xCandRaw);
        const phiCand = computePhi(xCand, signal, iecTarget);
        if (phiCand > phiPrev) {
          uBasin = [0.5 * uBasin[0], 0.5 * uBasin[1], 0.5 * uBasin[2]];
        }
      }

      // 4. CBF filter applied LAST
      const uDes: [number, number, number] = [
        uGov[0] + uBasin[0],
        uGov[1] + uBasin[1],
        uGov[2] + uBasin[2],
      ];
      uSafe = cbfSafetyFilter(x, f, uDes, TAU_CBF, dt);
    }

    // 5. State update + simplex projection
    const totalForce: [number, number, number] = [
      f[0] + uSafe[0],
      f[1] + uSafe[1],
      f[2] + uSafe[2],
    ];
    const xNextRaw: [number, number, number] = [
      x[0] + dt * totalForce[0],
      x[1] + dt * totalForce[1],
      x[2] + dt * totalForce[2],
    ];
    const preProjBelowFloor = xNextRaw[0] < TAU_CBF || xNextRaw[1] < TAU_CBF || xNextRaw[2] < TAU_CBF;
    // FPL-1 resolution B (2026-07-21): the governed arm projects with the
    // floor-respecting Duchi projection the DEPLOYED governor actually uses
    // (see projectToSimplexFloor); the ungoverned counterfactual keeps the
    // naive normalize so it still collapses through the floor. The invariance
    // check below is unchanged — it now passes for the governed arm because
    // the projection holds the floor by construction, not because the test
    // was weakened.
    const xNext = cbfEnabled
      ? projectToSimplexFloor(xNextRaw, TAU_CBF)
      : normalize(xNextRaw);
    if (preProjBelowFloor && (xNext[0] < TAU_CBF || xNext[1] < TAU_CBF || xNext[2] < TAU_CBF)) {
      invarianceViolations += 1;
    }
    x = xNext;

    const Vt = lyapunovCandidate(x);
    lyapunovValues.push(Vt);
    const deltaV = lyapunovValues.length <= 1 ? 0 : (lyapunovValues[lyapunovValues.length - 1]! - lyapunovValues[lyapunovValues.length - 2]!);
    if (lyapunovValues.length > 1) {
      deltaVSeries.push(deltaV);
      if (deltaV < 0) deltaVNegativeSteps++;
      else if (deltaV > 0) deltaVPositiveSteps++;
    }

    const Mnew = Math.min(x[0], x[1], x[2]);

    // 6. Safety accounting
    if (Mnew < TAU_CBF - FLOAT_TOLERANCE) {
      safetyViolated = true;
      timeBelowSafe++;
      if (violationStart === null) violationStart = t;
    } else if (violationStart !== null) {
      recoveryTimes.push(t - violationStart);
      violationStart = null;
    }
    if (Mnew < minMGlobal) minMGlobal = Mnew;

    // 7. Adaptive gain update
    if (cbfEnabled) {
      const e = Math.max(0, TARGET_MARGIN - Mnew);
      if (e > DEADZONE) {
        theta = theta + ALPHA_THETA * e - BETA_THETA * (theta - THETA_0);
        theta = Math.max(THETA_MIN, Math.min(THETA_MAX, theta));
      }
    }

    const phiT = computePhi(x, signal, iecTarget);
    trajectory.push({
      t,
      C: +x[0].toFixed(6),
      R: +x[1].toFixed(6),
      S: +x[2].toFixed(6),
      M: +Mnew.toFixed(6),
      theta: +theta.toFixed(6),
      phi: +phiT.toFixed(6),
      lyapunov_V: +Vt.toFixed(8),
      delta_V: +deltaV.toFixed(8),
    });
  }

  if (violationStart !== null) recoveryTimes.push(steps - violationStart);

  const avgRecovery = recoveryTimes.length ? recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length : 0;
  const phiFinal    = trajectory.length ? trajectory[trajectory.length - 1]!.phi : phiInitial;
  const directionalGain = +(phiInitial - phiFinal).toFixed(6);

  const totalDeltaSteps = Math.max(1, lyapunovValues.length - 1);
  let correctedPositiveSteps = 0;
  for (let i = 0; i < deltaVSeries.length - 1; i++) {
    if (deltaVSeries[i]! > 0 && deltaVSeries[i + 1]! < 0) correctedPositiveSteps++;
  }
  const stabilityRatio     = (deltaVNegativeSteps + correctedPositiveSteps) / totalDeltaSteps;
  const destabilizingRatio = deltaVPositiveSteps / totalDeltaSteps;

  // fix (2026-07-19) — EXCURSION, NOT RAW VALUE: see file header. The
  // log-barrier candidate has a nonzero floor even at the ideal centroid, so
  // comparing its raw value against a threshold calibrated for the
  // quadratic's 0-floor is meaningless. max_deviation (used in the
  // classification test below, preserving the field name for continuity) is
  // now the excursion from V(0).
  const v0 = lyapunovValues[0] ?? 0;
  const maxDeviationRaw = lyapunovValues.length ? Math.max(...lyapunovValues) : 0;
  const maxDeviation    = lyapunovValues.length ? Math.max(...lyapunovValues.map(v => v - v0)) : 0;

  const classification =
    stabilityRatio > 0.6 && invarianceViolations === 0 && maxDeviation < 0.25
      ? 'LYAPUNOV STABLE + FORWARD INVARIANT'
      : 'NOT PROVEN';

  return {
    trajectory,
    min_M: +minMGlobal.toFixed(6),
    safety_violated: safetyViolated,
    time_below_safe: timeBelowSafe,
    recovery_times: recoveryTimes,
    avg_recovery_time: +avgRecovery.toFixed(3),
    phi_initial: +phiInitial.toFixed(6),
    phi_final: +phiFinal.toFixed(6),
    directional_gain: directionalGain,
    steps, dt, seed, cbf_enabled: cbfEnabled,
    tau_cbf: TAU_CBF,
    stability_ratio: +stabilityRatio.toFixed(6),
    delta_v_positive_ratio: +destabilizingRatio.toFixed(6),
    max_deviation: +maxDeviation.toFixed(8),
    lyapunov_v0: +v0.toFixed(8),
    lyapunov_max_raw: +maxDeviationRaw.toFixed(8),
    invariance_violations: invarianceViolations,
    fpl1_classification: classification,
    source: 'typescript-cbf-simulation',
  };
}

/** Governed vs ungoverned comparison — same seed, same alpha, CBF on vs off. */
export function simulateCbfComparison(opts: Omit<SimulateCbfOptions, 'cbfEnabled'> = {}): {
  governed: CbfSimResult;
  ungoverned: CbfSimResult;
  safety_guarantee_holds: boolean;
  improvement_min_M: number;
} {
  const governed   = simulateCbf({ ...opts, cbfEnabled: true });
  const ungoverned = simulateCbf({ ...opts, cbfEnabled: false });
  return {
    governed,
    ungoverned,
    safety_guarantee_holds: !governed.safety_violated,
    improvement_min_M: +(governed.min_M - ungoverned.min_M).toFixed(6),
  };
}
