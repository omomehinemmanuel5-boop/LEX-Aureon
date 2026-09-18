import { describe, expect, it } from 'vitest';
import { calculateGovernorG, calculateZAwareGovernorG, gradVz } from '../lib/aureonics_core';

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

describe('multi-pillar governor margin boundary', () => {
  it('documents why the legacy governor is unsafe for arbitrary session weights', () => {
    const state: [number, number, number] = [0.04981947, 0.7677895, 0.18239103];
    const weights: [number, number, number] = [0.00041077, 0.00388113, 0.99570810];
    const governor = calculateGovernorG(state);
    const directionalDerivative = dot(gradVz(state, weights), governor);
    expect(directionalDerivative).toBeGreaterThan(5);
  });

  it('makes the active z-weighted Lyapunov derivative non-positive', () => {
    const state: [number, number, number] = [0.04981947, 0.7677895, 0.18239103];
    const weights: [number, number, number] = [0.00041077, 0.00388113, 0.99570810];
    const governor = calculateZAwareGovernorG(state, weights);
    const directionalDerivative = dot(gradVz(state, weights), governor);
    expect(directionalDerivative).toBeLessThanOrEqual(0);
    expect(directionalDerivative).toBeCloseTo(-79.28, 1);
  });
});
