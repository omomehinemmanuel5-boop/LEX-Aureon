import { describe, expect, it } from 'vitest';
import {
  displayHealthBand,
  shouldRecordTrajectoryObservation,
} from '../lib/agents/constitutional_tool_executor';

describe('simulation trajectory isolation', () => {
  it('does not record a trajectory observation for simulate-mode run_governance', () => {
    expect(shouldRecordTrajectoryObservation('run_governance', { governance_mode: 'simulate' }, false)).toBe(false);
  });

  it('still records a trajectory observation for live run_governance', () => {
    expect(shouldRecordTrajectoryObservation('run_governance', { governance_mode: 'live' }, false)).toBe(true);
    expect(shouldRecordTrajectoryObservation('run_governance', {}, false)).toBe(true);
  });

  it('keeps non-mutating tools and cache hits out of the trajectory', () => {
    expect(shouldRecordTrajectoryObservation('read_file', {}, false)).toBe(false);
    expect(shouldRecordTrajectoryObservation('write_file', {}, true)).toBe(false);
    expect(shouldRecordTrajectoryObservation('write_file', {}, false)).toBe(true);
  });
});

describe('displayed health band matches the printed M', () => {
  it('labels M=0.229 as ALERT even when the kernel band says OPTIMAL', () => {
    expect(displayHealthBand({ health_band: 'OPTIMAL', crs: { M: 0.229 } })).toBe('ALERT');
  });

  it('labels M=0.333 as OPTIMAL', () => {
    expect(displayHealthBand({ health_band: 'OPTIMAL', crs: { M: 0.333 } })).toBe('OPTIMAL');
  });

  it('keeps the LOCKED state rather than deriving a band from M', () => {
    expect(displayHealthBand({ health_band: 'LOCKED', crs: { M: 0.3 } })).toBe('LOCKED');
  });
});
