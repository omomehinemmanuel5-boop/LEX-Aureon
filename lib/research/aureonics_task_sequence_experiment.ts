/**
 * Deterministic, research-only task-sequence comparison.
 *
 * Compares (1) the production discrete transition with its session-z update,
 * (2) an oracle task-potential controller with the true task label, and
 * (3) a hysteretic research task router feeding the same task-potential flow.
 *
 * This is an offline comparator, not a production task router. The z update
 * below mirrors lib/kv.ts for the no-law-event case; the production state map
 * itself is called directly through productionStateTransition().
 */
import {
  AUREONICS_HARD_FLOOR,
  projectToFloorSimplex,
  taskPotentialMinimizer,
  taskConditionedDirection,
  type CRSVector,
  type MutableCRSVector,
  type Pillar,
} from './aureonics_adaptive_basins';
import { taskTrackingErrorPotential } from './aureonics_task_tracking';
import {
  productionStateTransition,
  type ProductionDelta,
  type ProductionState,
} from '../production_transition';

const Z_RHO = 0.85;
const Z_CLAMP_LO = 0.025;
const Z_CLAMP_HI = 0.95;
const ZERO_DELTA: ProductionDelta = { dc: 0, dr: 0, ds: 0 };

export interface TaskSequenceExperimentOptions {
  initialState?: CRSVector;
  initialZ?: CRSVector;
  tauFloor?: number;
  eta?: number;
  challengeMagnitude?: number;
  routerDwellSteps?: number;
}

export interface TaskSequenceMetrics {
  meanDistanceToTrueTaskOptimum: number;
  finalDistanceToTrueTaskOptimum: number;
  meanTaskTrackingPotential: number;
  finalTaskTrackingPotential: number;
  totalTaskWeightVariation: number;
  taskSwitches: number;
  minimumObservedCoordinate: number;
  maximumSimplexResidual: number;
}

export interface TaskSequenceExperimentResult {
  labels: Pillar[];
  productionZBaseline: {
    states: MutableCRSVector[];
    zWeights: MutableCRSVector[];
    metrics: TaskSequenceMetrics;
    totalZVariation: number;
  };
  oracleTaskPotential: {
    states: MutableCRSVector[];
    taskWeights: MutableCRSVector[];
    metrics: TaskSequenceMetrics;
  };
  hystereticTaskRouter: {
    states: MutableCRSVector[];
    taskWeights: MutableCRSVector[];
    routedLabels: Pillar[];
    metrics: TaskSequenceMetrics;
  };
}

const INDEX: Record<Pillar, 0 | 1 | 2> = { C: 0, R: 1, S: 2 };

function oneHot(label: Pillar): MutableCRSVector {
  const weights: MutableCRSVector = [0, 0, 0];
  weights[INDEX[label]] = 1;
  return weights;
}

function asProductionState(x: CRSVector): ProductionState {
  return { C: x[0], R: x[1], S: x[2] };
}

function asVector(x: ProductionState): MutableCRSVector {
  return [x.C, x.R, x.S];
}

function challengeDelta(label: Pillar, magnitude: number): MutableCRSVector {
  const result: MutableCRSVector = [magnitude / 2, magnitude / 2, magnitude / 2];
  result[INDEX[label]] = -magnitude;
  return result;
}

function asDelta(x: CRSVector): ProductionDelta {
  return { dc: x[0], dr: x[1], ds: x[2] };
}

/** Exact no-law-event z recurrence mirrored from lib/kv.ts. */
function updateProductionZ(previous: CRSVector, state: CRSVector): MutableCRSVector {
  const raw = previous.map((value, index) => Z_RHO * value + (1 - Z_RHO) * state[index]);
  const clamped = raw.map(value => Math.max(Z_CLAMP_LO, Math.min(Z_CLAMP_HI, value)));
  const total = clamped[0] + clamped[1] + clamped[2];
  return clamped.map(value => value / total) as MutableCRSVector;
}

function distance(a: CRSVector, b: CRSVector): number {
  return Math.sqrt(a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0));
}

function metrics(
  states: readonly CRSVector[],
  weights: readonly CRSVector[],
  labels: readonly Pillar[],
  tauFloor: number,
): TaskSequenceMetrics {
  if (states.length !== labels.length || weights.length !== labels.length) {
    throw new RangeError('state, weight, and label histories must have equal lengths');
  }
  let distanceSum = 0;
  let potentialSum = 0;
  let variation = 0;
  let switches = 0;
  let minimumCoordinate = 1;
  let maximumSimplexResidual = 0;
  for (let i = 0; i < labels.length; i++) {
    const optimum = taskPotentialMinimizer(oneHot(labels[i]), tauFloor);
    distanceSum += distance(states[i], optimum);
    potentialSum += taskTrackingErrorPotential(states[i], weights[i], 0, tauFloor);
    minimumCoordinate = Math.min(minimumCoordinate, ...states[i]);
    maximumSimplexResidual = Math.max(
      maximumSimplexResidual,
      Math.abs(states[i][0] + states[i][1] + states[i][2] - 1),
    );
    if (i > 0) {
      const delta = weights[i].map((value, index) => value - weights[i - 1][index]);
      const l1 = delta.reduce((sum, value) => sum + Math.abs(value), 0);
      variation += l1;
      if (l1 > 1e-12) switches++;
    }
  }
  const finalOptimum = taskPotentialMinimizer(oneHot(labels[labels.length - 1]), tauFloor);
  return {
    meanDistanceToTrueTaskOptimum: distanceSum / labels.length,
    finalDistanceToTrueTaskOptimum: distance(states[states.length - 1], finalOptimum),
    meanTaskTrackingPotential: potentialSum / labels.length,
    finalTaskTrackingPotential: potentialSum === 0 ? 0 : taskTrackingErrorPotential(
      states[states.length - 1], weights[weights.length - 1], 0, tauFloor,
    ),
    totalTaskWeightVariation: variation,
    taskSwitches: switches,
    minimumObservedCoordinate: minimumCoordinate,
    maximumSimplexResidual,
  };
}

function validateOptions(options: TaskSequenceExperimentOptions): Required<TaskSequenceExperimentOptions> {
  const tauFloor = options.tauFloor ?? AUREONICS_HARD_FLOOR;
  const eta = options.eta ?? 0.004;
  const challengeMagnitude = options.challengeMagnitude ?? 0.001;
  const routerDwellSteps = options.routerDwellSteps ?? 3;
  const initialState = options.initialState ?? [1 / 3, 1 / 3, 1 / 3];
  const initialZ = options.initialZ ?? [1 / 3, 1 / 3, 1 / 3];
  if (![tauFloor, eta, challengeMagnitude].every(Number.isFinite)
    || tauFloor <= 0 || tauFloor >= 1 / 3 || eta <= 0 || challengeMagnitude < 0) {
    throw new RangeError('invalid floor, gain, or challenge magnitude');
  }
  if (!Number.isInteger(routerDwellSteps) || routerDwellSteps < 1) {
    throw new RangeError('routerDwellSteps must be a positive integer');
  }
  if (initialState.some(value => !Number.isFinite(value))
    || Math.abs(initialState[0] + initialState[1] + initialState[2] - 1) > 1e-9
    || initialState.some(value => value < tauFloor)) {
    throw new RangeError('initialState must be a floor-feasible simplex state');
  }
  if (initialZ.some(value => !Number.isFinite(value) || value <= 0)
    || Math.abs(initialZ[0] + initialZ[1] + initialZ[2] - 1) > 1e-9) {
    throw new RangeError('initialZ must be a strictly positive simplex vector');
  }
  return { tauFloor, eta, challengeMagnitude, routerDwellSteps, initialState, initialZ };
}

/**
 * Run the same exogenous task sequence against three explicitly distinct
 * controllers. Task labels are workload labels; their perturbation is a
 * declared synthetic stressor, not a claim about real-world task effects.
 */
export function runTaskSequenceExperiment(
  labels: readonly Pillar[],
  options: TaskSequenceExperimentOptions = {},
): TaskSequenceExperimentResult {
  if (labels.length === 0 || labels.some(label => label !== 'C' && label !== 'R' && label !== 'S')) {
    throw new RangeError('labels must be a non-empty sequence of C, R, or S');
  }
  const config = validateOptions(options);
  const { tauFloor, eta, challengeMagnitude, routerDwellSteps } = config;

  let productionState = [...config.initialState] as MutableCRSVector;
  let productionZ = [...config.initialZ] as MutableCRSVector;
  const productionStates: MutableCRSVector[] = [];
  const productionTaskWeights: MutableCRSVector[] = [];
  const productionZHistory: MutableCRSVector[] = [];
  let totalZVariation = 0;

  let oracleState = [...config.initialState] as MutableCRSVector;
  const oracleStates: MutableCRSVector[] = [];
  const oracleWeights: MutableCRSVector[] = [];

  let routedState = [...config.initialState] as MutableCRSVector;
  let routedLabel = labels[0];
  let pendingLabel = routedLabel;
  let pendingCount = 0;
  const routedStates: MutableCRSVector[] = [];
  const routedWeights: MutableCRSVector[] = [];
  const routedLabels: Pillar[] = [];

  for (const label of labels) {
    const disturbance = challengeDelta(label, challengeMagnitude);
    const trueWeights = oneHot(label);

    const productionResult = productionStateTransition({
      state: asProductionState(productionState),
      delta: asDelta(disturbance),
      postResponseDelta: ZERO_DELTA,
      semanticAttack: false,
      semanticSeverity: 0,
      advGain: 0,
      effectiveTheta: 1,
      threatSignal: 0,
      theta: 1,
      lyapunovWeights: [...productionZ],
    });
    productionState = asVector(productionResult.state);
    const nextZ = updateProductionZ(productionZ, productionState);
    totalZVariation += nextZ.reduce((sum, value, index) => sum + Math.abs(value - productionZ[index]), 0);
    productionZ = nextZ;
    productionStates.push([...productionState]);
    productionTaskWeights.push([...trueWeights]);
    productionZHistory.push([...productionZ]);

    const oracleDirection = taskConditionedDirection(oracleState, trueWeights, 0, eta, tauFloor);
    oracleState = projectToFloorSimplex([
      oracleState[0] + oracleDirection[0] + disturbance[0],
      oracleState[1] + oracleDirection[1] + disturbance[1],
      oracleState[2] + oracleDirection[2] + disturbance[2],
    ], tauFloor);
    oracleStates.push([...oracleState]);
    oracleWeights.push([...trueWeights]);

    if (label === routedLabel) {
      pendingLabel = routedLabel;
      pendingCount = 0;
    } else {
      if (label === pendingLabel) pendingCount++;
      else {
        pendingLabel = label;
        pendingCount = 1;
      }
      if (pendingCount >= routerDwellSteps) {
        routedLabel = pendingLabel;
        pendingCount = 0;
      }
    }
    const routedTaskWeights = oneHot(routedLabel);
    const routedDirection = taskConditionedDirection(routedState, routedTaskWeights, 0, eta, tauFloor);
    routedState = projectToFloorSimplex([
      routedState[0] + routedDirection[0] + disturbance[0],
      routedState[1] + routedDirection[1] + disturbance[1],
      routedState[2] + routedDirection[2] + disturbance[2],
    ], tauFloor);
    routedStates.push([...routedState]);
    routedWeights.push([...routedTaskWeights]);
    routedLabels.push(routedLabel);
  }

  return {
    labels: [...labels],
    productionZBaseline: {
      states: productionStates,
      zWeights: productionZHistory,
      metrics: metrics(productionStates, productionTaskWeights, labels, tauFloor),
      totalZVariation,
    },
    oracleTaskPotential: {
      states: oracleStates,
      taskWeights: oracleWeights,
      metrics: metrics(oracleStates, oracleWeights, labels, tauFloor),
    },
    hystereticTaskRouter: {
      states: routedStates,
      taskWeights: routedWeights,
      routedLabels,
      metrics: metrics(routedStates, routedWeights, labels, tauFloor),
    },
  };
}
