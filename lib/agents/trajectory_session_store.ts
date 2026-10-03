/**
 * Trajectory session store — Turso-backed.
 *
 * Trajectory state is durable because serverless instances do not guarantee
 * affinity. Writes also use a monotonic version and an atomic in-flight claim:
 * two concurrent requests cannot both pass the same trajectory step and execute
 * the side effect twice.
 */

import { getClient } from '../db';
import type { TrajectoryState } from './trajectory_governance';

let schemaEnsured = false;

async function ensureTrajectorySchema(): Promise<void> {
  if (schemaEnsured) return;
  const client = getClient();
  await client.execute(`
    CREATE TABLE IF NOT EXISTS trajectory_state (
      session_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )
  `);
  // Existing installations predate the version column. SQLite/Turso supports
  // this idempotent migration pattern; duplicate-column errors are harmless.
  try { await client.execute('ALTER TABLE trajectory_state ADD COLUMN version INTEGER NOT NULL DEFAULT 0'); } catch { /* already migrated */ }
  schemaEnsured = true;
}

function hydrate(row: Record<string, unknown>): TrajectoryState | undefined {
  try {
    const state = JSON.parse(row.state_json as string) as TrajectoryState;
    state.version = Number(row.version ?? state.version ?? 0);
    state.inFlight = Boolean(state.inFlight);
    return state;
  } catch {
    return undefined;
  }
}

export async function getTrajectoryState(sessionId: string): Promise<TrajectoryState | undefined> {
  await ensureTrajectorySchema();
  const r = await getClient().execute({
    sql: 'SELECT state_json, version FROM trajectory_state WHERE session_id = ?',
    args: [sessionId],
  });
  if (!r.rows.length) return undefined;
  return hydrate(r.rows[0] as Record<string, unknown>);
}

/** Upsert used for plan declaration and administrative state replacement. */
export async function setTrajectoryState(sessionId: string, state: TrajectoryState): Promise<void> {
  await ensureTrajectorySchema();
  const timestamp = Date.now();
  const version = state.version ?? 0;
  const persistedState: TrajectoryState = {
    ...state,
    version,
    inFlight: Boolean(state.inFlight),
    createdAt: state.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  await getClient().execute({
    sql: `INSERT INTO trajectory_state (session_id, state_json, version, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET state_json=excluded.state_json,
            version=excluded.version, updated_at=excluded.updated_at`,
    args: [sessionId, JSON.stringify(persistedState), version, timestamp],
  });
}

/** Atomically reserve the current step before any external side effect begins. */
export async function claimTrajectoryState(
  sessionId: string,
  expectedVersion: number,
): Promise<TrajectoryState | undefined> {
  await ensureTrajectorySchema();
  const current = await getTrajectoryState(sessionId);
  if (!current || current.version !== expectedVersion || current.locked || current.inFlight) return undefined;
  const nextVersion = expectedVersion + 1;
  const updatedAt = Date.now();
  const claimed: TrajectoryState = { ...current, version: nextVersion, inFlight: true, updatedAt };
  const result = await getClient().execute({
    sql: `UPDATE trajectory_state SET state_json = ?, version = ?, updated_at = ?
          WHERE session_id = ? AND version = ?`,
    args: [JSON.stringify(claimed), nextVersion, updatedAt, sessionId, expectedVersion],
  });
  return (result.rowsAffected ?? 0) === 1 ? claimed : undefined;
}

/** Commit a claimed action only if no other writer changed the claimed state. */
export async function compareAndSetTrajectoryState(
  sessionId: string,
  state: TrajectoryState,
  expectedVersion: number,
): Promise<boolean> {
  await ensureTrajectorySchema();
  const nextVersion = expectedVersion + 1;
  const updatedAt = Date.now();
  const committed: TrajectoryState = {
    ...state,
    version: nextVersion,
    inFlight: false,
    updatedAt,
  };
  const result = await getClient().execute({
    sql: `UPDATE trajectory_state SET state_json = ?, version = ?, updated_at = ?
          WHERE session_id = ? AND version = ?`,
    args: [JSON.stringify(committed), nextVersion, updatedAt, sessionId, expectedVersion],
  });
  return (result.rowsAffected ?? 0) === 1;
}

/** Lock a plan when execution status is unknown; retrying must not bypass the checkpoint. */
export async function lockTrajectoryState(sessionId: string, reason: string): Promise<TrajectoryState | undefined> {
  await ensureTrajectorySchema();
  const state = await getTrajectoryState(sessionId);
  if (!state) return undefined;
  const locked: TrajectoryState = {
    ...state, locked: true, inFlight: false, lockReason: reason,
  };
  const ok = await compareAndSetTrajectoryState(sessionId, locked, state.version ?? 0);
  return ok ? { ...locked, version: (state.version ?? 0) + 1 } : (await getTrajectoryState(sessionId));
}

export async function clearTrajectoryState(sessionId: string): Promise<void> {
  await ensureTrajectorySchema();
  await getClient().execute({
    sql: 'DELETE FROM trajectory_state WHERE session_id = ?',
    args: [sessionId],
  });
}

export function isTrajectoryActive(state: TrajectoryState | undefined): state is TrajectoryState {
  if (!state) return false;
  if (state.locked || state.inFlight) return false;
  return state.currentStep < state.plan.actions.length;
}

export function isTrajectoryExpired(state: TrajectoryState | undefined): boolean {
  return Boolean(state?.expiresAt !== undefined && Date.now() >= state.expiresAt);
}
