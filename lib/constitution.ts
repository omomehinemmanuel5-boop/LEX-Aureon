// lib/constitution.ts — frozen constitutional constants and simplex invariant.
// The math here NEVER changes. C + R + S = 1. TAU_FLOOR = 0.05. TAU_GOVERNOR = 0.08.

export const CONSTITUTION = Object.freeze({
  TAU_FLOOR:       0.05,
  TAU_RECOVERY:    0.15,
  TAU_GOVERNOR:    0.08,
  N_MIN:           3,
  RECOVERY_RATE:   0.02,
  SIGMA_THRESHOLD: 0.25,
  K0:              0.3,
  EPSILON_K:       0.01,
  SIMPLEX_SUM:     1.0,
} as const);

export function assertSimplex(C: number, R: number, S: number): void {
  const sum = C + R + S;
  if (Math.abs(sum - CONSTITUTION.SIMPLEX_SUM) > 1e-9) {
    throw new Error(`[constitution] C+R+S must equal 1. Got ${sum.toFixed(10)}.`);
  }
}
