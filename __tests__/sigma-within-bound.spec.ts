import { describe, it, expect } from 'vitest';
import { sigmaWithinBound } from '../lib/agents/sigma_decay';

describe('sigmaWithinBound', () => {
  it('accepts only exact zero', () => {
    expect(sigmaWithinBound(0)).toBe(true);
    expect(sigmaWithinBound(-0)).toBe(true);
  });

  it('rejects every positive residual, including values below the former threshold', () => {
    for (const sigma of [Number.MIN_VALUE, 1e-12, 0.00176, 0.25, 1]) {
      expect(sigmaWithinBound(sigma)).toBe(false);
    }
  });

  it('rejects non-finite values', () => {
    expect(sigmaWithinBound(Number.NaN)).toBe(false);
    expect(sigmaWithinBound(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
