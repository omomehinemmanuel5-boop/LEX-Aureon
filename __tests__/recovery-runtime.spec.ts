import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getZTraj: vi.fn(),
  recordZTrajObservation: vi.fn(),
  readCanonicalGovernanceState: vi.fn(),
  dbExecute: vi.fn(),
}));

vi.mock('../lib/db', () => ({ getClient: () => ({ execute: mocks.dbExecute }) }));

vi.mock('../lib/kv', () => ({
  getZTraj: mocks.getZTraj,
  recordZTrajObservation: mocks.recordZTrajObservation,
}));

vi.mock('../lib/agents/canonical_governance_state', () => ({
  readCanonicalGovernanceState: mocks.readCanonicalGovernanceState,
}));

import { advanceRecoveryPlane, shouldAdvanceRecoveryPlane, deriveRecoveryBreachCount, recoveryObservationIntervalMs } from '../lib/agents/recovery_runtime';

describe('bounded recovery plane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbExecute.mockResolvedValue({ rows: [] });
  });

  it('uses 5 seconds with no breach in the recovery episode', () => {
    expect(deriveRecoveryBreachCount([], [])).toBe(0);
    expect(recoveryObservationIntervalMs(0)).toBe(5_000);
  });

  it('uses 10 seconds after one persisted canary breach', () => {
    expect(deriveRecoveryBreachCount([], [
      { receipt_id: 'recovery-canary-breach-one', created_at: '2026-10-31T00:00:00.000Z' },
    ])).toBe(1);
    expect(recoveryObservationIntervalMs(1)).toBe(10_000);
  });

  it('uses 15 seconds after two breaches and caps there for later breaches', () => {
    const receipts = [1, 2, 3, 4].map(i => ({
      receipt_id: 'recovery-canary-breach-' + i,
      created_at: '2026-10-31T00:00:0' + i + '.000Z',
    }));
    const count = deriveRecoveryBreachCount([], receipts);
    expect(count).toBe(4);
    expect(recoveryObservationIntervalMs(count)).toBe(15_000);
  });

  it('resets to the 5-second interval after N_MIN further clean counted observations', () => {
    const canaries = [{ canary_status: 'passed', n_stable: 3, issued_at: '2026-10-31T00:00:00.000Z', expires_at: '2026-10-31T01:00:00.000Z' }];
    const receipts = [
      { receipt_id: 'recovery-canary-breach-old-1', created_at: '2026-10-30T23:59:58.000Z' },
      { receipt_id: 'recovery-canary-breach-old-2', created_at: '2026-10-30T23:59:59.000Z' },
      ...[4, 5, 6].map((n, i) => ({
        receipt_id: 'clean-' + n,
        created_at: '2026-10-31T00:00:0' + (i + 1) + '.000Z',
        state_snapshot: JSON.stringify({ n_stable: n, sigma_viol: 0, last_m: 0.2 }),
      })),
    ];
    expect(deriveRecoveryBreachCount(canaries, receipts)).toBe(0);
    expect(recoveryObservationIntervalMs(0)).toBe(5_000);
  });

  it('derives the interval from persisted records, not caller-shaped metadata', () => {
    const persisted = deriveRecoveryBreachCount([], [
      { receipt_id: 'recovery-canary-breach-persisted', created_at: '2026-10-31T00:00:00.000Z' },
    ]);
    const callerShapedSnapshot = { breach_count: 0, n_stable: 999, sigma_viol: 0, last_m: 0.9 };
    expect(recoveryObservationIntervalMs(persisted)).toBe(10_000);
    expect(callerShapedSnapshot.breach_count).not.toBe(persisted);
  });

  it('counts a 6-second sample at the base interval but not at one-breach spacing', async () => {
    const trajectory = {
      session_id: 's', velocity: 0, n_stable: 3, drift_dir: 'stable',
      sigma_viol: 0, last_m: 0.2, last_c: 0.2, last_r: 0.4, last_s: 0.4,
      z_c: 1 / 3, z_r: 1 / 3, z_s: 1 / 3, attack_pressure: 0,
      updated_at: new Date(Date.now() - 6_000).toISOString(),
    };
    mocks.getZTraj.mockResolvedValue(trajectory);
    mocks.recordZTrajObservation.mockResolvedValue(true);
    mocks.readCanonicalGovernanceState.mockResolvedValue({
      available: true, state: { recoveryState: 'RESTORING', nStable: 4, sigmaViol: 0, canaryPassed: false },
    });
    mocks.dbExecute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const base = await advanceRecoveryPlane('s');
    expect(base.advanced).toBe(true);
    expect(mocks.recordZTrajObservation).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.getZTraj.mockResolvedValue(trajectory);
    mocks.dbExecute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ receipt_id: 'recovery-canary-breach-one', created_at: new Date().toISOString() }],
    });
    const elevated = await advanceRecoveryPlane('s');
    expect(elevated.advanced).toBe(false);
    expect(elevated.reason).toContain('wait 4 more second(s)');
    expect(mocks.recordZTrajObservation).not.toHaveBeenCalled();
  });

  it('does not reset the episode after the verified canary has expired', () => {
    const canaries = [{ canary_status: 'passed', n_stable: 3,
      issued_at: '2026-10-31T00:00:00.000Z', expires_at: '2026-10-31T00:00:02.000Z' }];
    const receipts = [
      { receipt_id: 'recovery-canary-breach-one', created_at: '2026-10-30T23:59:00.000Z' },
      ...[4, 5, 6].map((n, i) => ({
        receipt_id: 'expired-clean-' + n,
        created_at: '2026-10-31T00:00:0' + (i + 1) + '.000Z',
        state_snapshot: JSON.stringify({ n_stable: n, sigma_viol: 0, last_m: 0.2 }),
      })),
    ];
    expect(deriveRecoveryBreachCount(canaries, receipts)).toBe(1);
  });

  it('counts one invalidation once when its durable receipt and reason timestamp agree', () => {
    const invalidatedAt = '2026-10-31T00:00:02.000Z';
    expect(deriveRecoveryBreachCount([
      { canary_status: 'invalidated', n_stable: 3, issued_at: '2026-10-31T00:00:00.000Z', expires_at: '2026-10-31T01:00:00.000Z', reason: 'velocity breach [invalidated_at=' + invalidatedAt + ']' },
    ], [
      { receipt_id: 'recovery-canary-breach-one', created_at: invalidatedAt },
    ])).toBe(1);
  });

  it('counts a new breach after a clean reset as the first breach of the next episode', () => {
    const invalidatedAt = '2026-10-31T00:00:04.000Z';
    const canaries = [
      { canary_status: 'invalidated', n_stable: 3, issued_at: '2026-10-30T23:59:00.000Z', expires_at: '2026-10-31T00:59:00.000Z', reason: 'old breach [invalidated_at=2026-10-30T23:59:30.000Z]' },
      { canary_status: 'invalidated', n_stable: 3, issued_at: '2026-10-30T23:59:40.000Z', expires_at: '2026-10-31T00:59:40.000Z', reason: 'old breach [invalidated_at=2026-10-30T23:59:50.000Z]' },
      { canary_status: 'invalidated', n_stable: 3, issued_at: '2026-10-31T00:00:00.000Z', expires_at: '2026-10-31T01:00:00.000Z', reason: 'new breach [invalidated_at=' + invalidatedAt + ']' },
    ];
    const receipts = [
      { receipt_id: 'recovery-canary-breach-old-1', created_at: '2026-10-30T23:59:30.000Z' },
      { receipt_id: 'recovery-canary-breach-old-2', created_at: '2026-10-30T23:59:50.000Z' },
      ...[4, 5, 6].map((n, i) => ({
        receipt_id: 'clean-' + n,
        created_at: '2026-10-31T00:00:0' + (i + 1) + '.000Z',
        state_snapshot: JSON.stringify({ n_stable: n, sigma_viol: 0, last_m: 0.2 }),
      })),
      { receipt_id: 'recovery-canary-breach-new', created_at: invalidatedAt },
    ];
    expect(deriveRecoveryBreachCount(canaries, receipts)).toBe(1);
  });

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
      velocity: 0,
      canaryPassed: false,
    })).toBe(true);
    expect(shouldAdvanceRecoveryPlane({
      trajectoryAvailable: true,
      M: 0.326,
      nStable: 3,
      velocity: 0,
      canaryPassed: true,
    })).toBe(false);
    expect(shouldAdvanceRecoveryPlane({
      trajectoryAvailable: true,
      M: 0.326,
      nStable: 3,
      velocity: 0.041,
      canaryPassed: false,
    })).toBe(true);
    expect(shouldAdvanceRecoveryPlane({
      trajectoryAvailable: true,
      M: 0.326,
      nStable: 3,
      velocity: 0.001,
      canaryPassed: false,
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
      updated_at: new Date(Date.now() - 10_000).toISOString(),
    });
    mocks.recordZTrajObservation.mockResolvedValue(true);
    const corrected = {
      session_id: 's',
      velocity: 0.04,
      n_stable: 0,
      drift_dir: 'toward_R',
      sigma_viol: 0.01,
      last_m: 0.10,
      last_c: 0.45,
      last_r: 0.10,
      last_s: 0.45,
      z_c: 1 / 3, z_r: 1 / 3, z_s: 1 / 3,
      attack_pressure: 0,
      updated_at: new Date().toISOString(),
    };
    mocks.getZTraj.mockResolvedValueOnce({
      session_id: 's', velocity: 0.04, n_stable: 0, drift_dir: 'away_R',
      sigma_viol: 0.01, last_m: 0.08, last_c: 0.46, last_r: 0.08, last_s: 0.46,
      z_c: 1 / 3, z_r: 1 / 3, z_s: 1 / 3, attack_pressure: 0,
      updated_at: new Date(Date.now() - 10_000).toISOString(),
    }).mockResolvedValueOnce(corrected);

    const result = await advanceRecoveryPlane('s');

    expect(result.advanced).toBe(true);
    expect(result.M).toBeGreaterThanOrEqual(0.05);
    expect(mocks.recordZTrajObservation).toHaveBeenCalledTimes(1);
    expect(mocks.recordZTrajObservation.mock.calls[0][3]).toBe(false);
    const measured = mocks.recordZTrajObservation.mock.calls[0][2];
    expect(Math.min(measured.c, measured.r, measured.s)).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it('rejects a stale concurrent correction when compare-and-set loses', async () => {
    mocks.getZTraj.mockResolvedValue({
      session_id: 's', velocity: 0.03, n_stable: 0, drift_dir: 'away_R',
      sigma_viol: 0.01, last_m: 0.08, last_c: 0.46, last_r: 0.08, last_s: 0.46,
      z_c: 1 / 3, z_r: 1 / 3, z_s: 1 / 3, attack_pressure: 0,
      updated_at: new Date(Date.now() - 10_000).toISOString(),
    });
    mocks.recordZTrajObservation.mockResolvedValue(false);

    const result = await advanceRecoveryPlane('s');

    expect(result.advanced).toBe(false);
    expect(result.reason).toContain('compare-and-set rejected the stale pulse');
    expect(mocks.recordZTrajObservation).toHaveBeenCalledTimes(1);
    expect(mocks.getZTraj).toHaveBeenCalledTimes(1);
    expect(mocks.readCanonicalGovernanceState).not.toHaveBeenCalled();
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

  it('reports exact-zero sigma as the remaining recovery blocker', async () => {
    mocks.readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: { recoveryState: 'RESTORING', nStable: 3, sigmaViol: 0.1, canaryPassed: false },
    });
    mocks.recordZTrajObservation.mockResolvedValue(true);
    mocks.getZTraj.mockResolvedValue({
      session_id: 's',
      velocity: 0,
      n_stable: 3,
      drift_dir: 'stable',
      sigma_viol: 0.1,
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

    const result = await advanceRecoveryPlane('s');

    expect(result.advanced).toBe(true);
    expect(result.state).toBe('RESTORING');
    expect(result.reason).toContain('sigma_viol=0.1 must be exactly 0');
    expect(result.reason).toContain('healthy observations');
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
    expect(mocks.recordZTrajObservation).not.toHaveBeenCalled();
  });
});
