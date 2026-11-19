import { CONSTITUTION } from '../constitution';
/**
 * Finite-time decay policy for the canonical constitutional stress accumulator.
 *
 * Residual sigma decays only on an observation with no current Lyapunov stress.
 * A positive current stress contribution is never rounded away, even when its
 * magnitude is below the residual-zero tolerance. The tolerance applies only to
 * the residual left by prior stress after a healthy observation.
 */
export const SIGMA_ZERO_TOLERANCE = 1e-6;

export function nextSigmaViolation(
  previousSigma: number,
  currentViolation: number,
  window = 10,
): number {
  const next = previousSigma * ((window - 1) / window) + currentViolation / window;

  if (
    currentViolation === 0
    && Number.isFinite(next)
    && next >= 0
    && next <= SIGMA_ZERO_TOLERANCE
  ) {
    return 0;
  }

  return next;
}


/**
 * Sigma is within bound when it is finite and at or below SIGMA_THRESHOLD.
 * Residual sigma decays geometrically and only reaches exact zero after a very
 * long run of healthy observations, so exact-zero checks block recovery for any
 * session that has ever dipped. The threshold is the existing design bound.
 */
export function sigmaWithinBound(sigma: number): boolean {
  return Number.isFinite(sigma) && sigma <= CONSTITUTION.SIGMA_THRESHOLD;
}
