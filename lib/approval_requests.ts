import crypto from 'crypto';
import { getClient } from './db';
import { getToolCapability } from './agents/tool_capability_registry';

const REQUEST_TTL_MS = 15 * 60 * 1000;
const APPROVAL_METADATA_KEYS = new Set([
  'approval_token', 'approval_id', 'approval_request_id', 'approval', 'approval_request',
]);

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function withoutApprovalMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutApprovalMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !APPROVAL_METADATA_KEYS.has(key))
    .map(([key, entry]) => [key, withoutApprovalMetadata(entry)]));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Canonical SHA-256 digest shared by approval creation and execution. */
export function approvalArgsHash(args: Record<string, unknown>): string {
  const clean = withoutApprovalMetadata(args) as JsonValue;
  return crypto.createHash('sha256').update(stableJson(clean)).digest('hex');
}

export async function ensureApprovalRequestSchema(): Promise<void> {
  const db = getClient();
  await db.execute(`CREATE TABLE IF NOT EXISTS approval_requests (
    request_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args_hash TEXT NOT NULL,
    args_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'used')),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    decided_at INTEGER,
    decided_by TEXT
  )`);
  await db.execute('CREATE INDEX IF NOT EXISTS idx_approval_requests_owner ON approval_requests(owner_id)');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status)');
}

export async function createApprovalRequest(input: {
  ownerId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
}): Promise<{ requestId: string; expiresAt: number }> {
  if (!input.ownerId) throw new Error('Authenticated owner is required.');
  const capability = getToolCapability(input.toolName);
  if (!capability?.approvalRequired || input.toolName === 'request_approval') {
    throw new Error('The requested tool does not require operator approval.');
  }
  const now = Date.now();
  const requestId = crypto.randomBytes(16).toString('base64url');
  const expiresAt = now + REQUEST_TTL_MS;
  const argsJson = stableJson(withoutApprovalMetadata(input.args));
  await ensureApprovalRequestSchema();
  await getClient().execute({
    sql: `INSERT INTO approval_requests
      (request_id, owner_id, session_id, tool_name, args_hash, args_json, status, created_at, expires_at, decided_at, decided_by)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL, NULL)`,
    args: [requestId, input.ownerId, input.sessionId, input.toolName, approvalArgsHash(input.args), argsJson, now, expiresAt],
  });
  return { requestId, expiresAt };
}

export async function consumeApprovalRequest(input: {
  requestId: string;
  ownerId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  nowMs?: number;
}): Promise<{ consumed: boolean; reason: string }> {
  const now = input.nowMs ?? Date.now();
  try {
    await ensureApprovalRequestSchema();
    const found = await getClient().execute({
      sql: `SELECT request_id, owner_id, session_id, tool_name, args_hash, status, expires_at
            FROM approval_requests WHERE request_id = ? LIMIT 1`,
      args: [input.requestId],
    });
    if (!found.rows.length) return { consumed: false, reason: 'Approval request was not found.' };
    const row = found.rows[0];
    if (String(row.status) !== 'approved') return { consumed: false, reason: 'Approval request is not approved or was already used.' };
    if (now >= Number(row.expires_at)) return { consumed: false, reason: 'Approval request has expired.' };
    if (String(row.owner_id) !== input.ownerId) return { consumed: false, reason: 'Approval request belongs to another owner.' };
    if (String(row.session_id) !== input.sessionId) return { consumed: false, reason: 'Approval request belongs to another session.' };
    if (String(row.tool_name) !== input.toolName) return { consumed: false, reason: 'Approval request is bound to another tool.' };
    if (String(row.args_hash) !== approvalArgsHash(input.args)) return { consumed: false, reason: 'Approval request is bound to different arguments.' };
    const result = await getClient().execute({
      sql: `UPDATE approval_requests SET status = 'used'
            WHERE request_id = ? AND owner_id = ? AND session_id = ? AND tool_name = ?
              AND args_hash = ? AND status = 'approved' AND expires_at > ?`,
      args: [input.requestId, input.ownerId, input.sessionId, input.toolName, approvalArgsHash(input.args), now],
    });
    if ((result.rowsAffected ?? 0) !== 1) {
      return { consumed: false, reason: 'Approval request could not be consumed exactly once.' };
    }
    return { consumed: true, reason: 'Operator approval consumed exactly once.' };
  } catch {
    return { consumed: false, reason: 'Approval request store unavailable; execution denied by fail-closed policy.' };
  }
}

export async function restoreApprovalRequest(input: {
  requestId: string;
  ownerId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  nowMs?: number;
}): Promise<{ restored: boolean; reason: string }> {
  const now = input.nowMs ?? Date.now();
  try {
    await ensureApprovalRequestSchema();
    const result = await getClient().execute({
      sql: `UPDATE approval_requests SET status = 'approved'
            WHERE request_id = ? AND owner_id = ? AND session_id = ? AND tool_name = ?
              AND args_hash = ? AND status = 'used' AND expires_at > ?`,
      args: [
        input.requestId, input.ownerId, input.sessionId, input.toolName,
        approvalArgsHash(input.args), now,
      ],
    });
    if ((result.rowsAffected ?? 0) !== 1) {
      return { restored: false, reason: 'Approval could not be restored; it may have expired or changed state.' };
    }
    return { restored: true, reason: 'Approval restored because execution had not started.' };
  } catch {
    return { restored: false, reason: 'Approval store unavailable; restoration could not be confirmed.' };
  }
}

export async function listPendingApprovalRequests(nowMs = Date.now()): Promise<Array<{
  request_id: string; owner_id: string; session_id: string; tool_name: string;
  args_json: string; created_at: number; expires_at: number;
}>> {
  await ensureApprovalRequestSchema();
  const result = await getClient().execute({
    sql: `SELECT request_id, owner_id, session_id, tool_name, args_json, created_at, expires_at
          FROM approval_requests WHERE status = 'pending' AND expires_at > ? ORDER BY created_at ASC LIMIT 100`,
    args: [nowMs],
  });
  return result.rows.map(row => ({
    request_id: String(row.request_id), owner_id: String(row.owner_id), session_id: String(row.session_id),
    tool_name: String(row.tool_name), args_json: String(row.args_json),
    created_at: Number(row.created_at), expires_at: Number(row.expires_at),
  }));
}

export type ApprovalRequestStatus = 'pending' | 'approved' | 'denied' | 'used' | 'expired';
export interface ApprovalRequestRecord {
  request_id: string;
  owner_id: string;
  session_id: string;
  tool_name: string;
  args_json: string;
  status: ApprovalRequestStatus;
  created_at: number;
  expires_at: number;
  decided_at: number | null;
  decided_by: string | null;
}

/** Return a bounded, append-only view of approval history. */
export async function listApprovalRequests(nowMs = Date.now(), limit = 100): Promise<ApprovalRequestRecord[]> {
  await ensureApprovalRequestSchema();
  const boundedLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  const result = await getClient().execute({
    sql: `SELECT request_id, owner_id, session_id, tool_name, args_json, status,
                 created_at, expires_at, decided_at, decided_by
          FROM approval_requests ORDER BY created_at DESC LIMIT ?`,
    args: [boundedLimit],
  });
  return result.rows.map(row => {
    const storedStatus = String(row.status) as Exclude<ApprovalRequestStatus, 'expired'>;
    const status: ApprovalRequestStatus = storedStatus === 'pending' && nowMs >= Number(row.expires_at)
      ? 'expired'
      : storedStatus;
    return {
      request_id: String(row.request_id),
      owner_id: String(row.owner_id),
      session_id: String(row.session_id),
      tool_name: String(row.tool_name),
      args_json: String(row.args_json),
      status,
      created_at: Number(row.created_at),
      expires_at: Number(row.expires_at),
      decided_at: row.decided_at == null ? null : Number(row.decided_at),
      decided_by: row.decided_by == null ? null : String(row.decided_by),
    };
  });
}

export async function decideApprovalRequest(input: {
  requestId: string; decision: 'approved' | 'denied'; decidedBy: string; nowMs?: number;
}): Promise<boolean> {
  const now = input.nowMs ?? Date.now();
  await ensureApprovalRequestSchema();
  const result = await getClient().execute({
    sql: `UPDATE approval_requests SET status = ?, decided_at = ?, decided_by = ?
          WHERE request_id = ? AND status = 'pending' AND expires_at > ?`,
    args: [input.decision, now, input.decidedBy, input.requestId, now],
  });
  return (result.rowsAffected ?? 0) === 1;
}
