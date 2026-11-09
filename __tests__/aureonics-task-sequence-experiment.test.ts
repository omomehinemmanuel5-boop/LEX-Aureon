import { describe, expect, it } from 'vitest';
import { runTaskSequenceExperiment } from '../lib/research/aureonics_task_sequence_experiment';

describe('Aureonics task-sequence comparison harness', () => {
  const labels = ['C', 'C', 'C', 'R', 'R', 'R', 'S', 'S', 'S', 'C', 'C', 'C'] as const;

  it('replays the same workload labels through production-z, oracle, and routed references', () => {
    const result = runTaskSequenceExperiment(labels, { routerDwellSteps: 2 });
    expect(result.productionZBaseline.states).toHaveLength(labels.length);
    expect(result.productionZBaseline.zWeights).toHaveLength(labels.length);
    expect(result.oracleTaskPotential.states).toHaveLength(labels.length);
    expect(result.hystereticTaskRouter.states).toHaveLength(labels.length);
    expect(result.hystereticTaskRouter.routedLabels).toHaveLength(labels.length);
  });

  it('keeps every simulated state on the floor-constrained simplex', () => {
    const result = runTaskSequenceExperiment(labels);
    for (const controller of [
      result.productionZBaseline,
      result.oracleTaskPotential,
      result.hystereticTaskRouter,
    ]) {
      for (const state of controller.states) {
        expect(state.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10);
        expect(Math.min(...state)).toBeGreaterThanOrEqual(0.05 - 1e-10);
      }
      expect(controller.metrics.maximumSimplexResidual).toBeLessThan(1e-9);
      expect(controller.metrics.minimumObservedCoordinate).toBeGreaterThanOrEqual(0.05 - 1e-10);
    }
  });

  it('applies the declared dwell-time hysteresis to task changes', () => {
    const result = runTaskSequenceExperiment(labels, { routerDwellSteps: 2 });
    expect(result.hystereticTaskRouter.routedLabels.slice(0, 3)).toEqual(['C', 'C', 'C']);
    expect(result.hystereticTaskRouter.routedLabels[3]).toBe('C');
    expect(result.hystereticTaskRouter.routedLabels[4]).toBe('R');
    expect(result.hystereticTaskRouter.routedLabels[6]).toBe('R');
    expect(result.hystereticTaskRouter.routedLabels[7]).toBe('S');
  });

  it('keeps production memory weights distinct from task-router weights', () => {
    const result = runTaskSequenceExperiment(labels);
    expect(result.productionZBaseline.zWeights.every(
      z => z.every(value => value > 0) && Math.abs(z.reduce((sum, value) => sum + value, 0) - 1) < 1e-10,
    )).toBe(true);
    expect(result.productionZBaseline.totalZVariation).toBeGreaterThanOrEqual(0);
    expect(result.oracleTaskPotential.metrics.totalTaskWeightVariation).toBeGreaterThan(0);
    const noisyLabels = ['C', 'C', 'R', 'C', 'C', 'R', 'R', 'S', 'S'] as const;
    const noisy = runTaskSequenceExperiment(noisyLabels, { routerDwellSteps: 2 });
    expect(noisy.hystereticTaskRouter.metrics.taskSwitches)
      .toBeLessThan(noisy.oracleTaskPotential.metrics.taskSwitches);
  });

  it('rejects empty schedules and invalid router dwell settings', () => {
    expect(() => runTaskSequenceExperiment([])).toThrow(/non-empty/);
    expect(() => runTaskSequenceExperiment(labels, { routerDwellSteps: 0 })).toThrow(/positive integer/);
  });
});
