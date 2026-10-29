import { describe, expect, it } from 'vitest';
import { nextSigmaViolation, SIGMA_ZERO_TOLERANCE } from '../lib/agents/sigma_decay';

describe('finite-time canonical sigma decay', () => {
  it('decays residual stress on a healthy observation', () => {
    expect(nextSigmaViolation(0.5, 0)).toBeCloseTo(0.45, 12);
  });

  it('snaps only a healthy residual at or below the explicit tolerance to exact zero', () => {
    expect(nextSigmaViolation(SIGMA_ZERO_TOLERANCE, 0)).toBe(0);
    expect(nextSigmaViolation(SIGMA_ZERO_TOLERANCE * 2, 0)).toBeGreaterThan(0);
  });

  it('reaches exact zero after a finite sequence of healthy observations', () => {
    let sigma = 1;
    let observations = 0;

    while (sigma !== 0 && observations < 1_000) {
      sigma = nextSigmaViolation(sigma, 0);
      observations += 1;
    }

    expect(sigma).toBe(0);
    expect(observations).toBeLessThan(1_000);
  });

  it('never rounds away a positive current-stress contribution', () => {
    const currentStress = 1e-8;
    const next = nextSigmaViolation(0, currentStress);

    expect(next).toBeGreaterThan(0);
    expect(next).toBe(currentStress / 10);
  });

  it('preserves active stress even when the accumulated result is below tolerance', () => {
    const currentStress = SIGMA_ZERO_TOLERANCE / 100;
    const next = nextSigmaViolation(0, currentStress);

    expect(next).toBeGreaterThan(0);
    expect(next).not.toBe(0);
  });

  it('does not normalize non-finite or negative accumulator state into a healthy zero', () => {
    expect(Number.isNaN(nextSigmaViolation(Number.NaN, 0))).toBe(true);
    expect(nextSigmaViolation(Number.POSITIVE_INFINITY, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(nextSigmaViolation(-0.1, 0)).toBeLessThan(0);
  });

  it('retains the configured rolling-window formula', () => {
    expect(nextSigmaViolation(0.2, 0.04, 20)).toBeCloseTo(0.2 * 0.95 + 0.04 / 20, 12);
  });
});
