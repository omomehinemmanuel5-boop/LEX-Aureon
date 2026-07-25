// lib/constitution.ts — frozen constitutional constants and simplex invariant.
// The math here NEVER changes. C + R + S = 1. TAU_FLOOR = 0.05. TAU_LYAPUNOV = 0.08 (penalty threshold).

export const CONSTITUTION = Object.freeze({
  TAU_FLOOR:       0.05,
  TAU_RECOVERY:    0.15,
  TAU_LYAPUNOV:    0.08,   // Lyapunov barrier penalty threshold (was TAU_GOVERNOR; distinct from kernel TAU_GOV=0.22)
  N_MIN:           3,
  RECOVERY_RATE:   0.02,
  SIGMA_THRESHOLD: 0.25,
  K0:              0.3,
  EPSILON_K:       0.01,
  SIMPLEX_SUM:     1.0,
} as const);

export type ConstitutionalCRS = { c: number; r: number; s: number };

/**
 * CBF-safe Euclidean projection onto { C + R + S = 1, each pillar >= floor }.
 * This is the shared Duchi-style projection used by governor paths that operate
 * on CRS object coordinates. Keep this implementation centralized so live
 * governor logic, PRAXIS, and persistence helpers do not drift.
 */
export function projectCRSToConstitutionalSimplex(
  c: number,
  r: number,
  s: number,
  floor = CONSTITUTION.TAU_FLOOR,
): ConstitutionalCRS {
  let v = [c, r, s].map(x => Math.max(x - floor, 0));
  const target = CONSTITUTION.SIMPLEX_SUM - 3 * floor;
  const u = [...v].sort((a, b) => b - a);
  let cssv = 0;
  let rho = 0;

  for (let j = 0; j < 3; j++) {
    cssv += u[j];
    if (u[j] - (cssv - target) / (j + 1) > 0) rho = j;
  }

  const theta = (u.slice(0, rho + 1).reduce((a, b) => a + b, 0) - target) / (rho + 1);
  v = v.map(x => Math.max(x - theta, 0) + floor);
  const total = v.reduce((a, b) => a + b, 0);

  return { c: v[0] / total, r: v[1] / total, s: v[2] / total };
}

export function assertSimplex(C: number, R: number, S: number): void {
  const sum = C + R + S;
  if (Math.abs(sum - CONSTITUTION.SIMPLEX_SUM) > 1e-9) {
    throw new Error(`[constitution] C+R+S must equal 1. Got ${sum.toFixed(10)}.`);
  }
}
