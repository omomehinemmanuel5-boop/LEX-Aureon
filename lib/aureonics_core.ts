/**
 * ═══════════════════════════════════════════════════════════════════════
 * AUREONICS CORE — The Single Source of Truth
 * 
 * Mathematical constants and simplex dynamics for Lex Aureon.
 * Unifies SovereignKernel (V2) and Article III (Modular Agents).
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

export interface CRSState {
  C: number;
  R: number;
  S: number;
  M: number;
}

// ── Simplex Math ─────────────────────────────────────────────────────────────

/**
 * Project a point back to the C+R+S=1 simplex with a minimum floor (TAU).
 * Uses L2-optimal projection.
 */
export function projectToSimplex(
  x: [number, number, number],
  floor: number = TAU
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

/**
 * Lyapunov Candidate: V = Σ(xᵢ − 1/3)²
 * Quadratic certificate for interior stability.
 */
export function lyapunovQuadratic(s: { C: number; R: number; S: number }): number {
  const c = 1.0 / 3.0;
  return (s.C - c) ** 2 + (s.R - c) ** 2 + (s.S - c) ** 2;
}

/**
 * Lyapunov Barrier: V = -Σ log(xᵢ) + (μ/2) Σ max(0, τ - xᵢ)²
 * Stronger theoretical certificate used in Section 11.
 */
export function lyapunovBarrier(x: [number, number, number]): number {
  const barrier = -x.reduce((s, xi) => s + Math.log(Math.max(xi, FLOOR)), 0);
  const penalty = (MU / 2) * x.reduce((s, xi) => {
    const violation = Math.max(0, TAU - xi);
    return s + violation * violation;
  }, 0);
  return barrier + penalty;
}

// ── Replicator Dynamics ──────────────────────────────────────────────────────

/**
 * Governor Correction G_i = k(φ_i - φ̄)
 * Mass-conserving term that pulls state away from floors.
 */
export function calculateGovernorG(x: [number, number, number], tau: number = TAU_GOV): [number, number, number] {
  const phi = x.map(xi => Math.max(0, tau - xi)) as [number, number, number];
  const phi_bar = (phi[0] + phi[1] + phi[2]) / 3;
  return [
    K * (phi[0] - phi_bar),
    K * (phi[1] - phi_bar),
    K * (phi[2] - phi_bar),
  ];
}

/**
 * Fitness functions a_i(z) modulated by environmental signal z.
 */
function calculateFitness(x: [number, number, number], z: number): [number, number, number] {
  const [C, R, S] = x;
  const a_C = A + 0.2 * z;
  const a_R = A - 0.1 * z;
  const a_S = A - 0.1 * z;

  const f_C = a_C - ALPHA * (R + S);
  const f_R = a_R - ALPHA * (C + S);
  const f_S = a_S - ALPHA * (C + R);
  return [f_C, f_R, f_S];
}

/**
 * Replicator dynamics term F_i = x_i(f_i - f̄)
 */
export function calculateReplicatorF(x: [number, number, number], z: number): [number, number, number] {
  const f = calculateFitness(x, z);
  const f_bar = x[0]*f[0] + x[1]*f[1] + x[2]*f[2];
  return [
    x[0] * (f[0] - f_bar),
    x[1] * (f[1] - f_bar),
    x[2] * (f[2] - f_bar),
  ];
}
