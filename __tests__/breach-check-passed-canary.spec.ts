import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/db', () => ({ getClient: () => ({ execute: async () => ({ rows: [], rowsAffected: 0 }) }) }));

import { recoveryBandBreachReason } from '../lib/agents/constitutional_tool_executor';

const healthy = {
  M: 0.333,
  sigmaViol: 0,
  velocity: 0,
  nStable: 0,
  canaryEvidenceId: null,
  canaryPassed: false,
} as never;

describe('breach check applies only to a currently passed canary', () => {
  it('does not block a healthy session with no canary', () => {
    expect(recoveryBandBreachReason(healthy)).toBeNull();
  });

  it('does not block on an old invalidated canary row (the stale-denial bug)', () => {
    const legacy = { ...healthy, canaryEvidenceId: 'old-canary-row', canaryPassed: false } as never;
    expect(recoveryBandBreachReason(legacy)).toBeNull();
  });

  it('still trips on a passed canary whose stability has dropped below N_MIN', () => {
    const passed = { ...healthy, canaryEvidenceId: 'canary-1', canaryPassed: true } as never;
    expect(recoveryBandBreachReason(passed)).toMatch(/n_stable=0 is below N_MIN=3/);
  });

  it('still trips on a passed canary when M falls below TAU_RECOVERY', () => {
    const passed = { ...healthy, M: 0.1, canaryEvidenceId: 'canary-1', canaryPassed: true, nStable: 3 } as never;
    expect(recoveryBandBreachReason(passed)).toMatch(/below TAU_RECOVERY/);
  });
});
