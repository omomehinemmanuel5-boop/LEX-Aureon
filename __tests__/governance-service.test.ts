import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isEvalSession, advanceRecoveryAfterGovernanceDecision } from '@/lib/governance_service';

const recoveryMocks = vi.hoisted(() => ({
  advanceRecoveryPlane: vi.fn(),
  shouldAdvanceRecoveryPlane: vi.fn(),
  readCanonicalGovernanceState: vi.fn(),
}));

vi.mock('../lib/agents/recovery_runtime', () => ({
  advanceRecoveryPlane: recoveryMocks.advanceRecoveryPlane,
  shouldAdvanceRecoveryPlane: recoveryMocks.shouldAdvanceRecoveryPlane,
}));

vi.mock('../lib/agents/canonical_governance_state', () => ({
  readCanonicalGovernanceState: recoveryMocks.readCanonicalGovernanceState,
}));

describe('governance service recovery pulse ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recoveryMocks.shouldAdvanceRecoveryPlane.mockReturnValue(true);
    recoveryMocks.readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: {
        trajectoryAvailable: true,
        M: 0.2,
        nStable: 0,
        velocity: 0,
        canaryPassed: false,
      },
    });
    recoveryMocks.advanceRecoveryPlane.mockResolvedValue({
      advanced: true,
      stabilized: false,
      state: 'RESTORING',
      M: 0.2,
      nStable: 1,
      velocity: 0,
      reason: 'test pulse',
    });
  });

  it('does not read or advance recovery for a refused governance decision', async () => {
    const result = await advanceRecoveryAfterGovernanceDecision(
      'governance-session',
      'owner-1',
      { refused: true },
    );

    expect(result).toBeNull();
    expect(recoveryMocks.readCanonicalGovernanceState).not.toHaveBeenCalled();
    expect(recoveryMocks.shouldAdvanceRecoveryPlane).not.toHaveBeenCalled();
    expect(recoveryMocks.advanceRecoveryPlane).not.toHaveBeenCalled();
  });

  it('advances exactly once for an executed decision, after canonical eligibility is checked', async () => {
    const result = await advanceRecoveryAfterGovernanceDecision(
      'governance-session',
      'owner-1',
      { refused: false },
    );

    expect(recoveryMocks.readCanonicalGovernanceState).toHaveBeenCalledWith({
      sessionId: 'governance-session',
      actorId: 'api_key:owner-1',
      capability: 'read',
    });
    expect(recoveryMocks.shouldAdvanceRecoveryPlane).toHaveBeenCalledWith({
      trajectoryAvailable: true,
      M: 0.2,
      nStable: 0,
      velocity: 0,
      canaryPassed: false,
    });
    expect(recoveryMocks.advanceRecoveryPlane).toHaveBeenCalledTimes(1);
    expect(recoveryMocks.advanceRecoveryPlane).toHaveBeenCalledWith('governance-session');
    expect(result?.advanced).toBe(true);
    expect(recoveryMocks.readCanonicalGovernanceState.mock.invocationCallOrder[0])
      .toBeLessThan(recoveryMocks.advanceRecoveryPlane.mock.invocationCallOrder[0]);
  });
});

describe('governance service evaluation-session classification', () => {
  it.each([
    'lexbench-run-1',
    'synthetic_session_42',
    'bench-release-2026',
    'jbb_attack_1',
    'adv_prompt_7',
    'hb_case_9',
  ])('recognizes %s as evaluation traffic', (sessionId) => {
    expect(isEvalSession(sessionId)).toBe(true);
  });

  it.each(['session-1', 'user-demo', 'production-chat', 'benchmark'])(
    'does not classify %s as evaluation traffic',
    (sessionId) => {
      expect(isEvalSession(sessionId)).toBe(false);
    },
  );
});
