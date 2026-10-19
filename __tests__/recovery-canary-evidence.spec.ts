import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: dbExecute }),
}));

import {
  readRecoveryCanaryEvidence,
  recordRecoveryCanaryEvidence,
  recoverySnapshotFingerprint,
} from '../lib/agents/recovery_canary_evidence';

const snapshot = {
  sessionId: 'operator-session-a',
  policyVersion: 'canonical-governance-test.1',
  C: 1 / 3,
  R: 1 / 3,
  S: 1 / 3,
  nStable: 3,
  sigmaViol: 0,
  trajectoryUpdatedAt: '2026-10-10T00:00:00.000Z',
};

describe('exact-snapshot recovery canary evidence', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fingerprints only governance state, not observation timestamps or receipt metadata', () => {
    const original = recoverySnapshotFingerprint(snapshot);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    expect(recoverySnapshotFingerprint({ ...snapshot, sessionId: 'operator-session-b' })).not.toBe(original);
    expect(recoverySnapshotFingerprint({ ...snapshot, R: 0.32 })).not.toBe(original);
    expect(recoverySnapshotFingerprint({ ...snapshot, nStable: 4 })).not.toBe(original);
    expect(recoverySnapshotFingerprint({ ...snapshot, sigmaViol: 0.001 })).not.toBe(original);
    expect(recoverySnapshotFingerprint({ ...snapshot, trajectoryUpdatedAt: '2026-10-10T00:00:01.000Z' })).toBe(original);
    expect(recoverySnapshotFingerprint({ ...snapshot, policyVersion: 'canonical-governance-test.2' })).not.toBe(original);
  });

  it('appends receipt-linked evidence with the exact state metrics', async () => {
    dbExecute.mockResolvedValueOnce({ rows: [] });
    const stateFingerprint = recoverySnapshotFingerprint(snapshot);

    await recordRecoveryCanaryEvidence({
      ...snapshot,
      actorId: 'api_key:private-test-1',
      stateFingerprint,
      receiptId: 'governed-canary-receipt',
      status: 'passed',
      probeTool: 'get_constitutional_state',
    });

    expect(dbExecute).toHaveBeenCalledTimes(1);
    const query = dbExecute.mock.calls[0][0] as { sql: string; args: unknown[] };
    expect(query.sql).toContain('INSERT INTO recovery_canary_evidence');
    expect(query.args).toEqual([
      snapshot.sessionId,
      'api_key:private-test-1',
      'passed',
      stateFingerprint,
      snapshot.policyVersion,
      'get_constitutional_state',
      'governed-canary-receipt',
      snapshot.C,
      snapshot.R,
      snapshot.S,
      1 / 3,
      snapshot.nStable,
      snapshot.sigmaViol,
      snapshot.trajectoryUpdatedAt,
      null,
      null,
      expect.any(String),
      expect.any(String),
    ]);
  });

  it('uses the latest exact-snapshot outcome and fails closed on missing or unavailable evidence', async () => {
    const stateFingerprint = recoverySnapshotFingerprint(snapshot);
    dbExecute.mockResolvedValueOnce({ rows: [] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, stateFingerprint)).resolves.toEqual({
      passed: false, receiptId: null, status: null,
    });

    dbExecute.mockResolvedValueOnce({ rows: [{ canary_status: 'passed', receipt_id: 'receipt-pass', issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() }] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, stateFingerprint, { stateVersion: snapshot.policyVersion, stateFingerprint, M: 1 / 3, sigmaViol: 0, nStable: 3, velocity: 0 })).resolves.toEqual({
      passed: true, receiptId: 'receipt-pass', status: 'passed',
    });

    dbExecute.mockResolvedValueOnce({ rows: [{ canary_status: 'failed', receipt_id: 'receipt-fail', issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 60_000).toISOString() }] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, stateFingerprint, { stateVersion: snapshot.policyVersion, stateFingerprint, M: 1 / 3, sigmaViol: 0, nStable: 3, velocity: 0 })).resolves.toEqual({
      passed: false, receiptId: null, status: 'failed',
    });

    dbExecute.mockRejectedValueOnce(new Error('evidence store unavailable'));
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, stateFingerprint, { stateVersion: snapshot.policyVersion, stateFingerprint, M: 1 / 3, sigmaViol: 0, nStable: 3, velocity: 0 })).resolves.toEqual({
      passed: false, receiptId: null, status: null,
    });
  });

describe('flagged bounded invariant canary validity', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv('CANARY_MODE', 'invariant'); });

  const liveRow = (overrides: Record<string, unknown> = {}) => ({
    canary_status: 'passed', receipt_id: 'bounded-canary-receipt',
    state_fingerprint: 'a'.repeat(64), state_version: 'canonical-v1', m_value: 0.16, n_stable: 3, sigma_viol: 0,
    recovery_state: 'VERIFIED', issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(), writes: 4,
    ...overrides,
  });
  const current = { stateVersion: 'canonical-v1', stateFingerprint: 'a'.repeat(64), M: 0.16, sigmaViol: 0, nStable: 3, velocity: 0 };

  it('remains valid across read-only calls only for the exact current fingerprint', async () => {
    dbExecute.mockResolvedValue({ rows: [liveRow()] });
    for (let i = 0; i < 5; i += 1) {
      await expect(readRecoveryCanaryEvidence(snapshot.sessionId, 'a'.repeat(64), current))
        .resolves.toMatchObject({ passed: true, receiptId: 'bounded-canary-receipt' });
    }
  });

  it('rejects invariant evidence when the canonical fingerprint changes', async () => {
    dbExecute.mockResolvedValue({ rows: [liveRow()] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, 'b'.repeat(64), current))
      .resolves.toMatchObject({ passed: false, receiptId: null });
  });

  it('rejects the mocked write-count limit result (SQL integration coverage is separate)', async () => {
    dbExecute.mockResolvedValue({ rows: [liveRow({ writes: 50 })] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, 'a'.repeat(64), current))
      .resolves.toMatchObject({ passed: false, receiptId: null });
  });

  it('expires after the time window', async () => {
    dbExecute.mockResolvedValue({ rows: [liveRow({ issued_at: '2020-01-01T00:00:00.000Z', expires_at: '2020-01-01T01:00:00.000Z' })] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, 'ignored', current))
      .resolves.toMatchObject({ passed: false, receiptId: null });
  });

  it('refuses a canary when velocity is above the recovery stability threshold', async () => {
    dbExecute.mockResolvedValue({ rows: [liveRow()] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, 'a'.repeat(64), { ...current, velocity: 0.021 }))
      .resolves.toMatchObject({ passed: false, receiptId: null });
  });

  it('refuses a write when M falls below the constitutional recovery threshold', async () => {
    dbExecute.mockResolvedValue({ rows: [liveRow()] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, 'a'.repeat(64), { ...current, M: 0.149 }))
      .resolves.toMatchObject({ passed: false, receiptId: null });
  });

  it('refuses a canary when state version changes or sigma is nonzero', async () => {
    dbExecute.mockResolvedValue({ rows: [liveRow()] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, 'a'.repeat(64), { ...current, stateVersion: 'canonical-v2' }))
      .resolves.toMatchObject({ passed: false });
    dbExecute.mockResolvedValue({ rows: [liveRow()] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, 'a'.repeat(64), { ...current, sigmaViol: 0.01 }))
      .resolves.toMatchObject({ passed: false });
  });
});
});
