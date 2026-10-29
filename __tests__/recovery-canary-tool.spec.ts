import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readCanonicalGovernanceState } = vi.hoisted(() => ({ readCanonicalGovernanceState: vi.fn() }));

vi.mock('../lib/agents/canonical_governance_state', () => ({ readCanonicalGovernanceState }));

import { get_constitutional_state, run_recovery_canary } from '../lib/lex_crs_agent/tools';

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
      velocity: 0.001,
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

  it('returns the exact canonical gate snapshot consistently across five diagnostic reads', async () => {
    readCanonicalGovernanceState.mockImplementation(async () => canonical());

    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(JSON.parse(await get_constitutional_state({ session_id: sessionId })));
    }

    expect(results.map(result => result.state_fingerprint)).toEqual(Array(5).fill(fingerprint));
    expect(results.map(result => result.n_stable)).toEqual([3, 3, 3, 3, 3]);
    for (const result of results) {
      expect(result).toMatchObject({
        n_stable_required: 3,
        velocity: 0.001,
        stability_threshold: 0.02,
        canary_passed: false,
        gate_snapshot: {
          C: 1 / 3, R: 1 / 3, S: 1 / 3, M: 1 / 3,
          health_band: 'OPTIMAL',
          recovery_state: 'RESTORING',
          state_version: 'canonical-governance-2026-10-10.1',
          authorization: 'authorized',
          policy_risk: 'read',
          trajectory_available: true,
          n_stable: 3,
          n_stable_required: 3,
          velocity: 0.001,
          stability_threshold: 0.02,
          canary_passed: false,
          state_fingerprint: fingerprint,
        },
      });
      expect(result.gate_snapshot.C).toBe(result.C);
      expect(result.gate_snapshot.R).toBe(result.R);
      expect(result.gate_snapshot.S).toBe(result.S);
      expect(result.gate_snapshot.M).toBe(result.M);
      expect(result.gate_snapshot.state_fingerprint).toBe(result.state_fingerprint);
    }
    expect(readCanonicalGovernanceState).toHaveBeenCalledTimes(5);
  });

  it('requires the recovery, stable-observation, and sigma thresholds before probing', async () => {
    readCanonicalGovernanceState.mockResolvedValueOnce(canonical(fingerprint, { nStable: 2 }));

    const result = JSON.parse(await run_recovery_canary({ session_id: sessionId }));

    expect(result.status).toBe('not_run');
    expect(result.reason).toContain('n_stable 2 < N_MIN');
    expect(readCanonicalGovernanceState).toHaveBeenCalledTimes(1);
  });

  it('blocks canary preflight when sigma is positive but below the old threshold', async () => {
    readCanonicalGovernanceState.mockResolvedValueOnce(canonical(fingerprint, { sigmaViol: 0.1 }));

    const result = JSON.parse(await run_recovery_canary({ session_id: sessionId }));

    expect(result.status).toBe('not_run');
    expect(result.reason).toContain('sigma_viol 0.1 !== 0');
    expect(result.reason).toContain('exact zero required');
    expect(readCanonicalGovernanceState).toHaveBeenCalledTimes(1);
  });

  it('reports exact-zero sigma as the next step before canary verification', async () => {
    readCanonicalGovernanceState.mockResolvedValueOnce(canonical(fingerprint, {
      sigmaViol: 0.1,
      nStable: 3,
    }));

    const result = JSON.parse(await get_constitutional_state({ session_id: sessionId }));

    expect(result.next_step).toContain('sigma_viol must be exactly 0');
    expect(result.next_step).toContain('decays to zero');
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
