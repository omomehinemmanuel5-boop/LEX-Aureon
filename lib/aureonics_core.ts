/**
 * ═══════════════════════════════════════════════════════════════════════
 * AUREONICS CORE — The Single Source of Truth
 *
 * Mathematical constants and simplex dynamics for Lex Aureon.
 * Unifies SovereignKernel (V2) and Article III (Modular Agents).
 *
 * Port of the Python reference implementation (api/python/cbf_service.py).
 * Three components previously only in Python are now available in TypeScript:
 *
 *   computePhi()         — constitutional potential Φ(x)
 *   computeBasinForce()  — gradient descent on Φ, projected onto simplex
 *   applyDescentGuard()  — halves basin force when Φ would increase (§6)
 *
 * These were in the Python simulation but missing from the TypeScript kernel,
 * causing the production governor to run without basin intelligence or the
 * descent guard that prevents Φ from increasing. Now available for use in
 * sovereign_kernel.ts and the GovernorAgent reference implementation.
 * ═══════════════════════════════════════════════════════════════════════
 */

// ── Constitutional Constants ─────────────────────────────────────────────────
export const TAU           = 0.05;   // Hard CBF floor (absolute minimum)
export const SOFT_FLOOR    = 0.08;   // Pre-emptive suspension barrier
export const TAU_GOV       = 0.22;   // Governor correction activates below this
export const TARGET_MARGIN = 0.24;   // Governor seeks interior stability
export const THETA_0       = 1.5;    // Baseline adaptive gain
export const THETA_MIN     = 0.25;
export const THETA_MAX     = 12.0;
export const THETA_ETA     = 3.0;    // Gain increase rate
export const THETA_BETA    = 0.08;   // Decay rate toward theta_0
export const SOFT_GAIN     = 0.5;    // Suspension pull strength
export const MIN_DELTA     = 0.01;   // Minimum dynamics perturbation

// Section 11 Replicator Constants
export const K     = 4.0;    // Governor gain k
export const ALPHA = 0.5;    // Replicator coupling α
export const MU    = 2.0;    // Lyapunov quadratic weight μ
export const DT    = 1.0;    // Discrete time step
export const A     = 0.5;    // Baseline fitness |a_i(z)| ≤ A
export const FLOOR = 1e-9;   // Prevent log(0)

// Log-Barrier Interior Point Constants
export const MU_BARRIER  = 0.02;  // Strength of the magnetic push from boundaries
export const EPS_BARRIER = 1e-4;  // Stability epsilon for log-barrier

// Basin Intelligence Constants (port from Python cbf_service.py)
export const LAMBDA_BASIN       = 0.2;   // Basin force gain
export const MAX_FORCE_NORM     = 1.0;   // Cap total basin force L1 norm
export const MARGIN_SAFETY_CUTOFF = 0.1; // Zero basin force when near collapse
export const IEC_TARGET         = 1 / 3; // Default IEC target (centroid)

/**
 * Z_RECOVERY — fallback coordinate-weight vector z = (z_C, z_R, z_S) used by
 * lyapunovBarrierZ when no session-specific z is available.
 *
 * CLOSED (2026-06-28): Open Problem 3 — the dynamic z-update rule
 * h(x, z, law_events) — is now fully specified and deployed in lib/kv.ts.
 * The proven update rule (Theorem 3a/3b, Banach fixed-point, ρ=0.85):
 *
 *   A(t) = γ · Σ_{law ∈ events_t} sev(law) · dir(law)
 *   z_{t+1} = normalize(clamp(ρ·z_t + (1−ρ)·x_t − A(t), τ/2, 1−τ))
 *
 * Session-adaptive z_c/z_r/z_s are stored in z_traj and loaded per session.
 * Z_RECOVERY is retained here as the correct uniform fallback for new sessions.
 */
export const Z_RECOVERY: [number, number, number] = [1 / 3, 1 / 3, 1 / 3];

export interface CRSState {
  C: number;
  R: number;
  S: number;
  M: number;
}

// ── Simplex Math ─────────────────────────────────────────────────────────────

/**
 * Project a point back to the C+R+S=1 simplex with a minimum floor (TAU).
 * Uses L2-optimal Euclidean projection (Duchi et al.).
 */
export function projectToSimplex(
  x: [number, number, number],
  floor: number = TAU,
): [number, number, number] {
  const y = x.map(v => v - floor);
  const target = 1.0 - 3 * floor;
  const u = [...y].sort((a, b) => b - a);
  let cssv = 0.0, rho = 0;
  for (let j = 0; j < 3; j++) {
    cssv += u[j];
    if (u[j] - (cssv - target) / (j + 1) > 0) rho = j;
  }
  const theta = (u.slice(0, rho + 1).reduce((a, b) => a + b, 0) - target) / (rho + 1);
  const yProj = y.map(v => Math.max(v - theta, 0.0));
  const xProj = yProj.map(v => v + floor);
  const total = xProj.reduce((a, b) => a + b, 0);
  return xProj.map(v => v / total) as [number, number, number];
}

// ── Lyapunov Candidates ───────────────────────────────────────────────────────

/** Quadratic certificate: V = Σ(xᵢ − 1/3)² */
export function lyapunovQuadratic(s: { C: number; R: number; S: number }): number {
  const c = 1.0 / 3.0;
  return (s.C - c) ** 2 + (s.R - c) ** 2 + (s.S - c) ** 2;
}

/** Log-barrier certificate (uniform z): V = -Σ log(xᵢ) + (μ/2) Σ max(0, τ-xᵢ)² */
export function lyapunovBarrier(x: [number, number, number]): number {
  const barrier = -x.reduce((s, xi) => s + Math.log(Math.max(xi, FLOOR)), 0);
  const penalty = (MU / 2) * x.reduce((s, xi) => {
    const v = Math.max(0, TAU - xi); return s + v * v;
  }, 0);
  return barrier + penalty;
}

/**
 * z-Weighted log-barrier (§11 published certificate):
 *   V_z(x) = -Σ z_i·log(x_i) + (μ/2)·Σ max(0, τ - x_i)²
 */
export function lyapunovBarrierZ(
  x: [number, number, number],
  z: [number, number, number] = Z_RECOVERY,
): number {
  const barrier = -x.reduce((s, xi, i) => s + z[i] * Math.log(Math.max(xi, FLOOR)), 0);
  const penalty = (MU / 2) * x.reduce((s, xi) => {
    const v = Math.max(0, TAU - xi); return s + v * v;
  }, 0);
  return barrier + penalty;
}

// ── Constitutional Potential Φ(x) ────────────────────────────────────────────
// Port of cbf_service.py → compute_phi() / compute_ccp() / compute_iec()
//
// Φ(x) = -w1·CCP(x) + w2·(IEC(x) - IEC_target)²
//
// Where:
//   CCP(x) = Constitutional Coherence Profile — proximity to balanced interior
//            = max(0, 1 - 1.5·Σ(xᵢ - 1/3)²) = 1 at centroid, 0 at corners
//   IEC(x) = Internal Energy Coherence — 3·min(x) = 1 at centroid, 0 at corners
//
// Lower Φ = better constitutional coherence. Descent guard prevents Φ rising.

const W1_PHI = 1.0;  // CCP weight
const W2_PHI = 0.5;  // IEC deviation weight

/**
 * Constitutional Coherence Profile from state vector.
 * CCP = 1.0 at centroid, 0.0 at any corner vertex.
 * External signal shifts CCP slightly (basin intelligence).
 */
export function computeCCP_state(
  x: [number, number, number],
  signal: number = 0.0,
): number {
  const centroid = 1 / 3;
  const variance = (x[0] - centroid) ** 2 + (x[1] - centroid) ** 2 + (x[2] - centroid) ** 2;
  const ccp_base = Math.max(0, 1 - 1.5 * variance);
  return Math.min(1, Math.max(0, ccp_base + 0.1 * signal));
}

/**
 * Internal Energy Coherence from state vector.
 * IEC = 3·min(x) = 1 at centroid, 0 at any corner.
 */
export function computeIEC_state(
  x: [number, number, number],
  signal: number = 0.0,
): number {
  return Math.min(1, Math.max(0, 3 * Math.min(...x) + 0.05 * signal));
}

/**
 * Constitutional Potential Φ(x).
 * Lower = better. Φ = 0 at centroid (maximum coherence).
 * System should move so that Φ decreases (constitutional improvement).
 */
export function computePhi(
  x: [number, number, number],
  signal: number = 0.0,
  iecTarget: number = IEC_TARGET,
): number {
  const ccp = computeCCP_state(x, signal);
  const iec = computeIEC_state(x, signal);
  return -W1_PHI * ccp + W2_PHI * (iec - iecTarget) ** 2;
}

// ── Basin Force (port from Python cbf_service.py → compute_basin_force) ──────
//
// Basin force = negative gradient of Φ, projected onto the simplex (zero mean
// → mass-conserving), capped by L1 norm to MAX_FORCE_NORM.
//
// u_basin_i = -(∂Φ/∂x_i - mean(∂Φ/∂x)) · LAMBDA_BASIN
//
// This pulls the state toward the basin attractor (lower Φ region) while
// keeping C+R+S=1 exactly. The descent guard below prevents Φ from rising
// if the basin force overshoots.

function capForceL1(v: [number, number, number], maxNorm: number = MAX_FORCE_NORM): [number, number, number] {
  const norm = Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]);
  if (norm > maxNorm && norm > 0) {
    const scale = maxNorm / norm;
    return [v[0] * scale, v[1] * scale, v[2] * scale];
  }
  return v;
}

export function computeBasinForce(
  x: [number, number, number],
  signal: number = 0.0,
  iecTarget: number = IEC_TARGET,
): [number, number, number] {
  const eps = 1e-4;
  const grad: [number, number, number] = [0, 0, 0];

  for (let i = 0; i < 3; i++) {
    const x_up = [...x] as [number, number, number];
    const x_dn = [...x] as [number, number, number];
    x_up[i] += eps;
    x_dn[i] -= eps;
    grad[i] = (computePhi(x_up, signal, iecTarget) - computePhi(x_dn, signal, iecTarget)) / (2 * eps);
  }

  const meanGrad = (grad[0] + grad[1] + grad[2]) / 3;
  const force: [number, number, number] = [
    -(grad[0] - meanGrad) * LAMBDA_BASIN,
    -(grad[1] - meanGrad) * LAMBDA_BASIN,
    -(grad[2] - meanGrad) * LAMBDA_BASIN,
  ];
  return capForceL1(force);
}

// ── Descent Guard (port from Python cbf_service.py §6) ───────────────────────
//
// Before applying basin force, check whether the candidate next state would
// increase Φ. If so, halve the force. This is a sufficient condition for Φ
// to be a directional Lyapunov-like certificate: the guard prevents spurious
// increases in constitutional potential that would occur if basin force
// overshoots the attractor.
//
// Python implementation:
//   phi_cand = compute_phi(x_cand)
//   if phi_cand > phi_prev: u_basin = [0.5 * u for u in u_basin]

export function applyDescentGuard(
  x: [number, number, number],
  f: [number, number, number],
  u_gov: [number, number, number],
  u_basin: [number, number, number],
  dt: number = DT,
  signal: number = 0.0,
  iecTarget: number = IEC_TARGET,
): [number, number, number] {
  const phi_prev = computePhi(x, signal, iecTarget);

  // Candidate next state without guard
  const x_cand = projectToSimplex([
    x[0] + dt * (f[0] + u_gov[0] + u_basin[0]),
    x[1] + dt * (f[1] + u_gov[1] + u_basin[1]),
    x[2] + dt * (f[2] + u_gov[2] + u_basin[2]),
  ]);

  const phi_cand = computePhi(x_cand, signal, iecTarget);

  // If Φ would increase, halve the basin force (descent guard fires)
  if (phi_cand > phi_prev) {
    return [u_basin[0] * 0.5, u_basin[1] * 0.5, u_basin[2] * 0.5];
  }
  return u_basin;
}

// ── CBF QP Safety Filter (port from Python cbf_service.py) ───────────────────
//
// Discrete-time CBF safety filter (exact QP solution for n=3):
//   min ||u - u_des||²  s.t.  u_i ≥ (τ - xᵢ)/dt - fᵢ,  Σu = 0
//
// Guarantees: x_i(t+1) = x_i + dt·(f_i + u_i) ≥ τ for all i,
// while maintaining mass conservation (Σu = 0).
//
// This is the Python QP implementation ported to TypeScript.
// It is stricter than the Duchi projection in projectToSimplex because
// it constrains the CONTROL INPUT u rather than projecting the state.

export function cbfQPFilter(
  x: [number, number, number],
  f: [number, number, number],
  u_des: [number, number, number],
  tau_cbf: number = TAU,
  dt: number = DT,
): [number, number, number] {
  const u_min: [number, number, number] = [
    (tau_cbf - x[0]) / dt - f[0],
    (tau_cbf - x[1]) / dt - f[1],
    (tau_cbf - x[2]) / dt - f[2],
  ];
  const u: [number, number, number] = [...u_des] as [number, number, number];
  const EPS = 1e-12;

  for (let iter = 0; iter < 5; iter++) {
    const active = [0, 1, 2].filter(i => u[i] < u_min[i]);
    if (active.length === 0) break;

    const inactive = [0, 1, 2].filter(i => !active.includes(i));
    for (const i of active) u[i] = u_min[i];

    const currentSum = u[0] + u[1] + u[2];
    if (Math.abs(currentSum) < EPS) break;

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

// ── Governor Correction G_i = k(φ_i - φ̄) ──────────────────────────────────

export function calculateGovernorG(
  x: [number, number, number],
  tau: number = TAU_GOV,
): [number, number, number] {
  const phi_lin = x.map(xi => Math.max(0, tau - xi));
  const phi_log = x.map(xi => {
    const dist = xi - TAU;
    if (dist <= EPS_BARRIER) return 1.0;
    return Math.min(1.0, MU_BARRIER / dist);
  });
  const phi = phi_lin.map((p, i) => p + phi_log[i]);
  const phi_bar = (phi[0] + phi[1] + phi[2]) / 3;
  return [
    K * (phi[0] - phi_bar),
    K * (phi[1] - phi_bar),
    K * (phi[2] - phi_bar),
  ] as [number, number, number];
}

// ── Fitness + Replicator Dynamics ─────────────────────────────────────────────

function calculateFitness(x: [number, number, number], z: number): [number, number, number] {
  const [C, R, S] = x;
  return [
    A + 0.2 * z - ALPHA * (R + S),
    A - 0.1 * z - ALPHA * (C + S),
    A - 0.1 * z - ALPHA * (C + R),
  ];
}

export function calculateReplicatorF(x: [number, number, number], z: number): [number, number, number] {
  const f = calculateFitness(x, z);
  const f_bar = x[0] * f[0] + x[1] * f[1] + x[2] * f[2];
  return [x[0] * (f[0] - f_bar), x[1] * (f[1] - f_bar), x[2] * (f[2] - f_bar)];
}

// ── Basin identification (port from Python identify_basin) ────────────────────

export function identifyBasin(x: [number, number, number]): 'Analytical' | 'Collaborative' | 'Exploratory' | 'Balanced' {
  const labels = ['Analytical', 'Collaborative', 'Exploratory'] as const;
  const maxVal = Math.max(...x);
  if (maxVal > 0.4) return labels[x.indexOf(maxVal)];
  return 'Balanced';
}

// ── Basin Force on V_z (the paper's actual proven potential) ────────────────
//
// computeBasinForce()/applyDescentGuard() above operate on Φ(x) — a DIFFERENT,
// unproven potential built from CCP/IEC, ported from cbf_service.py's Python
// reference. This section instead descends V_z — the z-weighted log-barrier
// from Theorem 1 (V_z(x) = -Σzᵢ·log(xᵢ) + (μ/2)Σmax(0,τ-xᵢ)²), whose
// non-increase (V̇_z ≤ 0) is the actual proven theorem, not a "Lyapunov-like"
// heuristic. Unlike computeBasinForce's finite-difference gradient, V_z has a
// closed form, so this is both more faithful to the paper and cheaper:
//
//   ∂V_z/∂xᵢ = -zᵢ/xᵢ - μ·φᵢ           (φᵢ = max(0, τ-xᵢ))
//
// fix (2026-08-14): this was originally motivated by a claimed "blind spot"
// in calculateGovernorG() — that its barrier-variance contribution to
// ⟨∇V_z,G⟩ vanishes in a symmetric multi-pillar attack. Numerically checked
// before committing (per the shadow-rollout plan below) and that framing does
// NOT hold under the real constants: Var(φ)=0 requires all three φᵢ exactly
// equal, which given the simplex constraint only happens at x=(1/3,1/3,1/3),
// and since TAU_GOV=0.22 < 1/3, that point has φᵢ=0 for all three — i.e. the
// "blind" condition only occurs when there is no real stress at all. G is not
// actually blind under genuine multi-pillar attack. This function is kept for
// a smaller, honest reason instead: it descends the paper's ACTUAL proven
// potential rather than the unproven Φ heuristic above, which is a real
// correctness/auditability improvement independent of the disproven gap.
//
// STAGE 1 of 3 (shadow-rollout plan, see README Roadmap): pure math, no
// callers yet. Not wired into sovereign_kernel.ts. Numerically verified
// (mass-conserving Σ=0, guard fires on deliberately-bad force, V_z genuinely
// decreases along the force alone). Stage 2: log-only shadow call in the live
// governor (same pattern as lib/capitulation_judge.ts), no behavior change.
// Stage 3: promote only after real benchmark data supports it.

/**
 * Analytic gradient of V_z (lyapunovBarrierZ), per-pillar.
 * ∂V_z/∂xᵢ = -zᵢ/xᵢ - μ·max(0, τ-xᵢ)
 */
export function gradVz(
  x: [number, number, number],
  z: [number, number, number] = Z_RECOVERY,
): [number, number, number] {
  return [0, 1, 2].map(i => {
    const xi = Math.max(x[i], FLOOR);
    const phi = Math.max(0, TAU - xi);
    return -z[i] / xi - MU * phi;
  }) as [number, number, number];
}

/**
 * Basin force descending V_z instead of Φ — mass-conserving (projected to
 * remove the mean, so Σ force = 0, matching computeBasinForce's convention),
 * capped by the same MAX_FORCE_NORM.
 */
export function computeBasinForceVz(
  x: [number, number, number],
  z: [number, number, number] = Z_RECOVERY,
): [number, number, number] {
  const grad = gradVz(x, z);
  const meanGrad = (grad[0] + grad[1] + grad[2]) / 3;
  const force: [number, number, number] = [
    -(grad[0] - meanGrad) * LAMBDA_BASIN,
    -(grad[1] - meanGrad) * LAMBDA_BASIN,
    -(grad[2] - meanGrad) * LAMBDA_BASIN,
  ];
  return capForceL1(force);
}

/**
 * Descent guard on the ACTUAL proven potential: halve the basin force if the
 * candidate next state would increase V_z. Same structure as
 * applyDescentGuard, but checking V̇_z ≤ 0 — the real theorem — not Φ.
 */
export function applyDescentGuardVz(
  x: [number, number, number],
  f: [number, number, number],
  u_gov: [number, number, number],
  u_basin: [number, number, number],
  z: [number, number, number] = Z_RECOVERY,
  dt: number = DT,
): [number, number, number] {
  const vz_prev = lyapunovBarrierZ(x, z);

  const x_cand = projectToSimplex([
    x[0] + dt * (f[0] + u_gov[0] + u_basin[0]),
    x[1] + dt * (f[1] + u_gov[1] + u_basin[1]),
    x[2] + dt * (f[2] + u_gov[2] + u_basin[2]),
  ]);

  const vz_cand = lyapunovBarrierZ(x_cand as [number, number, number], z);

  if (vz_cand > vz_prev) {
    return [u_basin[0] * 0.5, u_basin[1] * 0.5, u_basin[2] * 0.5];
  }
  return u_basin;
}
