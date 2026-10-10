import { describe, expect, it } from 'vitest';
import { adaptGovernanceState } from '../lib/lex_crs_agent/governance_state_adapter';

describe('governance state response adapter', () => {
  it('uses canonical state coordinates instead of measured-output metrics', () => {
    const result = adaptGovernanceState({
      state: { C: 0.333, R: 0.333, S: 0.334 },
      M: 0.333,
      metrics: { c_measured: 0, r_measured: 0.777, s_measured: 0 },
    });

    expect(result.C).toBeCloseTo(0.333, 3);
    expect(result.R).toBeCloseTo(0.333, 3);
    expect(result.S).toBeCloseTo(0.334, 3);
    expect(result.M).toBeCloseTo(0.333, 3);
    expect(result.stateInvariantValid).toBe(true);
  });

  it('derives M from C/R/S and flags a contradictory reported M', () => {
    const result = adaptGovernanceState({
      state: { C: 0.2, R: 0.5, S: 0.3 },
      M: 0.333,
    });

    expect(result.M).toBeCloseTo(0.2, 12);
    expect(result.reportedM).toBeCloseTo(0.333, 3);
    expect(result.stateInvariantValid).toBe(false);
  });
});
