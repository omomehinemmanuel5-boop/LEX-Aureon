import { describe, expect, it } from 'vitest';
import { getRecoveryBaselineState, getRecoveryMinimumM } from '../lib/recovery_margin';

describe('recovery margin boundary', () => {
  it('uses 0.15 as the minimum when the saved state is healthy', () => {
    expect(getRecoveryMinimumM(0.333)).toBe(0.15);
  });

  it('preserves a below-threshold baseline without allowing further regression', () => {
    expect(getRecoveryMinimumM(0.12)).toBe(0.12);
  });

  it('uses the runtime kernel state when no persisted session state exists', () => {
    const baseline = getRecoveryBaselineState(null, { C: 1 / 3, R: 1 / 3, S: 1 / 3 });
    expect(Math.min(baseline.C, baseline.R, baseline.S)).toBeCloseTo(1 / 3);
    expect(getRecoveryMinimumM(Math.min(baseline.C, baseline.R, baseline.S))).toBe(0.15);
  });

  it('prefers the persisted state when it exists', () => {
    const baseline = getRecoveryBaselineState(
      { C: 0.2, R: 0.4, S: 0.4 },
      { C: 1 / 3, R: 1 / 3, S: 1 / 3 },
    );
    expect(baseline).toEqual({ C: 0.2, R: 0.4, S: 0.4 });
    expect(getRecoveryMinimumM(Math.min(baseline.C, baseline.R, baseline.S))).toBe(0.15);
  });
});
