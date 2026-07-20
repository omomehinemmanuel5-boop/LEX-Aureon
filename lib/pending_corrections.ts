/**
 * lib/pending_corrections.ts
 *
 * Cross-instance store for the async governor's turn-lag correction G(x,z).
 *
 * fix (2026-07-20) — WHY THIS REPLACES governor_loop.ts's in-memory Map:
 * the async governor computes a correction on turn t and applies it on
 * turn t+1 (turn-lag architecture, see lib/governor_sensing.ts). The handoff
 * used a module-level `Map` scoped to ONE Vercel serverless instance — the
 * exact bug class already fixed for provider cooldowns on 2026-07-19
 * (see lib/provider_cooldown.ts). Turn t writes to instance A's memory;
 * turn t+1 for the same session almost always lands on a DIFFERENT instance
 * whose Map is empty, so the correction is silently dropped — making the
 * whole async-governor feature a near-total no-op in production, which is
 * why governor_effort read ~0 on essentially every turn.
 *
 * State now lives in a shared Turso table (pending_corrections). The
 * apply-once guarantee (a correction must never be applied to two turns) is
 * enforced atomically with DELETE ... RETURNING: whichever instance claims
 * the row deletes it in the same statement, so a race between concurrent
 * turns for one session can't double-apply.
 *
 * This is deliberately NOT on the hot path of every turn the way provider
 * cooldown is — takePendingCorrection() runs once at the start of a turn and
 * putPendingCorrection() runs in the after()-scheduled background task, so a
 * single Turso round-trip each is acceptable and no local L1 cache is needed.
 */

import { getClient } from './db';
import { logger } from './logger';

export interface StoredCorrection {
  delta_C:     number;
  delta_R:     number;
  delta_S:     number;
  rho:         number;
  iec:         number;
  basin_shift: string;
  reason:      string;
  computed_at: number; // epoch ms
}

// A correction older than this is stale — the session has moved on and the
// state it was computed against no longer reflects reality. Matches the TTL
// of the old in-memory store.
export const CORRECTION_TTL_MS = 30_000;

let _tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS pending_corrections (
      session_id  TEXT    PRIMARY KEY,
      delta_c     REAL    NOT NULL,
      delta_r     REAL    NOT NULL,
      delta_s     REAL    NOT NULL,
      rho         REAL    NOT NULL,
      iec         REAL    NOT NULL,
      basin_shift TEXT    NOT NULL,
      reason      TEXT    NOT NULL,
      computed_at INTEGER NOT NULL
    )
  `);
  _tableEnsured = true;
}

// Opportunistic sweep of leaked rows (sessions that fired once and never
// returned within the TTL). Bounded to once per SWEEP_INTERVAL_MS per
// instance so it never becomes per-call write pressure.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let _lastSweptAt = 0;
async function maybeSweep(now: number): Promise<void> {
  if (now - _lastSweptAt < SWEEP_INTERVAL_MS) return;
  _lastSweptAt = now;
  try {
    await getClient().execute({
      sql: 'DELETE FROM pending_corrections WHERE computed_at < ?',
      args: [now - CORRECTION_TTL_MS],
    });
  } catch { /* non-fatal */ }
}

/**
 * Store (or replace) the pending correction for a session. A newer
 * computation supersedes any earlier un-consumed one — the freshest read of
 * the session's state wins.
 */
export async function putPendingCorrection(sessionId: string, c: StoredCorrection): Promise<void> {
  try {
    await ensureTable();
    await getClient().execute({
      sql: `INSERT INTO pending_corrections
              (session_id, delta_c, delta_r, delta_s, rho, iec, basin_shift, reason, computed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              delta_c = excluded.delta_c, delta_r = excluded.delta_r, delta_s = excluded.delta_s,
              rho = excluded.rho, iec = excluded.iec, basin_shift = excluded.basin_shift,
              reason = excluded.reason, computed_at = excluded.computed_at`,
      args: [sessionId, c.delta_C, c.delta_R, c.delta_S, c.rho, c.iec, c.basin_shift, c.reason, c.computed_at],
    });
    void maybeSweep(Date.now());
  } catch (e) {
    // Non-fatal: a lost correction just means turn t+1 runs without the
    // advisory nudge — F(x,z) and its hard floor are unaffected.
    logger.debug('pending_corrections.put', 'store failed (non-fatal)', { session_id: sessionId, error: String(e).slice(0, 120) });
  }
}

/**
 * Atomically claim and remove the pending correction for a session.
 * DELETE ... RETURNING guarantees apply-once even if two turns for the same
 * session race. Returns null when there is none, it is expired, or Turso is
 * unavailable (all safe — the turn simply proceeds without the nudge).
 */
export async function takePendingCorrection(sessionId: string): Promise<StoredCorrection | null> {
  try {
    await ensureTable();
    const r = await getClient().execute({
      sql: `DELETE FROM pending_corrections WHERE session_id = ?
            RETURNING delta_c, delta_r, delta_s, rho, iec, basin_shift, reason, computed_at`,
      args: [sessionId],
    });
    if (!r.rows.length) return null;
    const row = r.rows[0];
    const computed_at = Number(row.computed_at);
    if (Date.now() - computed_at > CORRECTION_TTL_MS) return null; // stale — discard
    return {
      delta_C:     Number(row.delta_c),
      delta_R:     Number(row.delta_r),
      delta_S:     Number(row.delta_s),
      rho:         Number(row.rho),
      iec:         Number(row.iec),
      basin_shift: String(row.basin_shift),
      reason:      String(row.reason),
      computed_at,
    };
  } catch (e) {
    logger.debug('pending_corrections.take', 'read failed (non-fatal)', { session_id: sessionId, error: String(e).slice(0, 120) });
    return null;
  }
}
