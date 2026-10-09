import crypto from 'crypto';
import { getClient } from '../db';

export type RecoveryCanaryStatus = 'passed' | 'failed';

export interface RecoverySnapshotFingerprintInput {
  sessionId: string;
  policyVersion: string;
  C: number;
  R: number;
  S: number;
  nStable: number;
  sigmaViol: number;
  trajectoryUpdatedAt: string;
}

export interface RecoveryCanaryEvidenceInput extends RecoverySnapshotFingerprintInput {
  actorId: string;
  stateFingerprint: string;
  receiptId: string;
  status: RecoveryCanaryStatus;
  probeTool: string;
  reason?: string;
}

function exactNumber(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(17) : 'invalid';
}

/**
 * Binds a canary to the exact canonical recovery snapshot, including the row
 * timestamp and policy version. Any persisted trajectory update invalidates
 * the proof, even if rounded display values happen to look unchanged.
 */
export function recoverySnapshotFingerprint(input: RecoverySnapshotFingerprintInput): string {
  const material = JSON.stringify([
    input.sessionId,
    input.policyVersion,
    exactNumber(input.C),
    exactNumber(input.R),
    exactNumber(input.S),
    exactNumber(input.nStable),
    exactNumber(input.sigmaViol),
    input.trajectoryUpdatedAt,
  ]);
  return crypto.createHash('sha256').update(material).digest('hex');
}

/**
 * Append one observed canary outcome. Rows are intentionally immutable; the
 * latest result for an exact fingerprint determines whether that snapshot is
 * verified. A failed retry therefore supersedes an earlier pass at that same
 * snapshot without erasing the audit history.
 */
export async function recordRecoveryCanaryEvidence(input: RecoveryCanaryEvidenceInput): Promise<void> {
  if (!input.sessionId || !input.actorId || !input.receiptId || !input.probeTool) {
    throw new Error('Recovery canary evidence requires session, actor, receipt, and probe identifiers.');
  }
  if (!/^[a-f0-9]{64}$/.test(input.stateFingerprint)) {
    throw new Error('Recovery canary evidence requires a valid exact-state fingerprint.');
  }

  await getClient().execute({
    sql: `INSERT INTO recovery_canary_evidence
      (session_id, actor_id, canary_status, state_fingerprint, state_version,
       probe_tool, receipt_id, c_value, r_value, s_value, m_value,
       n_stable, sigma_viol, trajectory_updated_at, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.sessionId,
      input.actorId,
      input.status,
      input.stateFingerprint,
      input.policyVersion,
      input.probeTool,
      input.receiptId,
      input.C,
      input.R,
      input.S,
      Math.min(input.C, input.R, input.S),
      input.nStable,
      input.sigmaViol,
      input.trajectoryUpdatedAt,
      input.reason ?? null,
    ],
  });
}

/** Return the latest proof for this exact snapshot; storage errors fail closed. */
export async function readRecoveryCanaryEvidence(
  sessionId: string,
  stateFingerprint: string,
): Promise<{ passed: boolean; receiptId: string | null; status: RecoveryCanaryStatus | null }> {
  try {
    const result = await getClient().execute({
      sql: `SELECT canary_status, receipt_id
            FROM recovery_canary_evidence
            WHERE session_id = ? AND state_fingerprint = ?
            ORDER BY id DESC LIMIT 1`,
      args: [sessionId, stateFingerprint],
    });
    if (!result.rows.length) return { passed: false, receiptId: null, status: null };
    const status = String(result.rows[0].canary_status);
    if (status !== 'passed' && status !== 'failed') {
      return { passed: false, receiptId: null, status: null };
    }
    return {
      passed: status === 'passed',
      receiptId: String(result.rows[0].receipt_id ?? '') || null,
      status,
    };
  } catch {
    // A missing/unavailable evidence table must never be treated as a pass.
    return { passed: false, receiptId: null, status: null };
  }
}
