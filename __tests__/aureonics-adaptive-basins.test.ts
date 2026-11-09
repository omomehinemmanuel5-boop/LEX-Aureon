import { describe, expect, it } from 'vitest';
import { TAU } from '../lib/aureonics_core';
import {
  AUREONICS_HARD_FLOOR,
  assertFloorSimplexState,
  basinProfileForPillar,
  basinSensitiveStiffness,
  basinStiffnessCorrection,
  classifyOperatingRegion,
  constitutionalTaskPotential,
  constitutionalTaskPotentialGradient,
  guardedTaskStep,
  projectToFloorSimplex,
  projectToSimplexTangent,
  taskConditionedDirection,
  taskUtility,
} from '../lib/research/aureonics_adaptive_basins';

const EPS = 1e-9;

describe('Aureonics v4 adaptive basin reference model (research-only)', () => {
  it('keeps the research hard floor aligned with the production constant', () => {
    expect(AUREONICS_HARD_FLOOR).toBe(TAU);
  });

  it('reproduces the three v4 boundary-limit profiles', () => {
    const analytical = basinProfileForPillar('C');
    const collaborative = basinProfileForPillar('R');
    const exploratory = basinProfileForPillar('S');
    expect(analytical).toEqual([0.9, 0.05, 0.05]);
    expect(collaborative).toEqual([0.05, 0.9, 0.05]);
    expect(exploratory).toEqual([0.05, 0.05, 0.9]);
    for (const profile of [analytical, collaborative, exploratory]) {
      expect(profile.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
      expect(Math.min(...profile)).toBeCloseTo(TAU, 12);
    }
  });

  it('makes the strict-interior profile an explicit margin extension', () => {
    const profile = basinProfileForPillar('C', TAU, 0.01);
    expect(profile).toEqual([0.88, 0.06, 0.06]);
    expect(Math.min(...profile)).toBeGreaterThan(TAU);
    expect(() => basinProfileForPillar('S', TAU, 0.3)).toThrow(/less than 1\/3/);
  });

  it('partitions neutral, strict directional regions, and the tau boundary distinctly', () => {
    expect(classifyOperatingRegion([1 / 3, 1 / 3, 1 / 3], 0.01)).toBe('neutral');
    expect(classifyOperatingRegion([0.8, 0.1, 0.1], 0.01)).toBe('analytical');
    expect(classifyOperatingRegion([0.1, 0.8, 0.1], 0.01)).toBe('collaborative');
    expect(classifyOperatingRegion([0.1, 0.1, 0.8], 0.01)).toBe('exploratory');
    expect(classifyOperatingRegion([0.9, 0.05, 0.05], 0.01)).toBe('boundary');
    expect(classifyOperatingRegion([0.45, 0.45, 0.1], 0.01)).toBe('analytical');
  });

  it('allows boundary simplex states in utility and region diagnostics', () => {
    expect(taskUtility([1, 0, 0], [1, 0, 0], 2)).toBeCloseTo(1 - 2 * TAU ** 2, 12);
    expect(classifyOperatingRegion([1, 0, 0], 0.01)).toBe('boundary');
    expect(basinSensitiveStiffness([1, 0, 0], [1, 0, 0], 2, 0.01)).toEqual([200, 0, 0]);
  });

  it('implements the task utility in v4 Equation (18)', () => {
    const x: [number, number, number] = [0.6, 0.25, 0.15];
    expect(taskUtility(x, [1, 0, 0], 2)).toBeCloseTo(0.6, 12);
    const breached: [number, number, number] = [0.93, 0.04, 0.03];
    expect(taskUtility(breached, [1, 0, 0], 2)).toBeCloseTo(0.93 - 2 * 0.02 ** 2, 12);
  });

  it('implements v4 Equation (20) and its exact gradient', () => {
    const x: [number, number, number] = [0.6, 0.25, 0.15];
    const weights: [number, number, number] = [0.5, 0.3, 0.2];
    const expected = -(0.5 * Math.log(0.6) + 0.3 * Math.log(0.25) + 0.2 * Math.log(0.15));
    expect(constitutionalTaskPotential(x, weights, 2)).toBeCloseTo(expected, 12);
    expect(constitutionalTaskPotentialGradient(x, weights, 2)).toEqual([
      -0.5 / 0.6,
      -0.3 / 0.25,
      -0.2 / 0.15,
    ]);
  });

  it('produces a zero-sum negative projected-gradient direction with non-positive fixed-task derivative', () => {
    const x: [number, number, number] = [0.55, 0.25, 0.2];
    const weights: [number, number, number] = [0.7, 0.2, 0.1];
    const gradient = constitutionalTaskPotentialGradient(x, weights, 1.5);
    const direction = taskConditionedDirection(x, weights, 1.5, 0.7);
    const derivative = gradient.reduce((sum, value, index) => sum + value * direction[index], 0);
    expect(derivative).toBeLessThanOrEqual(EPS);
    expect(direction.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 12);
  });

  it('computes the v4 basin-sensitive stiffness formula', () => {
    const x: [number, number, number] = [0.4, 0.35, 0.25];
    const weights: [number, number, number] = [0.6, 0.3, 0.1];
    expect(basinSensitiveStiffness(x, weights, 2, 0.05)).toEqual([
      2 * 0.6 / 0.3,
      2 * 0.3 / 0.3,
      2 * 0.1 / 0.3,
    ]);
  });

  it('exposes the mass drift in the manuscript stiffness equation and a separate tangent-projected candidate', () => {
    const x: [number, number, number] = [0.04, 0.3, 0.66];
    const weights: [number, number, number] = [0.1, 0.6, 0.3];
    const result = basinStiffnessCorrection(x, weights, 1, 0.01);
    expect(Math.abs(result.rawMassDrift)).toBeGreaterThan(EPS);
    expect(result.projected.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 12);
    expect(result.raw).not.toEqual(result.projected);
  });

  it('projects finite inputs onto the hard-floor simplex', () => {
    const projected = projectToFloorSimplex([-2, 0.1, 0.2], TAU);
    expect(projected.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(Math.min(...projected)).toBeGreaterThanOrEqual(TAU - EPS);
    assertFloorSimplexState(projected, TAU);
  });

  it('accepts only fixed-task projected steps with non-increasing potential', () => {
    const x: [number, number, number] = [0.5, 0.3, 0.2];
    const weights: [number, number, number] = [0.1, 0.8, 0.1];
    const result = guardedTaskStep(x, weights, { stepSize: 10, k0: 2, gain: 1, floor: TAU });
    expect(result.nextPotential).toBeLessThanOrEqual(result.previousPotential + 1e-12);
    expect(result.state.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(Math.min(...result.state)).toBeGreaterThanOrEqual(TAU - EPS);
  });

  it('leaves a stationary centroid unchanged', () => {
    const x: [number, number, number] = [1 / 3, 1 / 3, 1 / 3];
    const weights: [number, number, number] = [1 / 3, 1 / 3, 1 / 3];
    const result = guardedTaskStep(x, weights, { stepSize: 0.1, k0: 2 });
    expect(result.accepted).toBe(false);
    expect(result.state).toEqual(x);
    expect(result.nextPotential).toBeLessThanOrEqual(result.previousPotential + 1e-12);
  });

  it('does not allow reference steps to weaken the hard floor', () => {
    const x: [number, number, number] = [0.4, 0.3, 0.3];
    expect(() => guardedTaskStep(x, [1, 0, 0], { stepSize: 0.01, k0: 2, floor: 0.01 })).toThrow(/cannot weaken the Aureonics hard floor/);
  });
});
