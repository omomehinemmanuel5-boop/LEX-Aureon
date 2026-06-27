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

// Log-Barrier Interior Point Constants
export const MU_BARRIER = 0.02; // Strength of the magnetic push from boundaries
export const EPS_BARRIER = 1e-4; // Stability epsilon for log-barrier

/**
 * Z_RECOVERY — static coordinate-weight vector z = (z_C, z_R, z_S) used by the
 * z-weighted Lyapunov certificate V_z (see lyapunovBarrierZ).
 *
 * Held at the safe-interior recovery target (the centroid). With z fixed at an
 * interior equilibrium, V_z(x) = -Σ z_i·log(x_i) is — up to an additive
 * constant — the relative-entropy (KL) Lyapunov function KL(z‖x) of replicator
 * dynamics (Hofbauer & Sigmund): V_z ≥ 0, V_z = 0 iff x = z.
 *
 * OPEN PROBLEM (Aureonics "Three Open Problems", #3): the *dynamic* z-update
 * rule h(x, z, law_events) that lets z track law events / recovery targets is
 * NOT solved. z is held constant here, not derived. Do not represent this as
 * the closed-form update rule.
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
 * Stronger theoretical certificate used in Section 11 (uniform-weight form).
 */
export function lyapunovBarrier(x: [number, number, number]): number {
  const barrier = -x.reduce((s, xi) => s + Math.log(Math.max(xi, FLOOR)), 0);
  const penalty = (MU / 2) * x.reduce((s, xi) => {
    const violation = Math.max(0, TAU - xi);
    return s + violation * violation;
  }, 0);
  return barrier + penalty;
}

/**
 * z-WEIGHTED Lyapunov Barrier (the §11 certificate, as published):
 *
 *     V_z(x) = -Σ z_i·log(x_i) + (μ/2)·Σ max(0, τ - x_i)²
 *
 * - First term: z-weighted log-barrier. With z at an interior equilibrium
 *   (Z_RECOVERY), this is the relative-entropy / KL Lyapunov function of
 *   replicator dynamics up to an additive constant: ≥ 0, zero iff x = z.
 * - Second term: control-barrier-function (CBF) penalty that diverges as any
 *   coordinate approaches the hard floor τ, certifying floor-respecting motion
 *   (which the quadratic candidate cannot, since min(·) is non-smooth).
 *
 * This is the object the audit receipts SHOULD certify — distinct from the
 * centroid-distance quadratic, which is trivially decreased by any pull toward
 * 1/3 and therefore confounds the controller with its own certificate.
 *
 * z defaults to Z_RECOVERY. See the Z_RECOVERY note re: the open z-update rule.
 */
export function lyapunovBarrierZ(
  x: [number, number, number],
  z: [number, number, number] = Z_RECOVERY
): number {
  const barrier = -x.reduce((s, xi, i) => s + z[i] * Math.log(Math.max(xi, FLOOR)), 0);
  const penalty = (MU / 2) * x.reduce((s, xi) => {
    const violation = Math.max(0, TAU - xi);
    return s + violation * violation;
  }, 0);
  return barrier + penalty;
}

// ── Replicator Dynamics ──────────────────────────────────────────────────────

/**
 * Governor Correction G_i = k(φ_i - φ̄)
 * Enhanced with Log-Barrier Interior Point Dynamics.
 * 
 * Instead of a linear pull, it uses a logarithmic barrier:
 * B_i = -μ * log(x_i - τ)
 * This creates an asymptotic push that prevents the state from ever
 * reaching the constitutional floor.
 */
export function calculateGovernorG(x: [number, number, number], tau: number = TAU_GOV): [number, number, number] {
  // 1. Traditional Linear Deficit (Base Correction)
  const phi_lin = x.map(xi => Math.max(0, tau - xi)) as [number, number, number];
  
  // 2. Log-Barrier Interior Push (Magnetic Boundary)
  // Push strength grows as xi approaches tau
  const phi_log = x.map(xi => {
    const dist = xi - TAU; // Distance from absolute floor
    if (dist <= EPS_BARRIER) return 1.0; // Max push at boundary
    return Math.min(1.0, MU_BARRIER / dist);
  });

  // Combined potential
  const phi = phi_lin.map((p, i) => p + phi_log[i]);
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
