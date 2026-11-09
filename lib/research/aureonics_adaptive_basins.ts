/**
 * Research-only reference model for Aureonics' three task-conditioned operating regions.
 *
 * This module is intentionally not imported by the production kernel, PRAXIS,
 * governor, recovery plane, or any approval/quarantine path.
 *
 * It separates:
 *   x: measured constitutional state on the floor-constrained simplex;
 *   w: task preference over C/R/S;
 *   q: strictly interior task target derived from w;
 *   z: adaptive constitutional-memory weights used by V_z elsewhere.
 *
 * The three named regions are operating classifications, not proven attractors.
 */

export type CRSVector = readonly [number, number, number];
export type MutableCRSVector = [number, number, number];
export type Pillar = 'C' | 'R' | 'S';
export type OperatingRegion = 'analytical' | 'collaborative' | 'exploratory' | 'neutral';

export const AUREONICS_HARD_FLOOR = 0.05;
export const SIMPLEX_SUM_TOLERANCE = 1e-9;
const CENTROID: CRSVector = [1 / 3, 1 / 3, 1 / 3];
const MAX_SIMPLEX_RADIUS = Math.sqrt(2 / 3);

function assertFiniteVector(value: CRSVector, name: string): void {
  if (value.length !== 3 || !value.every(Number.isFinite)) {
    throw new RangeError(`${name} must contain exactly three finite numbers`);
  }
}

function assertFloor(floor: number): void {
  if (!Number.isFinite(floor) || floor < 0 || floor >= 1 / 3) {
    throw new RangeError('floor must be finite and in [0, 1/3)');
  }
}

export function assertSimplexState(
  x: CRSVector,
  floor = AUREONICS_HARD_FLOOR,
  tolerance = SIMPLEX_SUM_TOLERANCE,
): void {
  assertFiniteVector(x, 'state');
  assertFloor(floor);
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError('tolerance must be finite and non-negative');
  if (Math.abs(x[0] + x[1] + x[2] - 1) > tolerance) {
    throw new RangeError('state must sum to one');
  }
  if (x.some(value => value < floor - tolerance)) {
    throw new RangeError(`state must satisfy the coordinate floor ${floor}`);
  }
}

export function assertSimplexWeights(weights: CRSVector, name = 'weights'): void {
  assertFiniteVector(weights, name);
  if (weights.some(value => value < 0)) throw new RangeError(`${name} must be non-negative`);
  if (Math.abs(weights[0] + weights[1] + weights[2] - 1) > SIMPLEX_SUM_TOLERANCE) {
    throw new RangeError(`${name} must sum to one`);
  }
}

/**
 * Convert a task preference w into a strictly interior target q:
 * q_i = tauB + (1 - 3*tauB) * w_i.
 *
 * tauB is deliberately explicit: it must exceed the immutable hard floor,
 * and is not silently selected as a production default.
 */
export function taskTargetFromWeights(weights: CRSVector, tauB: number): MutableCRSVector {
  assertSimplexWeights(weights, 'task weights');
  if (!Number.isFinite(tauB) || tauB <= AUREONICS_HARD_FLOOR || tauB >= 1 / 3) {
    throw new RangeError('basin target margin tauB must be greater than the hard floor and less than 1/3');
  }
  const scale = 1 - 3 * tauB;
  return [
    tauB + scale * weights[0],
    tauB + scale * weights[1],
    tauB + scale * weights[2],
  ];
}

/**
 * Deterministic partition of the floor-simplex into one neutral region and
 * three directional operating regions. Neutral is tested first. Outside it,
 * the largest coordinate determines the region; exact ties resolve C, then R,
 * then S. This is a classification convention, not a convergence theorem.
 */
export function classifyOperatingRegion(x: CRSVector, neutralRadius: number): OperatingRegion {
  assertSimplexState(x);
  if (!Number.isFinite(neutralRadius) || neutralRadius < 0 || neutralRadius >= MAX_SIMPLEX_RADIUS) {
    throw new RangeError(`neutralRadius must be in [0, ${MAX_SIMPLEX_RADIUS})`);
  }
  const distance = Math.sqrt(
    (x[0] - CENTROID[0]) ** 2 +
    (x[1] - CENTROID[1]) ** 2 +
    (x[2] - CENTROID[2]) ** 2,
  );
  if (distance <= neutralRadius) return 'neutral';
  const dominantIndex = x.indexOf(Math.max(...x));
  return (['analytical', 'collaborative', 'exploratory'] as const)[dominantIndex];
}

/** Euclidean projection onto {x: sum(x)=1, x_i >= floor}. */
export function projectToFloorSimplex(input: CRSVector, floor = AUREONICS_HARD_FLOOR): MutableCRSVector {
  assertFiniteVector(input, 'projection input');
  assertFloor(floor);
  const targetMass = 1 - 3 * floor;
  const shifted = input.map(value => value - floor);
  const sorted = [...shifted].sort((a, b) => b - a);
  let cumulative = 0;
  let activeCount = 0;
  let threshold = 0;
  for (let index = 0; index < 3; index++) {
    cumulative += sorted[index];
    const candidateThreshold = (cumulative - targetMass) / (index + 1);
    if (sorted[index] > candidateThreshold) {
      activeCount = index + 1;
      threshold = candidateThreshold;
    }
  }
  if (activeCount === 0) throw new RangeError('unable to project input onto the requested simplex');
  const projected = shifted.map(value => Math.max(value - threshold, 0) + floor) as MutableCRSVector;
  // Correct only floating-point summation residue; do not renormalize, which
  // could move a coordinate below the requested floor.
  const residual = 1 - (projected[0] + projected[1] + projected[2]);
  const largest = projected.indexOf(Math.max(...projected));
  projected[largest] += residual;
  return projected;
}

/** Tangent projection onto the simplex hyperplane: v - mean(v) * 1. */
export function projectToSimplexTangent(vector: CRSVector): MutableCRSVector {
  assertFiniteVector(vector, 'vector');
  const mean = (vector[0] + vector[1] + vector[2]) / 3;
  return [vector[0] - mean, vector[1] - mean, vector[2] - mean];
}

/** Task potential V_T(x;q) = -sum_i q_i log(x_i), for fixed interior q. */
export function taskPotential(x: CRSVector, q: CRSVector): number {
  assertSimplexState(x);
  assertSimplexWeights(q, 'task target');
  if (q.some(value => value <= 0)) throw new RangeError('task target must be strictly interior');
  return -q.reduce((sum, weight, index) => sum + weight * Math.log(x[index]), 0);
}

/** Ambient gradient dV_T/dx_i = -q_i/x_i. */
export function taskPotentialGradient(x: CRSVector, q: CRSVector): MutableCRSVector {
  assertSimplexState(x);
  assertSimplexWeights(q, 'task target');
  if (q.some(value => value <= 0)) throw new RangeError('task target must be strictly interior');
  return [-q[0] / x[0], -q[1] / x[1], -q[2] / x[2]];
}

/**
 * Negative projected gradient. For fixed q and positive gain g:
 * grad(V_T) dot direction = -g * ||Pi(grad(V_T))||^2 <= 0.
 * This is a continuous-time directional result, not a discrete-step guarantee.
 */
export function taskConditionedDirection(x: CRSVector, q: CRSVector, gain = 1): MutableCRSVector {
  if (!Number.isFinite(gain) || gain <= 0) throw new RangeError('gain must be finite and positive');
  const tangentGradient = projectToSimplexTangent(taskPotentialGradient(x, q));
  return tangentGradient.map(value => -gain * value) as MutableCRSVector;
}

export interface GuardedTaskStepResult {
  state: MutableCRSVector;
  accepted: boolean;
  previousPotential: number;
  nextPotential: number;
  acceptedStepSize: number;
  backtracks: number;
}

/**
 * Offline discrete reference step. Backtracks a projected-gradient proposal
 * until the fixed-q potential does not increase. If no acceptable move is
 * found, it returns the original state unchanged. A caller must still apply
 * the task-independent production CBF/safety filter before any real actuation.
 */
export function guardedTaskStep(
  x: CRSVector,
  q: CRSVector,
  options: {
    stepSize: number;
    gain?: number;
    floor?: number;
    maxBacktracks?: number;
    tolerance?: number;
  },
): GuardedTaskStepResult {
  const floor = options.floor ?? AUREONICS_HARD_FLOOR;
  assertSimplexState(x, floor);
  if (!Number.isFinite(options.stepSize) || options.stepSize <= 0) throw new RangeError('stepSize must be finite and positive');
  const gain = options.gain ?? 1;
  const maxBacktracks = options.maxBacktracks ?? 24;
  const tolerance = options.tolerance ?? 1e-12;
  if (!Number.isInteger(maxBacktracks) || maxBacktracks < 0 || maxBacktracks > 60) {
    throw new RangeError('maxBacktracks must be an integer in [0, 60]');
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError('tolerance must be finite and non-negative');

  const previousPotential = taskPotential(x, q);
  const direction = taskConditionedDirection(x, q, gain);
  let step = options.stepSize;
  for (let backtracks = 0; backtracks <= maxBacktracks; backtracks++) {
    const candidate = projectToFloorSimplex([
      x[0] + step * direction[0],
      x[1] + step * direction[1],
      x[2] + step * direction[2],
    ], floor);
    const nextPotential = taskPotential(candidate, q);
    if (nextPotential <= previousPotential + tolerance) {
      const accepted = candidate.some((value, index) => Math.abs(value - x[index]) > 1e-14);
      return {
        state: candidate,
        accepted,
        previousPotential,
        nextPotential,
        acceptedStepSize: accepted ? step : 0,
        backtracks,
      };
    }
    step /= 2;
  }
  return {
    state: [...x] as MutableCRSVector,
    accepted: false,
    previousPotential,
    nextPotential: previousPotential,
    acceptedStepSize: 0,
    backtracks: maxBacktracks + 1,
  };
}
