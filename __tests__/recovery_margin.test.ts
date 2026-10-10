import { describe, expect, it } from 'vitest';
import { getRecoveryMinimumM } from '../lib/recovery_margin';

describe('recovery margin boundary', () => {
  it('uses 0.15 as the minimum when the saved state is healthy', () => {
    expect(getRecoveryMinimumM(0.333)).toBe(0.15);
  });

  it('preserves a below-threshold baseline without allowing further regression', () => {
    expect(getRecoveryMinimumM(0.12)).toBe(0.12);
  });

  it('does not invent a baseline when state has not been saved', () => {
    expect(getRecoveryMinimumM(null)).toBeNull();
  });
});
