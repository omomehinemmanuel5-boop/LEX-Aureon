import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbExecute, getZTraj, readCanary } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  getZTraj: vi.fn(),
  readCanary: vi.fn(),
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: dbExecute }),
}));

vi.mock('../lib/kv', () => ({
  deriveHealthBand: (m: number) => m >= 0.25 ? 'OPTIMAL' : m >= 0.15 ? 'ALERT' : m >= 0.05 ? 'STRESSED' : 'CRITICAL',
  getZTraj,
}));

vi.mock('../lib/constitution', () => ({
  CONSTITUTION: { TAU_FLOOR: 0.05, TAU_RECOVERY: 0.15, N_MIN: 3 },
}));

vi.mock('../lib/agents/recovery_state', () => ({
  recoveryCapabilityAllowed: vi.fn(() => ({ allowed: true, state: 'NORMAL' })),
}));

vi.mock('../lib/agents/recovery_canary_evidence', () => ({
  readRecoveryCanaryEvidence: readCanary,
  recoverySnapshotFingerprint: vi.fn(() => 'f'.repeat(64)),
}));

import {
  ensureCanonicalTrajectoryState,
  readCanonicalGovernanceState,
} from '../lib/agents/canonical_governance_state';

const uniformTrajectory = {
  session_id: 'session-regression',
  velocity: 0,
  n_stable: 0,
  drift_dir: 'bootstrap',
  sigma_viol: 0,
  last_m: 1 / 3,
  last_c: 1 / 3,
  last_r: 1 / 3,
  last_s: 1 / 3,
  z_c: 1 / 3,
  z_r: 1 / 3,
  z_s: 1 / 3,
  attack_pressure: 0,
  updated_at: '2026-10-26T00:00:00.000Z',
};

describe('canonical governance state regression after #181', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbExecute.mockResolvedValue({ rows: [{ session_id: 'session-regression' }] });
    getZTraj.mockResolvedValue({ ...uniformTrajectory });
    readCanary.mockResolvedValue({ passed: false, receiptId: null, status: null, evidenceId: null });
  });

  it('bootstraps new sessions uniformly at 1/3 and reports first-state M as 1/3', async () => {
    await expect(ensureCanonicalTrajectoryState('session-regression')).resolves.toMatchObject({
      status: 'created', sessionId: 'session-regression', verified: true,
    });

    const insert = dbExecute.mock.calls[0][0] as { sql: string; args: unknown[] };
    expect(insert.sql).toContain('INSERT INTO z_traj');
    expect(insert.args.slice(1, 8)).toEqual([
      1 / 3, 1 / 3, 1 / 3, 1 / 3,
      1 / 3, 1 / 3, 1 / 3,
    ]);

    const read = await readCanonicalGovernanceState({
      sessionId: 'session-regression',
      actorId: 'test-actor',
      capability: 'read',
    });
    expect(read.state.C).toBe(1 / 3);
    expect(read.state.R).toBe(1 / 3);
    expect(read.state.S).toBe(1 / 3);
    expect(read.state.M).toBe(1 / 3);
  });

  it('classifies an existing row without changing its trajectory history', async () => {
    const existing = { ...uniformTrajectory, n_stable: 2, sigma_viol: 0.12, updated_at: '2026-10-27T00:00:00.000Z' };
    dbExecute.mockResolvedValueOnce({ rows: [] });
    getZTraj.mockResolvedValueOnce(existing);

    await expect(ensureCanonicalTrajectoryState('session-regression')).resolves.toMatchObject({
      status: 'existing', sessionId: 'session-regression', verified: true,
    });
    expect(existing).toEqual({
      ...uniformTrajectory, n_stable: 2, sigma_viol: 0.12, updated_at: '2026-10-27T00:00:00.000Z',
    });
    expect(getZTraj).toHaveBeenCalledWith('session-regression');
  });

  it('returns unverified when the inserted row cannot be read back', async () => {
    getZTraj.mockResolvedValueOnce(null);
    await expect(ensureCanonicalTrajectoryState('session-regression')).resolves.toMatchObject({
      status: 'unverified', sessionId: 'session-regression', verified: false,
    });
  });

  it('returns unverified when bootstrap storage fails', async () => {
    dbExecute.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(ensureCanonicalTrajectoryState('session-regression')).resolves.toMatchObject({
      status: 'unverified', sessionId: 'session-regression', verified: false,
    });
    expect(getZTraj).not.toHaveBeenCalled();
  });

  it('rejects a read-back row with a mismatched session identity', async () => {
    getZTraj.mockResolvedValueOnce({ ...uniformTrajectory, session_id: 'another-session' });
    await expect(ensureCanonicalTrajectoryState('session-regression')).resolves.toMatchObject({
      status: 'unverified', sessionId: 'session-regression', verified: false,
    });
  });

  it('preserves canaryEvidenceId in canonical state for breach invalidation', async () => {
    readCanary.mockResolvedValue({
      passed: true,
      receiptId: 'canary-receipt-123',
      status: 'passed',
      evidenceId: 123,
    });

    const read = await readCanonicalGovernanceState({
      sessionId: 'session-regression',
      actorId: 'test-actor',
      capability: 'write',
    });

    expect(read.state.canaryEvidenceId).toBe(123);
  });

  it('passes sessionId to the recovery canary evidence reader', async () => {
    await readCanonicalGovernanceState({
      sessionId: 'session-regression',
      actorId: 'test-actor',
      capability: 'read',
    });

    expect(readCanary).toHaveBeenCalledWith(
      'session-regression',
      'f'.repeat(64),
      expect.objectContaining({
        sessionId: 'session-regression',
        stateVersion: 'canonical-governance-2026-10-10.1',
        stateFingerprint: 'f'.repeat(64),
      }),
    );
  });
});
