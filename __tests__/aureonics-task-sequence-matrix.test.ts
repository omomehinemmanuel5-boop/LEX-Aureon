import { describe, expect, it } from 'vitest';
import {
  buildTaskSequenceExperimentMatrix,
  runTaskSequenceExperimentMatrix,
} from '../lib/research/aureonics_task_sequence_matrix';

describe('Aureonics parameterized task-sequence matrix', () => {
  it('builds a deterministic matrix spanning schedules, initial states, gains, and disturbances', () => {
    const first = buildTaskSequenceExperimentMatrix();
    const second = buildTaskSequenceExperimentMatrix();
    expect(first).toHaveLength(270);
    expect(first.map(item => item.id)).toEqual(second.map(item => item.id));
    expect(new Set(first.map(item => item.schedule))).toEqual(new Set([
      'blocks-2',
      'blocks-5',
      'blocks-12',
      'fixed-amplitude-cycle',
      'noisy-labels',
      'abrupt-one-hot',
    ]));
    expect(new Set(first.map(item => item.eta))).toEqual(new Set([0.002, 0.004, 0.008]));
    expect(new Set(first.map(item => item.challengeMagnitude))).toEqual(new Set([0.0005, 0.001, 0.005]));
  });

  it('executes all cases with common disturbances and preserves the floor/simplex invariants', () => {
    const result = runTaskSequenceExperimentMatrix();
    expect(result.rows).toHaveLength(270);
    expect(result.summary.caseCount).toBe(270);
    expect(Number.isFinite(result.summary.meanProductionDistance)).toBe(true);
    expect(Number.isFinite(result.summary.meanOracleDistance)).toBe(true);
    expect(Number.isFinite(result.summary.meanHystereticDistance)).toBe(true);
    expect(result.summary.minimumCoordinateAcrossAllRuns).toBeGreaterThanOrEqual(0.05 - 1e-9);
    expect(result.summary.maximumSimplexResidualAcrossAllRuns).toBeLessThan(1e-9);
    for (const row of result.rows) {
      expect(row.result.labels.length).toBeGreaterThan(0);
      expect(row.result.productionZBaseline.states).toHaveLength(row.result.labels.length);
      expect(row.result.oracleTaskPotential.states).toHaveLength(row.result.labels.length);
      expect(row.result.hystereticTaskRouter.states).toHaveLength(row.result.labels.length);
    }
  });
});
