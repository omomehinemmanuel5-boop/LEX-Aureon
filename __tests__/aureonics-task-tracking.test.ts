import { describe, expect, it } from 'vitest';
import {
  continuousTaskTrackingCertificate,
  taskTrackingErrorPotential,
  taskTrackingSwitchJumpBound,
} from '../lib/research/aureonics_task_tracking';

describe('Aureonics composite task-tracking storage', () => {
  it('is nonnegative and zero at the constrained task optimum', () => {
    const weights: [number, number, number] = [0.3, 0.4, 0.3];
    const optimum: [number, number, number] = [0.3, 0.4, 0.3];
    expect(taskTrackingErrorPotential(optimum, weights, 2)).toBeCloseTo(0, 12);
    expect(taskTrackingErrorPotential([0.5, 0.25, 0.25], weights, 2)).toBeGreaterThan(0);
  });

  it('returns the conditional continuous-drift ISS bound for interior task weights', () => {
    const certificate = continuousTaskTrackingCertificate(
      [0.45, 0.3, 0.25],
      [0.3, 0.4, 0.3],
      [0.01, -0.02, 0.01],
      { eta: 1, k0: 2 },
    );
    expect(certificate.minimumTaskWeight).toBe(0.3);
    expect(certificate.projectedGradientNorm).toBeGreaterThan(0);
    expect(certificate.decayLowerBound).toBeGreaterThan(0);
    expect(certificate.driftUpperBound).toBeGreaterThan(0);
    expect(certificate.derivativeUpperBound).toBeCloseTo(
      -certificate.decayLowerBound + certificate.driftUpperBound,
      12,
    );
    expect(certificate.trackingDistanceUpperBound).toBeGreaterThan(0);
    expect(certificate.projectedGradientNorm ** 2)
      .toBeGreaterThanOrEqual(2 * certificate.minimumTaskWeight * certificate.trackingPotential - 1e-10);
  });

  it('rejects boundary task weights because the uniform strong-convexity constant vanishes', () => {
    expect(() => continuousTaskTrackingCertificate(
      [1 / 3, 1 / 3, 1 / 3],
      [1, 0, 0],
      [0, 0, 0],
      { eta: 1, k0: 2 },
    )).toThrow(/strictly positive task weights/);
  });

  it('rejects a task-weight derivative that leaves the simplex tangent space', () => {
    expect(() => continuousTaskTrackingCertificate(
      [0.4, 0.3, 0.3],
      [0.3, 0.4, 0.3],
      [0.01, 0, 0],
      { eta: 1, k0: 2 },
    )).toThrow(/tangent to the weight simplex/);
  });

  it('bounds the additive tracking-storage jump at a task switch', () => {
    const before: [number, number, number] = [0.8, 0.1, 0.1];
    const after: [number, number, number] = [0.1, 0.8, 0.1];
    const delta: [number, number, number] = [-0.9, 0.8, 0.1];
    const jump = Math.abs(
      taskTrackingErrorPotential(before, after, 2)
      - taskTrackingErrorPotential(before, [1, 0, 0], 2),
    );
    expect(jump).toBeLessThanOrEqual(taskTrackingSwitchJumpBound(delta) + 1e-10);
  });

  it('rejects switch deltas that do not preserve total task weight', () => {
    expect(() => taskTrackingSwitchJumpBound([0.1, 0, 0])).toThrow(/preserve the weight simplex/);
  });
});
