/**
 * Composite tracking-storage analysis for task-varying Aureonics dynamics.
 *
 * Research-only. The certificate is conditional on strictly positive task
 * weights and a continuous-time projected-gradient reference flow.
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
  minimumTaskWeight: number;
  projectedGradientNorm: number;
  taskWeightDerivativeNorm: number;
  decayLowerBound: number;
  driftUpperBound: number;
  derivativeUpperBound: number;
  trackingDistanceUpperBound: number;
}

/**
 * W(x,w)=V(x,w)-min_y V(y,w). For strictly positive weights, the constrained
 * minimizer is unique and W is a nonnegative tracking-error storage.
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
 * - all task weights are strictly positive;
 * - sum(w)=1 and sum(wDot)=0;
 * - eta>0 and the flow uses the Euclidean tangent-cone projection.
 *
 * Let mu=min_i w_i. Since x_i<=1, Hessian(V)>=mu I. The projected-gradient
 * Polyak-Lojasiewicz bound gives ||P_K(-grad V)||^2 >= 2 mu W.
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
  if (weights.some(weight => weight <= 0)) {
    throw new RangeError('continuous tracking certificate requires strictly positive task weights');
  }
  if (weightsDerivative.some(value => !Number.isFinite(value))) {
    throw new RangeError('task-weight derivative must be finite');
  }
  const derivativeSum = weightsDerivative[0] + weightsDerivative[1] + weightsDerivative[2];
  if (Math.abs(derivativeSum) > SIMPLEX_DERIVATIVE_TOLERANCE) {
    throw new RangeError('task-weight derivative must be tangent to the weight simplex');
  }
  if (!Number.isFinite(options.eta) || options.eta <= 0) {
    throw new RangeError('eta must be finite and positive');
  }

  const minimumTaskWeight = Math.min(...weights);
  const trackingPotential = taskTrackingErrorPotential(x, weights, options.k0, tauFloor);
  const projectedGradientNorm = projectedTaskPotentialEffort(x, weights, options.k0, tauFloor);
  const taskWeightDerivativeNorm = Math.sqrt(
    weightsDerivative.reduce((sum, value) => sum + value ** 2, 0),
  );
  const decayLowerBound = 2 * options.eta * minimumTaskWeight * trackingPotential;
  const driftUpperBound = (taskWeightDerivativeNorm / tauFloor)
    * Math.sqrt(2 * trackingPotential / minimumTaskWeight);

  return {
    trackingPotential,
    minimumTaskWeight,
    projectedGradientNorm,
    taskWeightDerivativeNorm,
    decayLowerBound,
    driftUpperBound,
    derivativeUpperBound: -decayLowerBound + driftUpperBound,
    trackingDistanceUpperBound: Math.sqrt(2 * trackingPotential / minimumTaskWeight),
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
