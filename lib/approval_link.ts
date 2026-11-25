import { getClient } from './db';
import { ensureApprovalRequestSchema, type ApprovalRequestStatus } from './approval_requests';

export interface ApprovalLinkRequest {
  request_id: string;
  owner_id: string;
  tenant_id: string;
  session_id: string;
  tool_name: string;
  args_json: string;
  status: ApprovalRequestStatus;
  created_at: number;
  expires_at: number;
}

/**
 * A direct approval URL is a short-lived bearer capability. Its random request
 * ID identifies exactly one request, and the row must already be tenant-bound.
 * No tenant identifier is accepted from the browser.
 */
export async function getApprovalRequestForLink(
  requestId: string,
  nowMs = Date.now(),
): Promise<ApprovalLinkRequest | null> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(requestId)) return null;
  await ensureApprovalRequestSchema();
  const result = await getClient().execute({
    sql: `SELECT request_id, owner_id, tenant_id, session_id, tool_name, args_json, status, created_at, expires_at
          FROM approval_requests
          WHERE request_id = ? AND tenant_id IS NOT NULL
          LIMIT 1`,
    args: [requestId],
  });
  const row = result.rows[0];
  if (!row) return null;
  const storedStatus = String(row.status) as Exclude<ApprovalRequestStatus, 'expired'>;
  return {
    request_id: String(row.request_id),
    owner_id: String(row.owner_id),
    tenant_id: String(row.tenant_id),
    session_id: String(row.session_id),
    tool_name: String(row.tool_name),
    args_json: String(row.args_json),
    status: storedStatus === 'pending' && nowMs >= Number(row.expires_at) ? 'expired' : storedStatus,
    created_at: Number(row.created_at),
    expires_at: Number(row.expires_at),
  };
}

/**
 * Decide through possession of the unguessable request URL. The tenant binding
 * is enforced in the same conditional UPDATE as expiry and single-use status.
 * The caller cannot supply or select a tenant, owner, tool, or argument hash.
 */
export async function decideApprovalRequestByLink(input: {
  requestId: string;
  decision: 'approved' | 'denied';
  nowMs?: number;
}): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{22}$/.test(input.requestId)) return false;
  const now = input.nowMs ?? Date.now();
  await ensureApprovalRequestSchema();
  const result = await getClient().execute({
    sql: `UPDATE approval_requests
          SET status = ?, decided_at = ?, decided_by = 'approval_link'
          WHERE request_id = ? AND tenant_id IS NOT NULL
            AND status = 'pending' AND expires_at > ?`,
    args: [input.decision, now, input.requestId, now],
  });
  return (result.rowsAffected ?? 0) === 1;
}
