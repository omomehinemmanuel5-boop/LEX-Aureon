/**
 * Composite tracking-storage analysis for task-varying Aureonics dynamics.
 *
 * Research-only. The continuous-drift certificate requires at least two
 * positive task weights; one-hot modes have a separate fixed-mode result.
 */
import {
  AUREONICS_HARD_FLOOR,
  assertFloorSimplexState,
  assertTaskWeights,
  constitutionalTaskPotential,
  projectedTaskPotentialEffort,
  taskPotentialMinimizer,
  type CRSVector,
  type MutableCRSVector,
} from './aureonics_adaptive_basins';

const SIMPLEX_DERIVATIVE_TOLERANCE = 1e-9;

export interface ContinuousTrackingCertificate {
  trackingPotential: number;
  minimumPositiveTaskWeight: number;
  strongConvexityModulus: number;
  projectedGradientNorm: number;
  taskWeightDerivativeNorm: number;
  decayLowerBound: number;
  driftUpperBound: number;
  derivativeUpperBound: number;
  trackingDistanceUpperBound: number;
}

/**
 * W(x,w)=V(x,w)-min_y V(y,w). The constrained minimizer is unique on the
 * floor-constrained simplex, and W is a nonnegative tracking-error storage.
 */
export function taskTrackingErrorPotential(
  x: CRSVector,
  weights: CRSVector,
  k0: number,
  tauFloor = AUREONICS_HARD_FLOOR,
): number {
  assertFloorSimplexState(x, tauFloor);
  assertTaskWeights(weights);
  const optimum = taskPotentialMinimizer(weights, tauFloor);
  const gap = constitutionalTaskPotential(x, weights, k0, tauFloor)
    - constitutionalTaskPotential(optimum, weights, k0, tauFloor);
  return Math.max(0, gap);
}

/**
 * Supplies a sufficient upper bound on W-dot for the projected flow
 * x-dot = eta * P_K(-grad_x V), when weights are absolutely continuous.
 *
 * Assumptions:
 * - x lies on the floor-constrained simplex;
 * - at least two task weights are positive (support size >= 2);
 * - sum(w)=1 and sum(wDot)=0, with the support of w fixed (zero-weight coordinates stay zero);
 * - eta>0 and the flow uses the Euclidean tangent-cone projection.
 *
 * Let m be the smallest positive task weight. On the simplex tangent plane,
 * the Hessian quadratic form is bounded below by (m/3)||d||^2 whenever
 * at least two weights are positive. The projected-gradient
 * Polyak-Lojasiewicz bound gives ||P_K(-grad V)||^2 >= 2 mu W, with mu=m/3.
 * Also ||log(x)-log(x*)||_2 <= ||x-x*||_2/tau and
 * ||x-x*||_2 <= sqrt(2W/mu). Thus
 *
 * W-dot <= -2 eta mu W
 *          + ||wDot||_2/tau * sqrt(2W/mu).
 *
 * This is an input-to-state tracking bound, not an arbitrary-switching result.
 */
export function continuousTaskTrackingCertificate(
  x: CRSVector,
  weights: CRSVector,
  weightsDerivative: CRSVector,
  options: {
    eta: number;
    k0: number;
    tauFloor?: number;
  },
): ContinuousTrackingCertificate {
  const tauFloor = options.tauFloor ?? AUREONICS_HARD_FLOOR;
  assertFloorSimplexState(x, tauFloor);
  assertTaskWeights(weights);
  const positiveWeights = weights.filter(weight => weight > 0);
  if (positiveWeights.length < 2) {
    throw new RangeError('continuous tracking certificate requires at least two positive task weights; use the one-hot fixed-mode certificate otherwise');
  }
  if (weightsDerivative.some(value => !Number.isFinite(value))) {
    throw new RangeError('task-weight derivative must be finite');
  }
  const derivativeSum = weightsDerivative[0] + weightsDerivative[1] + weightsDerivative[2];
  if (Math.abs(derivativeSum) > SIMPLEX_DERIVATIVE_TOLERANCE) {
    throw new RangeError('task-weight derivative must be tangent to the weight simplex');
  }
  if (weights.some((weight, index) => weight <= SIMPLEX_DERIVATIVE_TOLERANCE
    && Math.abs(weightsDerivative[index]) > SIMPLEX_DERIVATIVE_TOLERANCE)) {
    throw new RangeError('continuous tracking certificate requires zero-weight coordinates to remain zero');
  }
  if (!Number.isFinite(options.eta) || options.eta <= 0) {
    throw new RangeError('eta must be finite and positive');
  }

  const minimumPositiveTaskWeight = Math.min(...positiveWeights);
  const strongConvexityModulus = minimumPositiveTaskWeight / 3;
  const trackingPotential = taskTrackingErrorPotential(x, weights, options.k0, tauFloor);
  const projectedGradientNorm = projectedTaskPotentialEffort(x, weights, options.k0, tauFloor);
  const taskWeightDerivativeNorm = Math.sqrt(
    weightsDerivative.reduce((sum, value) => sum + value ** 2, 0),
  );
  const decayLowerBound = 2 * options.eta * strongConvexityModulus * trackingPotential;
  const driftUpperBound = (taskWeightDerivativeNorm / tauFloor)
    * Math.sqrt(2 * trackingPotential / strongConvexityModulus);

  return {
    trackingPotential,
    minimumPositiveTaskWeight,
    strongConvexityModulus,
    projectedGradientNorm,
    taskWeightDerivativeNorm,
    decayLowerBound,
    driftUpperBound,
    derivativeUpperBound: -decayLowerBound + driftUpperBound,
    trackingDistanceUpperBound: Math.sqrt(2 * trackingPotential / strongConvexityModulus),
  };
}

/**
 * At a discontinuous switch, the composite tracking storage has an additive
 * jump bounded by log(1/tau)*||deltaWeights||_1. This uses sum(deltaWeights)=0
 * and the fact that every feasible log-coordinate lies in [log(tau),0].
 */
export function taskTrackingSwitchJumpBound(
  deltaWeights: CRSVector,
  tauFloor = AUREONICS_HARD_FLOOR,
): number {
  if (deltaWeights.some(value => !Number.isFinite(value))) {
    throw new RangeError('task-weight change must be finite');
  }
  const sum = deltaWeights[0] + deltaWeights[1] + deltaWeights[2];
  if (Math.abs(sum) > SIMPLEX_DERIVATIVE_TOLERANCE) {
    throw new RangeError('task-weight change must preserve the weight simplex');
  }
  if (!Number.isFinite(tauFloor) || tauFloor <= 0 || tauFloor >= 1 / 3) {
    throw new RangeError('tauFloor must be finite and in (0, 1/3)');
  }
  const l1Change = deltaWeights.reduce((sumValue, value) => sumValue + Math.abs(value), 0);
  return Math.log(1 / tauFloor) * l1Change;
}


export interface OneHotTaskModeCertificate {
  dominantIndex: 0 | 1 | 2;
  trackingPotential: number;
  maximumPotential: number;
  projectedGradientNorm: number;
  projectedGradientLowerBound: number;
  decayRateLowerBound: number;
  stateDistanceUpperBound: number;
}

/**
 * Fixed-mode result for a one-hot task vector e_j. Its constrained optimizer
 * is the simplex vertex with x_j=1-2*tau and the other coordinates at tau.
 * The objective is not strongly convex on the full tangent plane, but the
 * floor-constrained geometry supplies a sharp error bound and a PL bound:
 *
 *   ||x-x*|| <= sqrt(2)*(1-2*tau)*W
 *   ||P_K(-grad V)||^2 >= W/(2*log((1-2*tau)/tau)).
 *
 * Hence W-dot <= -eta/(2*W_max) W for the fixed one-hot projected flow.
 * This does not cover switching away from the one-hot mode.
 */
export function oneHotTaskModeCertificate(
  x: CRSVector,
  dominantIndex: 0 | 1 | 2,
  eta: number,
  tauFloor = AUREONICS_HARD_FLOOR,
): OneHotTaskModeCertificate {
  assertFloorSimplexState(x, tauFloor);
  if (dominantIndex !== 0 && dominantIndex !== 1 && dominantIndex !== 2) {
    throw new RangeError('dominantIndex must be 0, 1, or 2');
  }
  if (!Number.isFinite(eta) || eta <= 0) throw new RangeError('eta must be finite and positive');

  const target = 1 - 2 * tauFloor;
  const coordinate = x[dominantIndex];
  const trackingPotential = Math.max(0, Math.log(target / coordinate));
  const maximumPotential = Math.log(target / tauFloor);
  const weights: MutableCRSVector = [0, 0, 0];
  weights[dominantIndex] = 1;
  const projectedGradientNorm = projectedTaskPotentialEffort(x, weights, 0, tauFloor);
  const projectedGradientLowerBound = trackingPotential > 0
    ? 1 / (Math.sqrt(2) * coordinate)
    : 0;

  return {
    dominantIndex,
    trackingPotential,
    maximumPotential,
    projectedGradientNorm,
    projectedGradientLowerBound,
    decayRateLowerBound: eta / (2 * maximumPotential),
    stateDistanceUpperBound: Math.SQRT2 * target * trackingPotential,
  };
}
