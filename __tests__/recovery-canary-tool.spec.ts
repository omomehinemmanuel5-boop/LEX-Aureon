import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readCanonicalGovernanceState } = vi.hoisted(() => ({ readCanonicalGovernanceState: vi.fn() }));

vi.mock('../lib/agents/canonical_governance_state', () => ({ readCanonicalGovernanceState }));

import { run_recovery_canary } from '../lib/lex_crs_agent/tools';

const sessionId = 'operator-canary-session';
const fingerprint = 'c'.repeat(64);

function canonical(stateFingerprint = fingerprint, overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    state: {
      sessionId,
      actorId: 'recovery-canary-probe',
      C: 1 / 3,
      R: 1 / 3,
      S: 1 / 3,
      M: 1 / 3,
      healthBand: 'OPTIMAL',
      recoveryState: 'RESTORING',
      sigmaViol: 0,
      toolCalls: 3,
      trajectoryAvailable: true,
      nStable: 3,
      canaryPassed: false,
      canaryReceiptId: null,
      stateFingerprint,
      trajectoryUpdatedAt: '2026-10-10T00:00:00.000Z',
      authorization: 'authorized',
      policyRisk: 'read',
      version: 'canonical-governance-2026-10-10.1',
      observedAt: '2026-10-10T00:00:00.000Z',
      ...overrides,
    },
  };
}

describe('operator recovery canary probe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires the recovery, stable-observation, and sigma thresholds before probing', async () => {
    readCanonicalGovernanceState.mockResolvedValueOnce(canonical(fingerprint, { nStable: 2 }));

    const result = JSON.parse(await run_recovery_canary({ session_id: sessionId }));

    expect(result.status).toBe('not_run');
    expect(result.reason).toContain('n_stable 2 < N_MIN');
    expect(readCanonicalGovernanceState).toHaveBeenCalledTimes(1);
  });

  it('passes only after the actual canonical diagnostic returns the same session and exact snapshot', async () => {
    readCanonicalGovernanceState
      .mockResolvedValueOnce(canonical())
      .mockResolvedValueOnce(canonical())
      .mockResolvedValueOnce(canonical());

    const result = JSON.parse(await run_recovery_canary({ session_id: sessionId }));

    expect(result).toMatchObject({
      status: 'passed',
      session_id: sessionId,
      probe_tool: 'get_constitutional_state',
      state_fingerprint: fingerprint,
      n_stable: 3,
      sigma_viol: 0,
    });
    expect(readCanonicalGovernanceState).toHaveBeenCalledTimes(3);
  });

  it('rejects a changed snapshot during the diagnostic instead of producing a pass', async () => {
    readCanonicalGovernanceState
      .mockResolvedValueOnce(canonical())
      .mockResolvedValueOnce(canonical('d'.repeat(64)));

    const result = JSON.parse(await run_recovery_canary({ session_id: sessionId }));

    expect(result.status).toBe('failed');
    expect(result.reason).toContain('exact canonical snapshot');
    expect(result.state_fingerprint).toBe(fingerprint);
    expect(readCanonicalGovernanceState).toHaveBeenCalledTimes(2);
  });

  it('does not run without a session identifier', async () => {
    const result = JSON.parse(await run_recovery_canary({}));
    expect(result.status).toBe('not_run');
    expect(readCanonicalGovernanceState).not.toHaveBeenCalled();
  });
});
