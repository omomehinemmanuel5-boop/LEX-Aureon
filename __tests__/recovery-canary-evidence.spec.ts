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

  it('changes fingerprint for session, metric, stability, sigma, timestamp, or policy changes', () => {
    const original = recoverySnapshotFingerprint(snapshot);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    expect(recoverySnapshotFingerprint({ ...snapshot, sessionId: 'operator-session-b' })).not.toBe(original);
    expect(recoverySnapshotFingerprint({ ...snapshot, R: 0.32 })).not.toBe(original);
    expect(recoverySnapshotFingerprint({ ...snapshot, nStable: 4 })).not.toBe(original);
    expect(recoverySnapshotFingerprint({ ...snapshot, sigmaViol: 0.001 })).not.toBe(original);
    expect(recoverySnapshotFingerprint({ ...snapshot, trajectoryUpdatedAt: '2026-10-10T00:00:01.000Z' })).not.toBe(original);
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
    ]);
  });

  it('uses the latest exact-snapshot outcome and fails closed on missing or unavailable evidence', async () => {
    const stateFingerprint = recoverySnapshotFingerprint(snapshot);
    dbExecute.mockResolvedValueOnce({ rows: [] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, stateFingerprint)).resolves.toEqual({
      passed: false, receiptId: null, status: null,
    });

    dbExecute.mockResolvedValueOnce({ rows: [{ canary_status: 'passed', receipt_id: 'receipt-pass' }] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, stateFingerprint)).resolves.toEqual({
      passed: true, receiptId: 'receipt-pass', status: 'passed',
    });

    dbExecute.mockResolvedValueOnce({ rows: [{ canary_status: 'failed', receipt_id: 'receipt-fail' }] });
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, stateFingerprint)).resolves.toEqual({
      passed: false, receiptId: 'receipt-fail', status: 'failed',
    });

    dbExecute.mockRejectedValueOnce(new Error('evidence store unavailable'));
    await expect(readRecoveryCanaryEvidence(snapshot.sessionId, stateFingerprint)).resolves.toEqual({
      passed: false, receiptId: null, status: null,
    });
  });
});
