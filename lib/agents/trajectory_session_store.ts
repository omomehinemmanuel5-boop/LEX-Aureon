/**
 * Trajectory session store — Turso-backed.
 *
 * fix (2026-09-06): this was originally an in-memory Map<session_id,
 * TrajectoryState>, mirroring tool_interceptor.ts's read-only result cache.
 * That was the wrong model for THIS use case. tool_interceptor.ts's cache
 * is genuinely fine to lose on a cold start — worst case, a read gets
 * re-executed and re-cached. A trajectory plan is the opposite: it's the
 * only record of what an agent declared it would do, and losing it
 * silently means every subsequent call in that session falls through to
 * ordinary per-call governance with NO scope/order/drift enforcement at
 * all — the exact protection this feature exists to provide.
 *
 * This was found live: a 2-step demo plan lost its state after step 1
 * because Vercel serverless functions have no guaranteed warm-instance
 * affinity between separate HTTP requests, even seconds apart. The plan's
 * governance logic (trajectory_governance.ts) was correct throughout —
 * the storage layer underneath it was not durable enough for its own
 * design assumptions.
 *
 * Follows the exact same pattern as lib/kv.ts's session_state table
 * (session_id TEXT PRIMARY KEY, state_json TEXT, updated_at) — reusing
 * that pattern rather than that table, since session_state already holds
 * an unrelated JSON shape (KvCRSState) for text-governance sessions, and
 * MCP session_ids and govern-endpoint session_ids are separate
 * namespaces that should not risk colliding on the same primary key.
 */

import { getClient } from '../db';
import type { TrajectoryState } from './trajectory_governance';

let schemaEnsured = false;

async function ensureTrajectorySchema(): Promise<void> {
  if (schemaEnsured) return;
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS trajectory_state (
      session_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  schemaEnsured = true;
}

/** Returns the active trajectory state for a session, or undefined if none is declared. */
export async function getTrajectoryState(sessionId: string): Promise<TrajectoryState | undefined> {
  await ensureTrajectorySchema();
  const r = await getClient().execute({
    sql: 'SELECT state_json FROM trajectory_state WHERE session_id = ?',
    args: [sessionId],
  });
  if (!r.rows.length) return undefined;
  try {
    return JSON.parse(r.rows[0].state_json as string) as TrajectoryState;
  } catch {
    return undefined;
  }
}

export async function setTrajectoryState(sessionId: string, state: TrajectoryState): Promise<void> {
  await ensureTrajectorySchema();
  await getClient().execute({
    sql: `INSERT INTO trajectory_state (session_id, state_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`,
    args: [sessionId, JSON.stringify(state), Date.now()],
  });
}

export async function clearTrajectoryState(sessionId: string): Promise<void> {
  await ensureTrajectorySchema();
  await getClient().execute({
    sql: 'DELETE FROM trajectory_state WHERE session_id = ?',
    args: [sessionId],
  });
}

/**
 * A trajectory is "active" (should gate dispatch) only while it still has
 * undeclared steps remaining and hasn't locked. A completed or locked plan
 * falls through to ordinary per-call governance for any further calls in
 * the same session, rather than permanently blocking everything.
 */
export function isTrajectoryActive(state: TrajectoryState | undefined): state is TrajectoryState {
  if (!state) return false;
  if (state.locked) return false;
  return state.currentStep < state.plan.actions.length;
}
