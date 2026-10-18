import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getZTraj: vi.fn(),
  updateZTraj: vi.fn(),
  recordZTrajObservation: vi.fn(),
  readCanonicalGovernanceState: vi.fn(),
}));

vi.mock('../lib/kv', () => ({
  getZTraj: mocks.getZTraj,
  updateZTraj: mocks.updateZTraj,
  recordZTrajObservation: mocks.recordZTrajObservation,
}));

vi.mock('../lib/agents/canonical_governance_state', () => ({
  readCanonicalGovernanceState: mocks.readCanonicalGovernanceState,
}));

import { advanceRecoveryPlane, shouldAdvanceRecoveryPlane } from '../lib/agents/recovery_runtime';

describe('bounded recovery plane', () => {
  it('allows the dedicated recovery capability while ordinary writes remain gated', async () => {
    const { recoveryCapabilityAllowed } = await import('../lib/agents/recovery_state');
    const evidence = { nStable: 0, sigmaViol: 0, canaryPassed: false };
    expect(recoveryCapabilityAllowed(0.22, 'recovery', evidence).allowed).toBe(true);
    expect(recoveryCapabilityAllowed(0.22, 'write', evidence).allowed).toBe(false);
    expect(recoveryCapabilityAllowed(0.04, 'recovery', evidence).allowed).toBe(false);
  });


  it('continues recovery when M is healthy but stability observations are missing', () => {
    expect(shouldAdvanceRecoveryPlane({
      trajectoryAvailable: true,
      M: 0.326,
      nStable: 0,
      canaryPassed: false,
    })).toBe(true);
    expect(shouldAdvanceRecoveryPlane({
      trajectoryAvailable: true,
      M: 0.326,
      nStable: 3,
      canaryPassed: true,
    })).toBe(false);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: { recoveryState: 'RESTORING', nStable: 3, sigmaViol: 0, canaryPassed: false },
    });
  });

  it('moves a degraded state toward recovery without breaching the 0.05 floor', async () => {
    mocks.getZTraj.mockResolvedValue({
      session_id: 's',
      velocity: 0.04,
      n_stable: 0,
      drift_dir: 'away_R',
      sigma_viol: 0.01,
      last_m: 0.08,
      last_c: 0.46,
      last_r: 0.08,
      last_s: 0.46,
      z_c: 1 / 3,
      z_r: 1 / 3,
      z_s: 1 / 3,
      attack_pressure: 0,
      updated_at: new Date().toISOString(),
    });
    mocks.updateZTraj.mockImplementation(async (_session, next) => ({
      session_id: 's',
      velocity: Math.sqrt(
        (next.c - 0.46) ** 2 +
        (next.r - 0.08) ** 2 +
        (next.s - 0.46) ** 2,
      ),
      n_stable: 0,
      drift_dir: 'toward_R',
      sigma_viol: 0.01,
      last_m: Math.min(next.c, next.r, next.s),
      last_c: next.c,
      last_r: next.r,
      last_s: next.s,
      z_c: 1 / 3,
      z_r: 1 / 3,
      z_s: 1 / 3,
      attack_pressure: 0,
      updated_at: new Date().toISOString(),
    }));

    const result = await advanceRecoveryPlane('s');

    expect(result.advanced).toBe(true);
    expect(result.M).toBeGreaterThanOrEqual(0.05);
    expect(mocks.updateZTraj).toHaveBeenCalledTimes(1);

    const [, next] = mocks.updateZTraj.mock.calls[0];
    expect(Math.min(next.c, next.r, next.s)).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it('counts stable no-op observations toward recovery once M reaches 0.15', async () => {
    mocks.recordZTrajObservation.mockResolvedValue(true);
    mocks.getZTraj.mockResolvedValue({
      session_id: 's',
      velocity: 0,
      n_stable: 2,
      drift_dir: 'stable',
      sigma_viol: 0,
      last_m: 0.20,
      last_c: 0.20,
      last_r: 0.40,
      last_s: 0.40,
      z_c: 1 / 3,
      z_r: 1 / 3,
      z_s: 1 / 3,
      attack_pressure: 0,
      updated_at: new Date(Date.now() - 10_000).toISOString(),
    });
    mocks.updateZTraj.mockResolvedValue({
      session_id: 's',
      velocity: 0,
      n_stable: 3,
      drift_dir: 'stable',
      sigma_viol: 0,
      last_m: 0.20,
      last_c: 0.20,
      last_r: 0.40,
      last_s: 0.40,
      z_c: 1 / 3,
      z_r: 1 / 3,
      z_s: 1 / 3,
      attack_pressure: 0,
      updated_at: new Date().toISOString(),
    });

    const result = await advanceRecoveryPlane('s');

    expect(result.advanced).toBe(true);
    expect(result.stabilized).toBe(true);
    expect(result.state).toBe('RESTORING');
    expect(result.reason).toContain('Stable recovery observation recorded');
    expect(result.nStable).toBe(3);
    expect(result.velocity).toBe(0);
    expect(mocks.recordZTrajObservation).toHaveBeenCalledTimes(1);
    expect(mocks.recordZTrajObservation.mock.calls[0][3]).toBe(true);
  });

  it('does not count a stationary sample as stable when the preceding velocity was high', async () => {
    mocks.readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: { recoveryState: 'RESTORING', nStable: 0, sigmaViol: 0, canaryPassed: false },
    });
    mocks.getZTraj.mockResolvedValue({
      session_id: 's',
      velocity: 0.08,
      n_stable: 0,
      drift_dir: 'toward_R',
      sigma_viol: 0,
      last_m: 0.20,
      last_c: 0.20,
      last_r: 0.40,
      last_s: 0.40,
      z_c: 1 / 3,
      z_r: 1 / 3,
      z_s: 1 / 3,
      attack_pressure: 0,
      updated_at: new Date(Date.now() - 10_000).toISOString(),
    });
    mocks.updateZTraj.mockResolvedValue({
      session_id: 's',
      velocity: 0,
      n_stable: 0,
      drift_dir: 'stable',
      sigma_viol: 0,
      last_m: 0.20,
      last_c: 0.20,
      last_r: 0.40,
      last_s: 0.40,
      z_c: 1 / 3,
      z_r: 1 / 3,
      z_s: 1 / 3,
      attack_pressure: 0,
      updated_at: new Date().toISOString(),
    });

    mocks.recordZTrajObservation.mockResolvedValue(true);
    const result = await advanceRecoveryPlane('s');

    expect(result.advanced).toBe(true);
    expect(result.nStable).toBe(0);
    expect(result.reason).toContain('prior velocity');
    expect(mocks.recordZTrajObservation).toHaveBeenCalledTimes(1);
    expect(mocks.recordZTrajObservation.mock.calls[0][3]).toBe(false);
  });

  it('does not count repeated recovery pulses inside the observation interval', async () => {
    mocks.getZTraj.mockResolvedValue({
      session_id: 's',
      velocity: 0,
      n_stable: 1,
      drift_dir: 'stable',
      sigma_viol: 0,
      last_m: 0.20,
      last_c: 0.20,
      last_r: 0.40,
      last_s: 0.40,
      z_c: 1 / 3,
      z_r: 1 / 3,
      z_s: 1 / 3,
      attack_pressure: 0,
      updated_at: new Date().toISOString(),
    });

    const result = await advanceRecoveryPlane('s');

    expect(result.advanced).toBe(false);
    expect(result.reason).toContain('interval has not elapsed');
    expect(mocks.recordZTrajObservation).not.toHaveBeenCalled();
  });

  it('does not mutate quarantined states below the hard floor', async () => {
    mocks.getZTraj.mockResolvedValue({
      session_id: 's',
      velocity: 0.2,
      n_stable: 0,
      drift_dir: 'away_R',
      sigma_viol: 0.1,
      last_m: 0.04,
      last_c: 0.48,
      last_r: 0.04,
      last_s: 0.48,
      z_c: 1 / 3,
      z_r: 1 / 3,
      z_s: 1 / 3,
      attack_pressure: 0.5,
      updated_at: new Date().toISOString(),
    });

    const result = await advanceRecoveryPlane('s');

    expect(result.advanced).toBe(false);
    expect(result.state).toBe('QUARANTINED');
    expect(mocks.updateZTraj).not.toHaveBeenCalled();
  });
});
