import { describe, expect, it } from 'vitest';
import { TAU } from '../lib/aureonics_core';
import { constitutionalTaskPotential } from '../lib/research/aureonics_adaptive_basins';
import { simulatePiecewiseConstantTaskSwitching } from '../lib/research/aureonics_task_switching';

describe('Aureonics switched-task research model', () => {
  it('keeps every fixed-task step non-increasing while exposing switch jumps', () => {
    const result = simulatePiecewiseConstantTaskSwitching(
      [1 / 3, 1 / 3, 1 / 3],
      [
        { label: 'analytical', weights: [1, 0, 0], steps: 20 },
        { label: 'collaborative', weights: [0, 1, 0], steps: 20 },
        { label: 'exploratory', weights: [0, 0, 1], steps: 20 },
      ],
      { stepSize: 0.2, k0: 2 },
    );

    expect(result.records).toHaveLength(60);
    for (let index = 1; index < result.records.length; index++) {
      const previous = result.records[index - 1];
      const current = result.records[index];
      if (current.label === previous.label) {
        expect(current.potential).toBeLessThanOrEqual(previous.potential + 1e-12);
      }
    }
    expect(result.switches[1].jump).not.toBeNull();
    expect(result.switches[2].jump).not.toBeNull();
    for (const record of result.records) {
      expect(record.state.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      expect(Math.min(...record.state)).toBeGreaterThanOrEqual(TAU - 1e-10);
    }
  });

  it('demonstrates that changing weights can increase the active potential at fixed state', () => {
    const state: [number, number, number] = [0.8, 0.1, 0.1];
    const analytical = constitutionalTaskPotential(state, [1, 0, 0], 2);
    const collaborative = constitutionalTaskPotential(state, [0, 1, 0], 2);
    expect(collaborative).toBeGreaterThan(analytical);

    const result = simulatePiecewiseConstantTaskSwitching(state, [
      { label: 'analytical', weights: [1, 0, 0], steps: 1 },
      { label: 'collaborative', weights: [0, 1, 0], steps: 1 },
    ], { stepSize: 0.01, k0: 2 });
    expect(result.switches[1].jump).toBeGreaterThan(0);
  });

  it('rejects empty schedules, invalid weights, and floor weakening', () => {
    expect(() => simulatePiecewiseConstantTaskSwitching(
      [1 / 3, 1 / 3, 1 / 3], [], { stepSize: 0.1, k0: 2 },
    )).toThrow(/at least one task segment/);
    expect(() => simulatePiecewiseConstantTaskSwitching(
      [1 / 3, 1 / 3, 1 / 3],
      [{ label: 'invalid', weights: [1, 1, 0], steps: 1 }],
      { stepSize: 0.1, k0: 2 },
    )).toThrow(/task weights must sum to one/);
    expect(() => simulatePiecewiseConstantTaskSwitching(
      [1 / 3, 1 / 3, 1 / 3],
      [{ label: 'analytical', weights: [1, 0, 0], steps: 1 }],
      { stepSize: 0.1, k0: 2, floor: 0.01 },
    )).toThrow(/cannot weaken the Aureonics hard floor/);
  });
});
