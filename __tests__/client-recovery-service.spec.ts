import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readCanonicalGovernanceState, advanceRecoveryPlane } = vi.hoisted(() => ({
  readCanonicalGovernanceState: vi.fn(),
  advanceRecoveryPlane: vi.fn(),
}));

vi.mock('../lib/agents/canonical_governance_state', () => ({ readCanonicalGovernanceState }));
vi.mock('../lib/agents/recovery_runtime', () => ({ advanceRecoveryPlane }));

import { requestClientRecoveryPulse } from '../lib/agents/client_recovery_service';

function canonical(M: number, overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    state: {
      sessionId: 'owner:session',
      actorId: 'recovery-service',
      C: M, R: 0.4, S: 0.4, M,
      trajectoryAvailable: true,
      recoveryState: M < 0.15 ? 'RECOVERING' : 'NORMAL',
      nStable: 0,
      velocity: 0,
      sigmaViol: 0,
      canaryPassed: false,
      ...overrides,
    },
  };
}

describe('client recovery service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readCanonicalGovernanceState.mockResolvedValue(canonical(0.2));
    advanceRecoveryPlane.mockResolvedValue({
      advanced: true, stabilized: false, state: 'RESTORING', M: 0.2,
      nStable: 0, velocity: 0.1, reason: 'Bounded correction applied.',
    });
  });

  it('attempts exactly one bounded pulse and never grants write authority', async () => {
    const result = await requestClientRecoveryPulse('owner:session');
    expect(advanceRecoveryPlane).toHaveBeenCalledTimes(1);
    expect(advanceRecoveryPlane).toHaveBeenCalledWith('owner:session');
    expect(readCanonicalGovernanceState).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ status: 'ADVANCED', grants_write_authority: false, M: 0.2 });
  });

  it('refuses to mutate below the constitutional quarantine floor', async () => {
    readCanonicalGovernanceState.mockResolvedValueOnce(canonical(0.04));
    const result = await requestClientRecoveryPulse('owner:session');
    expect(result).toMatchObject({ status: 'BLOCKED', recovery_state: 'RECOVERING', grants_write_authority: false });
    expect(advanceRecoveryPlane).not.toHaveBeenCalled();
  });

  it('fails closed when canonical trajectory state is unavailable', async () => {
    readCanonicalGovernanceState.mockResolvedValueOnce({
      available: false,
      reason: 'database unavailable',
      state: { trajectoryAvailable: false, M: 0 },
    });
    const result = await requestClientRecoveryPulse('owner:session');
    expect(result).toMatchObject({ status: 'UNAVAILABLE', grants_write_authority: false });
    expect(advanceRecoveryPlane).not.toHaveBeenCalled();
  });

  it('rejects a missing authenticated session without reading or mutating state', async () => {
    const result = await requestClientRecoveryPulse('');
    expect(result).toMatchObject({ status: 'BLOCKED', grants_write_authority: false });
    expect(readCanonicalGovernanceState).not.toHaveBeenCalled();
    expect(advanceRecoveryPlane).not.toHaveBeenCalled();
  });
});
