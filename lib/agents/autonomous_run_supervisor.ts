import crypto from 'crypto';
import { getClient } from '../db';

export type AutonomousRunStatus = 'active' | 'paused' | 'completed' | 'failed' | 'expired';

export interface RunCheckpoint {
  trajectoryState?: unknown;
  cursor?: string;
  metadata?: Record<string, unknown>;
}

export interface AutonomousRun {
  runId: string;
  ownerId: string;
  sessionId: string;
  status: AutonomousRunStatus;
  checkpoint: RunCheckpoint;
  checkpointVersion: number;
  actionsUsed: number;
  actionBudget: number;
  riskUsed: number;
  riskBudget: number;
  leaseExpiresAt: number;
  wallDeadline: number;
}

export interface RunLease {
  runId: string;
  leaseToken: string;
}

export interface CreateRunInput {
  ownerId: string;
  sessionId: string;
  actionBudget?: number;
  riskBudget?: number;
  maxRuntimeMs?: number;
  leaseTtlMs?: number;
  checkpoint?: RunCheckpoint;
}

export interface ReservedAction {
  runId: string;
  idempotencyKey: string;
  status: 'reserved' | 'completed' | 'failed';
  replay: boolean;
}

export class RunGovernanceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RunGovernanceError';
  }
}

const DEFAULT_ACTION_BUDGET = 10_000;
const DEFAULT_RISK_BUDGET = 10_000;
const DEFAULT_RUNTIME_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function now(): number { return Date.now(); }

function rowToRun(row: Record<string, unknown>): AutonomousRun {
  return {
    runId: String(row.run_id), ownerId: String(row.owner_id), sessionId: String(row.session_id),
    status: String(row.status) as AutonomousRunStatus,
    checkpoint: JSON.parse(String(row.checkpoint_json ?? '{}')) as RunCheckpoint,
    checkpointVersion: Number(row.checkpoint_version ?? 0),
    actionsUsed: Number(row.actions_used ?? 0), actionBudget: Number(row.action_budget),
    riskUsed: Number(row.risk_used ?? 0), riskBudget: Number(row.risk_budget),
    leaseExpiresAt: Number(row.lease_expires_at), wallDeadline: Number(row.wall_deadline),
  };
}

async function ensureSchema(): Promise<void> {
  const db = getClient();
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS autonomous_runs (
      run_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, session_id TEXT NOT NULL,
      status TEXT NOT NULL, lease_token_hash TEXT NOT NULL, lease_expires_at INTEGER NOT NULL,
      heartbeat_at INTEGER NOT NULL, wall_deadline INTEGER NOT NULL, checkpoint_json TEXT NOT NULL,
      checkpoint_version INTEGER NOT NULL DEFAULT 0, actions_used INTEGER NOT NULL DEFAULT 0,
      action_budget INTEGER NOT NULL, risk_used REAL NOT NULL DEFAULT 0,
      risk_budget REAL NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS autonomous_actions (
      run_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, tool_name TEXT NOT NULL,
      args_hash TEXT NOT NULL, status TEXT NOT NULL, result_hash TEXT,
      receipt_id TEXT, created_at INTEGER NOT NULL, completed_at INTEGER,
      PRIMARY KEY (run_id, idempotency_key)
    )`, args: [] },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_autonomous_runs_status ON autonomous_runs(status, lease_expires_at)', args: [] },
  ], 'write');
}

async function readRun(runId: string): Promise<AutonomousRun | undefined> {
  await ensureSchema();
  const result = await getClient().execute({
    sql: 'SELECT * FROM autonomous_runs WHERE run_id = ?', args: [runId],
  });
  return result.rows.length ? rowToRun(result.rows[0] as Record<string, unknown>) : undefined;
}

function assertLease(run: AutonomousRun | undefined, lease: RunLease, timestamp = now()): AutonomousRun {
  if (!run) throw new RunGovernanceError('run_not_found', 'Autonomous run does not exist.');
  if (run.status !== 'active') throw new RunGovernanceError('run_not_active', `Run is ${run.status}.`);
  if (run.leaseExpiresAt <= timestamp) throw new RunGovernanceError('lease_expired', 'Run lease has expired.');
  if (run.wallDeadline <= timestamp) throw new RunGovernanceError('run_deadline_exceeded', 'Run wall-clock deadline exceeded.');
  return run;
}

export async function createAutonomousRun(input: CreateRunInput): Promise<{ run: AutonomousRun; lease: RunLease }> {
  await ensureSchema();
  const timestamp = now();
  const runId = `run_${crypto.randomUUID()}`;
  const leaseToken = crypto.randomBytes(32).toString('base64url');
  const leaseTtlMs = input.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const run: AutonomousRun = {
    runId, ownerId: input.ownerId, sessionId: input.sessionId, status: 'active',
    checkpoint: input.checkpoint ?? {}, checkpointVersion: 0, actionsUsed: 0,
    actionBudget: input.actionBudget ?? DEFAULT_ACTION_BUDGET, riskUsed: 0,
    riskBudget: input.riskBudget ?? DEFAULT_RISK_BUDGET,
    leaseExpiresAt: timestamp + leaseTtlMs, wallDeadline: timestamp + (input.maxRuntimeMs ?? DEFAULT_RUNTIME_MS),
  };
  if (run.actionBudget <= 0 || run.riskBudget < 0 || run.wallDeadline <= timestamp) {
    throw new RunGovernanceError('invalid_run_budget', 'Run budgets and runtime must be positive.');
  }
  await getClient().execute({
    sql: `INSERT INTO autonomous_runs
      (run_id, owner_id, session_id, status, lease_token_hash, lease_expires_at,
       heartbeat_at, wall_deadline, checkpoint_json, checkpoint_version, actions_used,
       action_budget, risk_used, risk_budget, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, 0, 0, ?, 0, ?, ?, ?)`,
    args: [runId, input.ownerId, input.sessionId, hashToken(leaseToken), run.leaseExpiresAt,
      timestamp, run.wallDeadline, JSON.stringify(run.checkpoint), run.actionBudget,
      run.riskBudget, timestamp, timestamp],
  });
  return { run, lease: { runId, leaseToken } };
}

export async function heartbeatRun(lease: RunLease, ttlMs = DEFAULT_LEASE_TTL_MS): Promise<AutonomousRun> {
  const timestamp = now();
  await ensureSchema();
  const result = await getClient().execute({
    sql: `UPDATE autonomous_runs SET lease_expires_at = ?, heartbeat_at = ?, updated_at = ?
          WHERE run_id = ? AND lease_token_hash = ? AND status = 'active'
            AND wall_deadline > ?`,
    args: [timestamp + ttlMs, timestamp, timestamp, lease.runId, hashToken(lease.leaseToken), timestamp],
  });
  if ((result.rowsAffected ?? 0) !== 1) {
    const run = await readRun(lease.runId);
    if (run?.wallDeadline && run.wallDeadline <= timestamp) throw new RunGovernanceError('run_deadline_exceeded', 'Run wall-clock deadline exceeded.');
    throw new RunGovernanceError('lease_rejected', 'Lease heartbeat rejected.');
  }
  return (await readRun(lease.runId))!;
}

export async function resumeAutonomousRun(
  runId: string,
  ownerId: string,
  ttlMs = DEFAULT_LEASE_TTL_MS,
): Promise<{ run: AutonomousRun; lease: RunLease }> {
  await ensureSchema();
  const timestamp = now();
  const leaseToken = crypto.randomBytes(32).toString('base64url');
  const result = await getClient().execute({
    sql: `UPDATE autonomous_runs SET status = 'active', lease_token_hash = ?,
          lease_expires_at = ?, heartbeat_at = ?, updated_at = ?
          WHERE run_id = ? AND owner_id = ? AND status = 'paused' AND wall_deadline > ?`,
    args: [hashToken(leaseToken), timestamp + ttlMs, timestamp, timestamp, runId, ownerId, timestamp],
  });
  if ((result.rowsAffected ?? 0) !== 1) {
    throw new RunGovernanceError('resume_rejected', 'Run cannot be resumed by this owner or its wall-clock deadline has passed.');
  }
  return { run: (await readRun(runId))!, lease: { runId, leaseToken } };
}

export async function reserveRunAction(
  lease: RunLease,
  idempotencyKey: string,
  toolName: string,
  argsHash: string,
  riskCost: number,
): Promise<ReservedAction> {
  if (!idempotencyKey.trim()) throw new RunGovernanceError('idempotency_required', 'Every autonomous action requires an idempotency key.');
  if (!Number.isFinite(riskCost) || riskCost < 0) throw new RunGovernanceError('invalid_risk_cost', 'Risk cost must be a non-negative finite number.');
  await ensureSchema();
  const db = getClient();
  const tx = await db.transaction('write');
  const timestamp = now();
  try {
    const rows = await tx.execute({ sql: 'SELECT * FROM autonomous_runs WHERE run_id = ?', args: [lease.runId] });
    const run = rows.rows.length ? rowToRun(rows.rows[0] as Record<string, unknown>) : undefined;
    assertLease(run, lease, timestamp);
    const existing = await tx.execute({
      sql: 'SELECT status, tool_name, args_hash FROM autonomous_actions WHERE run_id = ? AND idempotency_key = ?',
      args: [lease.runId, idempotencyKey],
    });
    if (existing.rows.length) {
      if (String(existing.rows[0].tool_name) !== toolName || String(existing.rows[0].args_hash) !== argsHash) {
        throw new RunGovernanceError('idempotency_key_reused', 'Idempotency key cannot be reused for different tool arguments.');
      }
      await tx.commit();
      return { runId: lease.runId, idempotencyKey, status: String(existing.rows[0].status) as ReservedAction['status'], replay: true };
    }
    if (run!.actionsUsed >= run!.actionBudget) throw new RunGovernanceError('action_budget_exhausted', 'Autonomous action budget exhausted.');
    if (run!.riskUsed + riskCost > run!.riskBudget) throw new RunGovernanceError('risk_budget_exhausted', 'Autonomous risk budget exhausted.');
    await tx.execute({
      sql: `INSERT INTO autonomous_actions
        (run_id, idempotency_key, tool_name, args_hash, status, created_at)
        VALUES (?, ?, ?, ?, 'reserved', ?)`,
      args: [lease.runId, idempotencyKey, toolName, argsHash, timestamp],
    });
    const updated = await tx.execute({
      sql: `UPDATE autonomous_runs SET actions_used = actions_used + 1,
        risk_used = risk_used + ?, heartbeat_at = ?, updated_at = ?
        WHERE run_id = ? AND lease_token_hash = ? AND status = 'active'
          AND lease_expires_at > ? AND wall_deadline > ?
          AND actions_used < action_budget AND risk_used + ? <= risk_budget`,
      args: [riskCost, timestamp, timestamp, lease.runId, hashToken(lease.leaseToken), timestamp, timestamp, riskCost],
    });
    if ((updated.rowsAffected ?? 0) !== 1) throw new RunGovernanceError('reservation_conflict', 'Action reservation lost a concurrent lease or budget race.');
    await tx.commit();
    return { runId: lease.runId, idempotencyKey, status: 'reserved', replay: false };
  } catch (error) {
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}

export async function completeRunAction(
  lease: RunLease, idempotencyKey: string, success: boolean, resultHash: string, receiptId?: string,
): Promise<void> {
  await ensureSchema();
  const timestamp = now();
  const result = await getClient().execute({
    sql: `UPDATE autonomous_actions SET status = ?, result_hash = ?, receipt_id = ?, completed_at = ?
          WHERE run_id = ? AND idempotency_key = ? AND status = 'reserved'
            AND EXISTS (SELECT 1 FROM autonomous_runs
                        WHERE run_id = ? AND lease_token_hash = ? AND status = 'active')`,
    args: [success ? 'completed' : 'failed', resultHash, receiptId ?? null, timestamp,
      lease.runId, idempotencyKey, lease.runId, hashToken(lease.leaseToken)],
  });
  if ((result.rowsAffected ?? 0) !== 1) {
    const run = await readRun(lease.runId);
    assertLease(run, lease, timestamp);
    throw new RunGovernanceError('action_not_reserved', 'Action was not reserved or was already finalized.');
  }
}

export async function checkpointRun(
  lease: RunLease, checkpoint: RunCheckpoint, expectedVersion: number,
): Promise<AutonomousRun> {
  await ensureSchema();
  const timestamp = now();
  const result = await getClient().execute({
    sql: `UPDATE autonomous_runs SET checkpoint_json = ?, checkpoint_version = checkpoint_version + 1,
          heartbeat_at = ?, updated_at = ?
          WHERE run_id = ? AND lease_token_hash = ? AND status = 'active'
            AND checkpoint_version = ? AND lease_expires_at > ? AND wall_deadline > ?`,
    args: [JSON.stringify(checkpoint), timestamp, timestamp, lease.runId, hashToken(lease.leaseToken), expectedVersion, timestamp, timestamp],
  });
  if ((result.rowsAffected ?? 0) !== 1) throw new RunGovernanceError('checkpoint_conflict', 'Checkpoint rejected because the run is stale, expired, or concurrently updated.');
  return (await readRun(lease.runId))!;
}

export async function recoverExpiredRun(runId: string): Promise<AutonomousRun | undefined> {
  await ensureSchema();
  const timestamp = now();
  await getClient().execute({
    sql: `UPDATE autonomous_runs SET status = CASE WHEN wall_deadline <= ? THEN 'expired' ELSE 'paused' END,
          updated_at = ? WHERE run_id = ? AND status = 'active' AND (lease_expires_at <= ? OR wall_deadline <= ?)`,
    args: [timestamp, timestamp, runId, timestamp, timestamp],
  });
  return readRun(runId);
}

export async function getAutonomousRun(runId: string): Promise<AutonomousRun | undefined> {
  return readRun(runId);
}
