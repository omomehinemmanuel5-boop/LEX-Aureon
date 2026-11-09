import { describe, expect, it } from 'vitest';
import { TAU } from '../lib/aureonics_core';
import {
  AUREONICS_HARD_FLOOR,
  assertSimplexState,
  classifyOperatingRegion,
  guardedTaskStep,
  projectToFloorSimplex,
  projectToSimplexTangent,
  taskConditionedDirection,
  taskPotential,
  taskPotentialGradient,
  taskTargetFromWeights,
} from '../lib/research/aureonics_adaptive_basins';

const EPS = 1e-9;

describe('Aureonics adaptive basin reference model (research-only)', () => {
  it('keeps its hard floor aligned with the production constant without importing production behavior', () => {
    expect(AUREONICS_HARD_FLOOR).toBe(TAU);
  });

  it('constructs all three interior directional target profiles', () => {
    const tauB = 0.08;
    expect(taskTargetFromWeights([1, 0, 0], tauB)).toEqual([0.84, 0.08, 0.08]);
    expect(taskTargetFromWeights([0, 1, 0], tauB)).toEqual([0.08, 0.84, 0.08]);
    expect(taskTargetFromWeights([0, 0, 1], tauB)).toEqual([0.08, 0.08, 0.84]);
  });

  it('maps uniform task preference to the centroid and preserves target mass', () => {
    const target = taskTargetFromWeights([1 / 3, 1 / 3, 1 / 3], 0.08);
    expect(target[0]).toBeCloseTo(1 / 3, 12);
    expect(target[1]).toBeCloseTo(1 / 3, 12);
    expect(target[2]).toBeCloseTo(1 / 3, 12);
    expect(target.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(Math.min(...target)).toBeGreaterThan(AUREONICS_HARD_FLOOR);
  });

  it('rejects target margins that collide with or fall below the hard floor', () => {
    expect(() => taskTargetFromWeights([1, 0, 0], TAU)).toThrow(/greater than the hard floor/);
    expect(() => taskTargetFromWeights([1, 0, 0], 0.04)).toThrow(/greater than the hard floor/);
    expect(() => taskTargetFromWeights([0.2, 0.2, 0.2], 0.08)).toThrow(/sum to one/);
  });

  it('partitions the state into neutral and three deterministic directional regions', () => {
    expect(classifyOperatingRegion([1 / 3, 1 / 3, 1 / 3], 0.01)).toBe('neutral');
    expect(classifyOperatingRegion([0.8, 0.1, 0.1], 0.01)).toBe('analytical');
    expect(classifyOperatingRegion([0.1, 0.8, 0.1], 0.01)).toBe('collaborative');
    expect(classifyOperatingRegion([0.1, 0.1, 0.8], 0.01)).toBe('exploratory');
    expect(classifyOperatingRegion([0.45, 0.45, 0.1], 0.01)).toBe('analytical');
  });

  it('projects finite inputs onto the floor-simplex without post-normalization floor loss', () => {
    const projected = projectToFloorSimplex([-2, 0.1, 0.2], TAU);
    expect(projected.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(Math.min(...projected)).toBeGreaterThanOrEqual(TAU - EPS);
    assertSimplexState(projected, TAU);
  });

  it('projects vectors into the simplex tangent space', () => {
    const tangent = projectToSimplexTangent([2, -1, 4]);
    expect(tangent.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 12);
  });

  it('has non-positive directional derivative for fixed task target', () => {
    const x: [number, number, number] = [0.55, 0.25, 0.2];
    const q = taskTargetFromWeights([1, 0, 0], 0.08);
    const gradient = taskPotentialGradient(x, q);
    const direction = taskConditionedDirection(x, q, 0.7);
    const derivative = gradient.reduce((sum, value, index) => sum + value * direction[index], 0);
    expect(derivative).toBeLessThanOrEqual(EPS);
    expect(direction.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 12);
  });

  it('accepts only fixed-target projected steps with non-increasing potential', () => {
    const x: [number, number, number] = [0.5, 0.3, 0.2];
    const q = taskTargetFromWeights([0, 1, 0], 0.08);
    const result = guardedTaskStep(x, q, { stepSize: 10, gain: 1, floor: TAU });
    expect(result.nextPotential).toBeLessThanOrEqual(result.previousPotential + 1e-12);
    expect(result.state.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(Math.min(...result.state)).toBeGreaterThanOrEqual(TAU - EPS);
  });

  it('returns the original state when no non-increasing step is accepted', () => {
    const x: [number, number, number] = [0.4, 0.3, 0.3];
    const q = taskTargetFromWeights([1 / 3, 1 / 3, 1 / 3], 0.08);
    const result = guardedTaskStep(x, q, { stepSize: 0.1 });
    expect(result.nextPotential).toBeLessThanOrEqual(result.previousPotential + 1e-12);
    expect(result.state.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
  });

  it('rejects non-simplex states and invalid task weights', () => {
    expect(() => assertSimplexState([0.2, 0.2, 0.2])).toThrow(/sum to one/);
    expect(() => taskTargetFromWeights([0.5, 0.5, 0.5], 0.08)).toThrow(/sum to one/);
    expect(() => taskTargetFromWeights([1, -0.1, 0.1], 0.08)).toThrow(/non-negative/);
  });
});
