import crypto from 'crypto';
import { getClient } from '../db';
import { CONSTITUTION } from '../constitution';

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
  recoveryState?: string;
  issuedAt?: string;
  expiresAt?: string;
}

export interface RecoveryCanaryCurrentState {
  stateVersion: string;
  stateFingerprint: string;
  M: number;
  sigmaViol: number;
  nStable: number;
}

function exactNumber(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(17) : 'invalid';
}

/**
 * Fingerprint fields: sessionId, policyVersion, C, R, S, nStable, sigmaViol.
 * Numeric fields use 17-digit precision. Deliberately excluded: observed_at,
 * trajectory_updated_at, receipt IDs, and other observation metadata. Those
 * values describe when/how the snapshot was observed, not the governed state.
 * Read-only inspections therefore cannot invalidate canary evidence merely by
 * observing the same canonical state again.
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
       n_stable, sigma_viol, trajectory_updated_at, reason, recovery_state, issued_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.recoveryState ?? null,
      input.issuedAt ?? new Date().toISOString(),
      input.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    ],
  });
}

/**
 * Apply the invariant-mode validity rules to the latest session canary.
 * Shared by governed-state reads and audit-receipt attribution.
 */
export async function readInvariantRecoveryCanaryEvidence(
  sessionId: string,
  current: RecoveryCanaryCurrentState,
): Promise<{ passed: boolean; receiptId: string | null; status: RecoveryCanaryStatus | null }> {
  try {
    const result = await getClient().execute({
      sql: `SELECT e.*, (SELECT COUNT(*) FROM tool_receipts w WHERE w.session_id = e.session_id
            AND datetime(w.created_at) > datetime(e.issued_at) AND w.tool_name NOT IN
            ('read_file','read_directory','list_directory','list_files','read_memory','search_memory','fetch_page','http_get','get_file','cat','head','tail','grep','find','ls','dir','glob','run_recovery_canary','get_constitutional_state','get_recent_receipts','explain_denial','search_code','get_build_status','get_workflow_run','get_workflow_log','get_workflow_artifact','get_vercel_logs','preview_patch_file','check_github_token_scope','get_trajectory_status','read_json','parse_csv','query_database','simulate_agent_plan','review_agent_action','run_self_test','self_reflect')) AS writes
            FROM recovery_canary_evidence e WHERE e.session_id = ?
            ORDER BY e.id DESC LIMIT 1`,
      args: [sessionId],
    });
    if (!result.rows.length) return { passed: false, receiptId: null, status: null };
    const row = result.rows[0];
    const status = String(row.canary_status);
    const expiryMs = Date.parse(String(row.expires_at ?? ''));
    const maxWrites = Number(process.env.CANARY_MAX_GOVERNED_WRITES ?? 50);
    const maxAgeMs = Number(process.env.CANARY_WINDOW_MS ?? 60 * 60 * 1000);
    const issuedMs = Date.parse(String(row.issued_at ?? row.created_at ?? ''));
    const valid = status === 'passed'
      && String(row.state_version) === current.stateVersion
      && String(row.state_fingerprint) === current.stateFingerprint
      && current.M >= CONSTITUTION.TAU_RECOVERY && current.sigmaViol === 0
      && current.nStable >= CONSTITUTION.N_MIN
      && Number(row.writes ?? 0) < maxWrites && Number.isFinite(expiryMs)
      && Number.isFinite(issuedMs) && Date.now() < expiryMs && Date.now() - issuedMs < maxAgeMs;
    return { passed: valid, receiptId: valid ? String(row.receipt_id ?? '') || null : null, status: valid ? 'passed' : (status === 'failed' ? 'failed' : null) };
  } catch {
    return { passed: false, receiptId: null, status: null };
  }
}

/** Return the latest proof for this exact snapshot; storage errors fail closed. */
export async function readRecoveryCanaryEvidence(
  sessionId: string,
  stateFingerprint: string,
  current?: RecoveryCanaryCurrentState,
): Promise<{ passed: boolean; receiptId: string | null; status: RecoveryCanaryStatus | null }> {
  if (process.env.CANARY_MODE === 'invariant' && current) {
    return readInvariantRecoveryCanaryEvidence(sessionId, { ...current, stateFingerprint });
  }
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
