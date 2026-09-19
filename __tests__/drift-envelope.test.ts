import { describe, expect, it } from 'vitest';
import { K, TAU, calculateZAwareGovernorG, gradVz } from '../lib/aureonics_core';

type Vec3 = [number, number, number];

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

function tangentProjection(a: Vec3): Vec3 {
  const mean = (a[0] + a[1] + a[2]) / 3;
  return [a[0] - mean, a[1] - mean, a[2] - mean];
}

function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

function stateGrid(): Vec3[] {
  const states: Vec3[] = [];
  for (let c = TAU; c <= 0.9; c += 0.07) {
    for (let r = TAU; r <= 0.9; r += 0.07) {
      const s = 1 - c - r;
      if (s >= TAU && s <= 1 - 2 * TAU) states.push([c, r, s]);
    }
  }
  states.push([1 / 3, 1 / 3, 1 / 3]);
  return states;
}

describe('scoped drift-envelope theorem', () => {
  it('makes the continuous-time derivative non-positive at the envelope boundary', () => {
    const weights: Vec3[] = [
      [1 / 3, 1 / 3, 1 / 3],
      [0.01, 0.09, 0.9],
      [0.2, 0.3, 0.5],
    ];

    for (const state of stateGrid()) {
      for (const z of weights) {
        const gradient = gradVz(state, z);
        const projectedGradient = tangentProjection(gradient);
        const projectedNorm = norm(projectedGradient);
        const drift: Vec3 = projectedNorm === 0
          ? [0, 0, 0]
          : scale(projectedGradient, K);
        const governor = calculateZAwareGovernorG(state, z);
        const derivative = dot(gradient, [
          governor[0] + drift[0],
          governor[1] + drift[1],
          governor[2] + drift[2],
        ]);

        expect(drift[0] + drift[1] + drift[2]).toBeCloseTo(0, 12);
        expect(derivative).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it('shows why no unrestricted nonzero tangent drift claim is valid at the symmetric point', () => {
    const state: Vec3 = [1 / 3, 1 / 3, 1 / 3];
    const z: Vec3 = [1 / 3, 1 / 3, 1 / 3];
    const gradient = gradVz(state, z);
    const projectedGradient = tangentProjection(gradient);
    const tangentDrift: Vec3 = [1, -1, 0];

    expect(norm(projectedGradient)).toBeCloseTo(0, 12);
    expect(dot(gradient, tangentDrift)).toBeCloseTo(0, 12);
    expect(norm(tangentDrift)).toBeGreaterThan(0);
  });
});
