/**
 * Research-only reference model aligned to Aureonics v4, Sections 3.5, 11 and 12.
 *
 * This module is intentionally not imported by the production kernel, PRAXIS,
 * governor, recovery plane, or any approval/quarantine path.
 *
 * It keeps the manuscript's distinct objects separate:
 *   x: measured constitutional state on the CRS simplex;
 *   w(T): task utility weights;
 *   k_i(x,T): basin-sensitive stiffness;
 *   z(t): trajectory/environmental context and adaptive memory elsewhere.
 *
 * The module exposes the manuscript's stiffness equation and a separately
 * named tangent-projected candidate because the raw equation is not generally
 * mass-conserving when k_i differ.
 */

export type CRSVector = readonly [number, number, number];
export type MutableCRSVector = [number, number, number];
export type Pillar = 'C' | 'R' | 'S';
export type OperatingRegion = 'analytical' | 'collaborative' | 'exploratory' | 'neutral' | 'boundary' | 'transition';

export const AUREONICS_HARD_FLOOR = 0.05;
export const SIMPLEX_SUM_TOLERANCE = 1e-9;
const PILLAR_INDEX: Record<Pillar, number> = { C: 0, R: 1, S: 2 };
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

export function assertNonnegativeSimplexState(x: CRSVector, tolerance = SIMPLEX_SUM_TOLERANCE): void {
  assertFiniteVector(x, 'state');
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError('tolerance must be finite and non-negative');
  if (Math.abs(x[0] + x[1] + x[2] - 1) > tolerance) throw new RangeError('state must sum to one');
  if (x.some(value => value < -tolerance)) throw new RangeError('state must be non-negative');
}

export function assertPositiveSimplexState(x: CRSVector, tolerance = SIMPLEX_SUM_TOLERANCE): void {
  assertNonnegativeSimplexState(x, tolerance);
  if (x.some(value => value <= 0)) throw new RangeError('state must be strictly positive for logarithmic potential');
}

export function assertFloorSimplexState(
  x: CRSVector,
  floor = AUREONICS_HARD_FLOOR,
  tolerance = SIMPLEX_SUM_TOLERANCE,
): void {
  assertPositiveSimplexState(x, tolerance);
  assertFloor(floor);
  if (x.some(value => value < floor - tolerance)) {
    throw new RangeError(`state must satisfy the coordinate floor ${floor}`);
  }
}

export function assertTaskWeights(weights: CRSVector): void {
  assertFiniteVector(weights, 'task weights');
  if (weights.some(value => value < 0)) throw new RangeError('task weights must be non-negative');
  if (Math.abs(weights[0] + weights[1] + weights[2] - 1) > SIMPLEX_SUM_TOLERANCE) {
    throw new RangeError('task weights must sum to one');
  }
}

/**
 * The manuscript's one-hot task profiles:
 * Analytical -> (1-2τ, τ, τ); Collaborative -> (τ, 1-2τ, τ);
 * Exploratory -> (τ, τ, 1-2τ).
 *
 * With interiorMargin=0 these are boundary-limit optima M=τ, not points in
 * the manuscript's strict M>τ stable region. A positive margin is an explicit
 * regularized extension, not a value specified by v4.
 */
export function basinProfileForPillar(
  pillar: Pillar,
  tauFloor = AUREONICS_HARD_FLOOR,
  interiorMargin = 0,
): MutableCRSVector {
  assertFloor(tauFloor);
  if (!Number.isFinite(interiorMargin) || interiorMargin < 0) {
    throw new RangeError('interiorMargin must be finite and non-negative');
  }
  const minimum = tauFloor + interiorMargin;
  if (minimum >= 1 / 3) throw new RangeError('tauFloor + interiorMargin must be less than 1/3');
  const result: MutableCRSVector = [minimum, minimum, minimum];
  result[PILLAR_INDEX[pillar]] = 1 - 2 * minimum;
  return result;
}

/**
 * Neutral-first, disjoint partition. Outside the neutral ball, M<=tau is
 * labeled boundary because the v4 directional basin conditions use M>tau.
 * Exact ties are separatrices between strict dominance regions, not members of
 * any one basin, and are labeled transition.
 */
export function classifyOperatingRegion(
  x: CRSVector,
  neutralRadius: number,
  tauFloor = AUREONICS_HARD_FLOOR,
): OperatingRegion {
  assertNonnegativeSimplexState(x);
  assertFloor(tauFloor);
  if (!Number.isFinite(neutralRadius) || neutralRadius < 0 || neutralRadius >= MAX_SIMPLEX_RADIUS) {
    throw new RangeError(`neutralRadius must be in [0, ${MAX_SIMPLEX_RADIUS})`);
  }
  const distance = Math.sqrt(
    (x[0] - CENTROID[0]) ** 2 +
    (x[1] - CENTROID[1]) ** 2 +
    (x[2] - CENTROID[2]) ** 2,
  );
  if (distance < neutralRadius) return 'neutral';
  if (Math.min(...x) <= tauFloor + SIMPLEX_SUM_TOLERANCE) return 'boundary';
  const maximum = Math.max(...x);
  const dominant = x.filter(value => Math.abs(value - maximum) <= SIMPLEX_SUM_TOLERANCE).length;
  if (dominant > 1) return 'transition';
  const dominantIndex = x.indexOf(maximum);
  return (['analytical', 'collaborative', 'exploratory'] as const)[dominantIndex];
}

/** Equation (18): task utility with a quadratic penalty below tauFloor. */
export function taskUtility(
  x: CRSVector,
  weights: CRSVector,
  lambda: number,
  tauFloor = AUREONICS_HARD_FLOOR,
): number {
  assertNonnegativeSimplexState(x);
  assertTaskWeights(weights);
  assertFloor(tauFloor);
  if (!Number.isFinite(lambda) || lambda < 0) throw new RangeError('lambda must be finite and non-negative');
  const weightedUtility = weights[0] * x[0] + weights[1] * x[1] + weights[2] * x[2];
  const violation = Math.max(0, tauFloor - Math.min(...x));
  return weightedUtility - lambda * violation ** 2;
}

/**
 * Equation (20): V(x,T) = -Σ w_i(T) log(x_i)
 *                  + (k0/2) Σ max(0, tauFloor-x_i)^2.
 */
export function constitutionalTaskPotential(
  x: CRSVector,
  weights: CRSVector,
  k0: number,
  tauFloor = AUREONICS_HARD_FLOOR,
): number {
  assertPositiveSimplexState(x);
  assertTaskWeights(weights);
  assertFloor(tauFloor);
  if (!Number.isFinite(k0) || k0 < 0) throw new RangeError('k0 must be finite and non-negative');
  const logTerm = -weights.reduce((sum, weight, index) => sum + weight * Math.log(x[index]), 0);
  const penalty = (k0 / 2) * x.reduce((sum, value) => sum + Math.max(0, tauFloor - value) ** 2, 0);
  return logTerm + penalty;
}

/** Exact ambient gradient of Equation (20). */
export function constitutionalTaskPotentialGradient(
  x: CRSVector,
  weights: CRSVector,
  k0: number,
  tauFloor = AUREONICS_HARD_FLOOR,
): MutableCRSVector {
  assertPositiveSimplexState(x);
  assertTaskWeights(weights);
  assertFloor(tauFloor);
  if (!Number.isFinite(k0) || k0 < 0) throw new RangeError('k0 must be finite and non-negative');
  return [
    -weights[0] / x[0] - k0 * Math.max(0, tauFloor - x[0]),
    -weights[1] / x[1] - k0 * Math.max(0, tauFloor - x[1]),
    -weights[2] / x[2] - k0 * Math.max(0, tauFloor - x[2]),
  ];
}

/** Tangent projection Π(v)=v-mean(v)1, which guarantees a zero-sum direction. */
export function projectToSimplexTangent(vector: CRSVector): MutableCRSVector {
  assertFiniteVector(vector, 'vector');
  const mean = (vector[0] + vector[1] + vector[2]) / 3;
  return [vector[0] - mean, vector[1] - mean, vector[2] - mean];
}

/**
 * Negative projected gradient of the manuscript's V(x,T).
 * For fixed task weights, gain>0 gives Vdot=-gain||Π(∇V)||²<=0.
 */
export function taskConditionedDirection(
  x: CRSVector,
  weights: CRSVector,
  k0: number,
  gain = 1,
  tauFloor = AUREONICS_HARD_FLOOR,
): MutableCRSVector {
  if (!Number.isFinite(gain) || gain <= 0) throw new RangeError('gain must be finite and positive');
  const gradient = constitutionalTaskPotentialGradient(x, weights, k0, tauFloor);
  const tangentGradient = projectToSimplexTangent(gradient);
  return tangentGradient.map(value => -gain * value) as MutableCRSVector;
}

/** Exact basin-sensitive stiffness from Section 12.1: k_i=k0*w_i/(M+epsilon). */
export function basinSensitiveStiffness(
  x: CRSVector,
  weights: CRSVector,
  k0: number,
  epsilonK: number,
): MutableCRSVector {
  assertNonnegativeSimplexState(x);
  assertTaskWeights(weights);
  if (!Number.isFinite(k0) || k0 <= 0) throw new RangeError('k0 must be finite and positive');
  if (!Number.isFinite(epsilonK) || epsilonK <= 0) throw new RangeError('epsilonK must be finite and positive');
  const margin = Math.min(...x);
  return weights.map(weight => k0 * weight / (margin + epsilonK)) as MutableCRSVector;
}

export interface BasinStiffnessCorrection {
  phi: MutableCRSVector;
  stiffness: MutableCRSVector;
  raw: MutableCRSVector;
  rawMassDrift: number;
  projected: MutableCRSVector;
}

/**
 * Returns both the manuscript's raw Eq. (13) correction and a candidate
 * tangent-projected variant. The raw expression is not generally mass
 * conserving when stiffness coordinates differ. The projected variant fixes
 * the sum constraint but is a proposed modification, not the paper's equation
 * and not automatically the gradient of Equation (20).
 */
export function basinStiffnessCorrection(
  x: CRSVector,
  weights: CRSVector,
  k0: number,
  epsilonK: number,
  tauFloor = AUREONICS_HARD_FLOOR,
): BasinStiffnessCorrection {
  assertNonnegativeSimplexState(x);
  assertTaskWeights(weights);
  assertFloor(tauFloor);
  const stiffness = basinSensitiveStiffness(x, weights, k0, epsilonK);
  const phi = x.map(value => Math.max(0, tauFloor - value)) as MutableCRSVector;
  const meanPhi = (phi[0] + phi[1] + phi[2]) / 3;
  const raw = stiffness.map((value, index) => value * (phi[index] - meanPhi)) as MutableCRSVector;
  const rawMassDrift = raw[0] + raw[1] + raw[2];
  return {
    phi,
    stiffness,
    raw,
    rawMassDrift,
    projected: projectToSimplexTangent(raw),
  };
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
  const residual = 1 - (projected[0] + projected[1] + projected[2]);
  const largest = projected.indexOf(Math.max(...projected));
  projected[largest] += residual;
  return projected;
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
 * Offline discrete reference step. Backtracks projected-gradient proposals
 * until the same fixed-task potential is non-increasing. No production
 * actuation is performed; the task-independent CBF remains final authority.
 */
export function guardedTaskStep(
  x: CRSVector,
  weights: CRSVector,
  options: {
    stepSize: number;
    k0: number;
    gain?: number;
    floor?: number;
    maxBacktracks?: number;
    tolerance?: number;
  },
): GuardedTaskStepResult {
  const floor = options.floor ?? AUREONICS_HARD_FLOOR;
  if (floor < AUREONICS_HARD_FLOOR) throw new RangeError('reference steps cannot weaken the Aureonics hard floor');
  assertFloorSimplexState(x, floor);
  if (!Number.isFinite(options.stepSize) || options.stepSize <= 0) throw new RangeError('stepSize must be finite and positive');
  const gain = options.gain ?? 1;
  const maxBacktracks = options.maxBacktracks ?? 24;
  const tolerance = options.tolerance ?? 1e-12;
  if (!Number.isInteger(maxBacktracks) || maxBacktracks < 0 || maxBacktracks > 60) {
    throw new RangeError('maxBacktracks must be an integer in [0, 60]');
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new RangeError('tolerance must be finite and non-negative');

  const previousPotential = constitutionalTaskPotential(x, weights, options.k0, floor);
  const direction = taskConditionedDirection(x, weights, options.k0, gain, floor);
  let step = options.stepSize;
  for (let backtracks = 0; backtracks <= maxBacktracks; backtracks++) {
    const candidate = projectToFloorSimplex([
      x[0] + step * direction[0],
      x[1] + step * direction[1],
      x[2] + step * direction[2],
    ], floor);
    const nextPotential = constitutionalTaskPotential(candidate, weights, options.k0, floor);
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
