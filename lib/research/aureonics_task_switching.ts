/**
 * Offline switched-task experiments for the Aureonics adaptive-basin model.
 *
 * This module models piecewise-constant task weights only. It does not model
 * continuous task-weight drift and is not imported by production code.
 */
import {
  AUREONICS_HARD_FLOOR,
  assertFloorSimplexState,
  assertTaskWeights,
  constitutionalTaskPotential,
  guardedTaskStep,
  type CRSVector,
  type MutableCRSVector,
} from './aureonics_adaptive_basins';

export interface TaskSwitchSegment {
  label: string;
  weights: CRSVector;
  steps: number;
}

export interface TaskSwitchRecord {
  label: string;
  weights: CRSVector;
  step: number;
  state: MutableCRSVector;
  potential: number;
  accepted: boolean;
}

export interface TaskSwitchBoundary {
  fromLabel: string | null;
  toLabel: string;
  state: MutableCRSVector;
  previousPotential: number | null;
  nextPotential: number;
  jump: number | null;
}

export interface SwitchedTaskSimulation {
  initialState: MutableCRSVector;
  finalState: MutableCRSVector;
  records: TaskSwitchRecord[];
  switches: TaskSwitchBoundary[];
}

/**
 * Runs deterministic fixed-task descent segments with abrupt task switches.
 * Each accepted step is guarded against increase in the active segment's
 * potential. A switch can still cause a discontinuous potential jump because
 * the objective itself changes while the state is held fixed.
 */
export function simulatePiecewiseConstantTaskSwitching(
  initialState: CRSVector,
  segments: readonly TaskSwitchSegment[],
  options: {
    stepSize: number;
    k0: number;
    gain?: number;
    floor?: number;
    maxBacktracks?: number;
  },
): SwitchedTaskSimulation {
  const floor = options.floor ?? AUREONICS_HARD_FLOOR;
  if (floor < AUREONICS_HARD_FLOOR) {
    throw new RangeError('switched-task simulation cannot weaken the Aureonics hard floor');
  }
  assertFloorSimplexState(initialState, floor);
  if (segments.length === 0) throw new RangeError('at least one task segment is required');
  if (segments.length > 10000) throw new RangeError('at most 10000 task segments are supported');

  let state = [...initialState] as MutableCRSVector;
  let previousWeights: CRSVector | null = null;
  let previousLabel: string | null = null;
  const records: TaskSwitchRecord[] = [];
  const switches: TaskSwitchBoundary[] = [];

  for (const segment of segments) {
    if (!segment.label.trim()) throw new RangeError('task segment label must be non-empty');
    assertTaskWeights(segment.weights);
    if (!Number.isInteger(segment.steps) || segment.steps < 1 || segment.steps > 100000) {
      throw new RangeError('each task segment must contain between 1 and 100000 steps');
    }
    const previousPotential = previousWeights
      ? constitutionalTaskPotential(state, previousWeights, options.k0, floor)
      : null;
    const nextPotential = constitutionalTaskPotential(state, segment.weights, options.k0, floor);
    switches.push({
      fromLabel: previousLabel,
      toLabel: segment.label,
      state: [...state],
      previousPotential,
      nextPotential,
      jump: previousPotential === null ? null : nextPotential - previousPotential,
    });

    for (let step = 1; step <= segment.steps; step++) {
      const result = guardedTaskStep(state, segment.weights, {
        stepSize: options.stepSize,
        k0: options.k0,
        gain: options.gain,
        floor,
        maxBacktracks: options.maxBacktracks,
      });
      state = result.state;
      records.push({
        label: segment.label,
        weights: [...segment.weights] as MutableCRSVector,
        step,
        state: [...state],
        potential: result.nextPotential,
        accepted: result.accepted,
      });
    }
    previousWeights = segment.weights;
    previousLabel = segment.label;
  }

  return {
    initialState: [...initialState],
    finalState: [...state],
    records,
    switches,
  };
}
