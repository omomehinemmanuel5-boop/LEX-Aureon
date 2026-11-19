import { describe, it, expect } from 'vitest';
import { sigmaWithinBound } from '../lib/agents/sigma_decay';
import { CONSTITUTION } from '../lib/constitution';

describe('sigmaWithinBound', () => {
  it('accepts zero and any value at or below SIGMA_THRESHOLD', () => {
    expect(sigmaWithinBound(0)).toBe(true);
    expect(sigmaWithinBound(0.00176)).toBe(true);
    expect(sigmaWithinBound(CONSTITUTION.SIGMA_THRESHOLD)).toBe(true);
  });

  it('rejects any value above SIGMA_THRESHOLD', () => {
    expect(sigmaWithinBound(CONSTITUTION.SIGMA_THRESHOLD + 1e-9)).toBe(false);
    expect(sigmaWithinBound(1)).toBe(false);
  });

  it('rejects non-finite values', () => {
    expect(sigmaWithinBound(Number.NaN)).toBe(false);
    expect(sigmaWithinBound(Number.POSITIVE_INFINITY)).toBe(false);
  });
});
