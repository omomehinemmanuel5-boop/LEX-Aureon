import { getClient } from '../db';
import { CONSTITUTION } from '../constitution';
import { initAccountQuarantineSchema } from './account_quarantine';

/**
 * Owner self-reset for quarantined sessions.
 *
 * A reset is allowed only when the session's stored trajectory is below the
 * quarantine floor and the caller owns the session. The live row is archived
 * and deleted in one transaction, so a failed archive leaves the row in place.
 * The next governed call re-creates a uniform row through the existing
 * bootstrap path, which grants no authority on its own.
 *
 * Abuse handling is deliberately light: resets are not rate-limited for normal
 * use. After RESET_ALERT_THRESHOLD resets in the window, further resets are
 * paused for RESET_PAUSE_MS and an alert is logged.
 */

export const RESET_ALERT_THRESHOLD = 5;
export const RESET_WINDOW_MS = 24 * 60 * 60 * 1000;
export const RESET_PAUSE_MS = 60 * 60 * 1000;

export type QuarantineResetResult =
  | { ok: true; resetId: string; priorM: number; priorSigma: number; priorNStable: number }
  | {
      ok: false;
      code: 'not_owner' | 'not_quarantined' | 'no_trajectory' | 'paused' | 'archive_failed' | 'conflict';
      message: string;
    };

let schemaReady: Promise<void> | null = null;

export function initQuarantineResetSchema(): Promise<void> {
  schemaReady ??= getClient()
    .execute({ sql: `CREATE TABLE IF NOT EXISTS quarantine_resets (
      reset_id        TEXT PRIMARY KEY,
      session_id      TEXT NOT NULL,
      owner_id        TEXT NOT NULL,
      reset_at        INTEGER NOT NULL,
      prior_m         REAL NOT NULL,
      prior_sigma     REAL NOT NULL,
      prior_n_stable  INTEGER NOT NULL,
      prior_row       TEXT NOT NULL
    )` })
    .then(() => undefined);
  return schemaReady;
}

/** A session belongs to an owner when its canonical ID carries the owner prefix. */
export function sessionBelongsToOwner(sessionId: string, ownerId: string): boolean {
  return sessionId.startsWith(`${ownerId}:`);
}

export async function resetQuarantinedSession(input: {
  sessionId: string;
  ownerId: string;
  nowMs?: number;
}): Promise<QuarantineResetResult> {
  const nowMs = input.nowMs ?? Date.now();

  if (!sessionBelongsToOwner(input.sessionId, input.ownerId)) {
    return { ok: false, code: 'not_owner', message: 'This session does not belong to the calling owner.' };
  }

  await initQuarantineResetSchema();
  const client = getClient();

  // Abuse check: count recent resets for this owner.
  const recent = await client.execute({
    sql: 'SELECT COUNT(*) AS n, MAX(reset_at) AS last FROM quarantine_resets WHERE owner_id = ? AND reset_at >= ?',
    args: [input.ownerId, nowMs - RESET_WINDOW_MS],
  });
  const recentCount = Number(recent.rows?.[0]?.n ?? 0);
  const lastReset = Number(recent.rows?.[0]?.last ?? 0);
  if (recentCount >= RESET_ALERT_THRESHOLD && nowMs - lastReset < RESET_PAUSE_MS) {
    return {
      ok: false,
      code: 'paused',
      message: 'Resets are paused for this owner after repeated resets. Contact the operator.',
    };
  }
  if (recentCount === RESET_ALERT_THRESHOLD) {
    console.warn(`[quarantine-reset] owner ${input.ownerId} reached ${RESET_ALERT_THRESHOLD} resets in 24h`);
  }

  if (typeof client.transaction !== 'function') {
    return { ok: false, code: 'archive_failed', message: 'Atomic archive is unavailable; reset refused.' };
  }

  await initAccountQuarantineSchema();
  const tx = await client.transaction('write');
  try {
    const current = await tx.execute({
      sql: 'SELECT * FROM z_traj WHERE session_id = ?',
      args: [input.sessionId],
    });
    const row = current.rows?.[0] as Record<string, unknown> | undefined;
    if (!row) {
      await tx.rollback();
      return { ok: false, code: 'no_trajectory', message: 'No trajectory exists for this session; nothing to reset.' };
    }

    const priorM = Number(row.last_m);
    const priorSigma = Number(row.sigma_viol);
    const priorNStable = Number(row.n_stable);
    if (!Number.isFinite(priorM) || priorM >= CONSTITUTION.TAU_FLOOR) {
      await tx.rollback();
      return {
        ok: false,
        code: 'not_quarantined',
        message: 'Session is not quarantined. Reset is only available below the quarantine floor.',
      };
    }

    const resetId = `QRESET-${crypto.randomUUID()}`;

    // Archive first. If this throws, the transaction rolls back and the row stays.
    try {
      await tx.execute({
        sql: `INSERT INTO quarantine_resets
          (reset_id, session_id, owner_id, reset_at, prior_m, prior_sigma, prior_n_stable, prior_row)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [resetId, input.sessionId, input.ownerId, nowMs, priorM, priorSigma, priorNStable, JSON.stringify(row)],
      });
    } catch {
      await tx.rollback();
      return { ok: false, code: 'archive_failed', message: 'Archive write failed; the session was not reset.' };
    }

    // Delete guarded by the floor condition, so a concurrent recovery cannot be lost.
    const deleted = await tx.execute({
      sql: 'DELETE FROM z_traj WHERE session_id = ? AND last_m < ?',
      args: [input.sessionId, CONSTITUTION.TAU_FLOOR],
    });
    if ((deleted.rowsAffected ?? 0) !== 1) {
      await tx.rollback();
      return { ok: false, code: 'conflict', message: 'Trajectory changed during reset; retry.' };
    }

    // Clear the account-level flag in the same transaction, so a new key for this
    // owner does not bootstrap quarantined once this session has been reset.
    await tx.execute({
      sql: `UPDATE account_quarantine SET cleared_at = ?
            WHERE email = (SELECT email FROM api_keys WHERE id = ? LIMIT 1)
              AND cleared_at IS NULL`,
      args: [nowMs, input.ownerId],
    });

    await tx.commit();
    console.info(`[quarantine-reset] ${resetId} session=${input.sessionId} prior_m=${priorM} prior_sigma=${priorSigma}`);
    return { ok: true, resetId, priorM, priorSigma, priorNStable };
  } catch {
    try { await tx.rollback(); } catch { /* already closed */ }
    return { ok: false, code: 'archive_failed', message: 'Reset failed; no changes were kept.' };
  }
}
