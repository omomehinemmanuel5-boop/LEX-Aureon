/**
 * Deterministic parameterized experiment matrix for the research-only
 * task-sequence harness. No production router or runtime path is modified.
 */
import {
  runTaskSequenceExperiment,
  type TaskSequenceExperimentOptions,
  type TaskSequenceExperimentResult,
} from './aureonics_task_sequence_experiment';
import type { Pillar } from './aureonics_adaptive_basins';

export interface TaskSequenceMatrixCase {
  id: string;
  schedule: string;
  initialState: readonly [number, number, number];
  eta: number;
  challengeMagnitude: number;
  routerDwellSteps: number;
  labels: readonly Pillar[];
}

export interface TaskSequenceMatrixRow {
  id: string;
  schedule: string;
  initialState: readonly [number, number, number];
  eta: number;
  challengeMagnitude: number;
  result: TaskSequenceExperimentResult;
}

export interface TaskSequenceMatrixSummary {
  caseCount: number;
  meanProductionDistance: number;
  meanOracleDistance: number;
  meanHystereticDistance: number;
  meanProductionZVariation: number;
  meanOracleTaskVariation: number;
  meanHystereticTaskVariation: number;
  minimumCoordinateAcrossAllRuns: number;
  maximumSimplexResidualAcrossAllRuns: number;
}

export interface TaskSequenceMatrixResult {
  rows: TaskSequenceMatrixRow[];
  summary: TaskSequenceMatrixSummary;
}

const INITIAL_STATES: readonly (readonly [number, number, number])[] = [
  [1 / 3, 1 / 3, 1 / 3],
  [0.9, 0.05, 0.05],
  [0.05, 0.9, 0.05],
  [0.05, 0.05, 0.9],
  [0.05, 0.475, 0.475],
];
const GAINS = [0.002, 0.004, 0.008] as const;
const DISTURBANCES = [0.0005, 0.001, 0.005] as const;

function repeat<T>(items: readonly T[], count: number): T[] {
  return Array.from({ length: count }, () => [...items]).flat();
}

function schedules(): Array<{ name: string; labels: Pillar[] }> {
  return [
    { name: 'blocks-2', labels: repeat(['C', 'C', 'R', 'R', 'S', 'S'], 8) },
    { name: 'blocks-5', labels: repeat(['C', 'C', 'C', 'C', 'C', 'R', 'R', 'R', 'R', 'R', 'S', 'S', 'S', 'S', 'S'], 4) },
    { name: 'blocks-12', labels: repeat([...Array(12).fill('C'), ...Array(12).fill('R'), ...Array(12).fill('S')] as Pillar[], 2) },
    { name: 'fixed-amplitude-cycle', labels: repeat(['C', 'R', 'S'], 24) },
    { name: 'noisy-labels', labels: repeat(['C', 'C', 'R', 'C', 'C', 'R', 'R', 'S', 'S'], 8) },
    { name: 'abrupt-one-hot', labels: [...Array(24).fill('C'), ...Array(24).fill('R'), ...Array(24).fill('S')] as Pillar[] },
  ];
}

/** Build the full, deterministic Cartesian parameter matrix (270 cases). */
export function buildTaskSequenceExperimentMatrix(): TaskSequenceMatrixCase[] {
  const cases: TaskSequenceMatrixCase[] = [];
  for (const schedule of schedules()) {
    for (let initialIndex = 0; initialIndex < INITIAL_STATES.length; initialIndex++) {
      for (const eta of GAINS) {
        for (const challengeMagnitude of DISTURBANCES) {
          const initialState = INITIAL_STATES[initialIndex];
          cases.push({
            id: `${schedule.name}-x${initialIndex}-eta${eta}-d${challengeMagnitude}`,
            schedule: schedule.name,
            initialState,
            eta,
            challengeMagnitude,
            routerDwellSteps: 3,
            labels: schedule.labels,
          });
        }
      }
    }
  }
  return cases;
}

/** Execute all cases offline; every case sends identical inputs to all three controllers. */
export function runTaskSequenceExperimentMatrix(): TaskSequenceMatrixResult {
  const cases = buildTaskSequenceExperimentMatrix();
  const rows: TaskSequenceMatrixRow[] = cases.map((experimentCase) => {
    const options: TaskSequenceExperimentOptions = {
      initialState: [...experimentCase.initialState] as [number, number, number],
      eta: experimentCase.eta,
      challengeMagnitude: experimentCase.challengeMagnitude,
      routerDwellSteps: experimentCase.routerDwellSteps,
    };
    return {
      id: experimentCase.id,
      schedule: experimentCase.schedule,
      initialState: experimentCase.initialState,
      eta: experimentCase.eta,
      challengeMagnitude: experimentCase.challengeMagnitude,
      result: runTaskSequenceExperiment(experimentCase.labels, options),
    };
  });

  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const allMetrics = rows.flatMap(row => [
    row.result.productionZBaseline.metrics,
    row.result.oracleTaskPotential.metrics,
    row.result.hystereticTaskRouter.metrics,
  ]);
  return {
    rows,
    summary: {
      caseCount: rows.length,
      meanProductionDistance: mean(rows.map(row => row.result.productionZBaseline.metrics.meanDistanceToTrueTaskOptimum)),
      meanOracleDistance: mean(rows.map(row => row.result.oracleTaskPotential.metrics.meanDistanceToTrueTaskOptimum)),
      meanHystereticDistance: mean(rows.map(row => row.result.hystereticTaskRouter.metrics.meanDistanceToTrueTaskOptimum)),
      meanProductionZVariation: mean(rows.map(row => row.result.productionZBaseline.totalZVariation)),
      meanOracleTaskVariation: mean(rows.map(row => row.result.oracleTaskPotential.metrics.totalTaskWeightVariation)),
      meanHystereticTaskVariation: mean(rows.map(row => row.result.hystereticTaskRouter.metrics.totalTaskWeightVariation)),
      minimumCoordinateAcrossAllRuns: Math.min(...allMetrics.map(metric => metric.minimumObservedCoordinate)),
      maximumSimplexResidualAcrossAllRuns: Math.max(...allMetrics.map(metric => metric.maximumSimplexResidual)),
    },
  };
}
