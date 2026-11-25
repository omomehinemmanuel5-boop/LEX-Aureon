import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../lib/db', () => ({ getClient: () => ({ execute }) }));

import {
  approvalArgsHash,
  consumeApprovalRequest,
  releaseConsumedApprovalRequest,
  createApprovalRequest,
  getApprovalRequestStatus,
  decideApprovalRequest,
  listApprovalRequests,
} from '../lib/approval_requests';

let row: Record<string, unknown> | null;

function installDb() {
  execute.mockImplementation(async (query: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof query === 'string' ? query : query.sql;
    const args = typeof query === 'string' ? [] : (query.args ?? []);
    if (sql.startsWith('INSERT INTO approval_requests')) {
      row = {
        request_id: args[0], owner_id: args[1], tenant_id: args[2], session_id: args[3], tool_name: args[4],
        args_hash: args[5], args_json: args[6], status: 'pending', created_at: args[7], expires_at: args[8],
        decided_at: null, decided_by: null,
      };
      return { rowsAffected: 1, rows: [] };
    }
    if (sql.includes('FROM approval_requests WHERE request_id = ?')) {
      return { rows: row && row.request_id === args[0] ? [{ ...row }] : [] };
    }
    if (sql.startsWith("UPDATE approval_requests SET status = 'used'")) {
      if (row && row.request_id === args[0] && row.owner_id === args[1] && row.tenant_id === args[2] && row.session_id === args[3]
        && row.tool_name === args[4] && row.args_hash === args[5] && row.status === 'approved'
        && Number(row.expires_at) > Number(args[6])) {
        row.status = 'used';
        return { rowsAffected: 1, rows: [] };
      }
      return { rowsAffected: 0, rows: [] };
    }
    if (sql.startsWith("UPDATE approval_requests SET status = 'approved'")) {
      if (row && row.request_id === args[0] && row.owner_id === args[1] && row.tenant_id === args[2]
        && row.session_id === args[3] && row.tool_name === args[4] && row.status === 'used'
        && row.args_hash === args[5]) {
        row.status = 'approved';
        return { rowsAffected: 1, rows: [] };
      }
      return { rowsAffected: 0, rows: [] };
    }
    if (sql.startsWith('UPDATE approval_requests SET status = ?, decided_at = ?, decided_by = ?')) {
      if (row && row.request_id === args[3] && row.tenant_id === args[4]
        && row.status === 'pending' && Number(row.expires_at) > Number(args[5])) {
        row.status = args[0];
        row.decided_at = args[1];
        row.decided_by = args[2];
        return { rowsAffected: 1, rows: [] };
      }
      return { rowsAffected: 0, rows: [] };
    }
    return { rowsAffected: 0, rows: [] };
  });
}

const requestInput = {
  ownerId: 'owner-a',
  tenantId: 'tenant-a',
  sessionId: 'owner-a:session-1',
  toolName: 'write_file',
  args: { path: 'README.md', content: 'hello', message: 'test', session_id: 'owner-a:session-1' },
};

describe('one-tap approval request persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    row = null;
    installDb();
  });

  it('uses one deterministic hash across creation and execution despite approval metadata and property order', async () => {
    const created = await createApprovalRequest(requestInput);
    expect(approvalArgsHash({
      message: 'test', session_id: 'owner-a:session-1', path: 'README.md', content: 'hello',
      approval_request_id: created.requestId, approval_token: 'placeholder',
    })).toBe(String(row?.args_hash));
  });

  it('creates only pending requests and refuses an ungated tool', async () => {
    await createApprovalRequest({ ...requestInput, status: 'approved' } as typeof requestInput);
    expect(row?.status).toBe('pending');
    await expect(createApprovalRequest({ ...requestInput, toolName: 'read_file' })).rejects.toThrow('does not require operator approval');
    await expect(createApprovalRequest({ ...requestInput, toolName: 'request_approval' })).rejects.toThrow('does not require operator approval');
  });

  it('reports the existing exact-action status without consuming the approval', async () => {
    const created = await createApprovalRequest(requestInput);
    row!.status = 'approved';
    expect(await getApprovalRequestStatus({ requestId: created.requestId, ...requestInput })).toEqual({ status: 'approved' });
    expect(row?.status).toBe('approved');
    expect((await getApprovalRequestStatus({
      requestId: created.requestId, ...requestInput, args: { ...requestInput.args, content: 'changed' },
    })).status).toBe('invalid');
    expect((await getApprovalRequestStatus({
      requestId: created.requestId, ...requestInput, nowMs: created.expiresAt,
    })).status).toBe('expired');
    expect(row?.status).toBe('approved');
  });

  it('rejects a pending approval without consuming it', async () => {
    const created = await createApprovalRequest(requestInput);
    const result = await consumeApprovalRequest({ requestId: created.requestId, ...requestInput });
    expect(result.consumed).toBe(false);
    expect(row?.status).toBe('pending');
  });

  it('consumes an approved exact action once and denies replay', async () => {
    const created = await createApprovalRequest(requestInput);
    row!.status = 'approved';
    const input = { requestId: created.requestId, ...requestInput, args: requestInput.args };
    expect((await consumeApprovalRequest(input)).consumed).toBe(true);
    expect(row?.status).toBe('used');
    expect((await consumeApprovalRequest(input)).consumed).toBe(false);
  });

  it('carries one request from pending through operator approval to its first successful consumption', async () => {
    const created = await createApprovalRequest(requestInput);
    expect(row?.status).toBe('pending');
    expect(await decideApprovalRequest({ requestId: created.requestId, tenantId: 'tenant-a', decision: 'approved', decidedBy: 'user:user-a' })).toBe(true);
    expect(row).toMatchObject({ status: 'approved', decided_by: 'user:user-a' });
    const consumed = await consumeApprovalRequest({ requestId: created.requestId, ...requestInput });
    expect(consumed.consumed).toBe(true);
    expect(row?.status).toBe('used');
  });

  it('binds branch and every PR-defining field into the approval hash', async () => {
    const action = {
      ownerId: 'owner-a',
      tenantId: 'tenant-a',
      sessionId: 'owner-a:session-1',
      toolName: 'open_pr',
      args: {
        head: 'fix/branch-tools',
        base: 'main',
        title: 'Add branch tools',
        body: 'Reviewable changes',
        session_id: 'owner-a:session-1',
      },
    };
    const created = await createApprovalRequest(action);
    row!.status = 'approved';
    const changedFields = [
      { ...action.args, head: 'fix/other' },
      { ...action.args, base: 'release' },
      { ...action.args, title: 'Different title' },
      { ...action.args, body: 'Different body' },
    ];
    for (const args of changedFields) {
      expect((await consumeApprovalRequest({ requestId: created.requestId, ...action, args })).consumed).toBe(false);
    }
    expect(row?.status).toBe('approved');
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...action })).consumed).toBe(true);
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...action })).consumed).toBe(false);
  });

  it('rejects a changed create_branch target when retrying an approved request', async () => {
    const action = {
      ownerId: 'owner-a',
      tenantId: 'tenant-a',
      sessionId: 'owner-a:session-1',
      toolName: 'create_branch',
      args: { branch: 'fix/original', from_branch: 'main', session_id: 'owner-a:session-1' },
    };
    const created = await createApprovalRequest(action);
    row!.status = 'approved';
    expect((await consumeApprovalRequest({
      requestId: created.requestId,
      ...action,
      args: { ...action.args, branch: 'fix/changed' },
    })).consumed).toBe(false);
    expect(row?.status).toBe('approved');
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...action })).consumed).toBe(true);
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...action })).consumed).toBe(false);
  });

  it('denies changed arguments and a different owner', async () => {
    const created = await createApprovalRequest(requestInput);
    row!.status = 'approved';
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...requestInput, args: { ...requestInput.args, content: 'changed' } })).consumed).toBe(false);
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...requestInput, ownerId: 'owner-b' })).consumed).toBe(false);
    expect(row?.status).toBe('approved');
  });

  it('denies a different tenant even when owner, session, tool, and arguments match', async () => {
    const created = await createApprovalRequest(requestInput);
    row!.status = 'approved';
    const result = await consumeApprovalRequest({ requestId: created.requestId, ...requestInput, tenantId: 'tenant-b' });
    expect(result.consumed).toBe(false);
    expect(result.reason).toContain('another tenant');
    expect(row?.status).toBe('approved');
  });

  it('denies a mismatched session or tool and an expired request', async () => {
    const created = await createApprovalRequest(requestInput);
    row!.status = 'approved';
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...requestInput, sessionId: 'owner-a:other' })).consumed).toBe(false);
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...requestInput, toolName: 'dispatch_workflow' })).consumed).toBe(false);
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...requestInput, nowMs: created.expiresAt })).consumed).toBe(false);
    expect(row?.status).toBe('approved');
  });

  it('restores a consumed approval only within its original tenant', async () => {
    const created = await createApprovalRequest(requestInput);
    row!.status = 'used';
    expect(await releaseConsumedApprovalRequest({ requestId: created.requestId, ...requestInput, tenantId: 'tenant-b' })).toBe(false);
    expect(row?.status).toBe('used');
    expect(await releaseConsumedApprovalRequest({ requestId: created.requestId, ...requestInput })).toBe(true);
    expect(row?.status).toBe('approved');
  });

  it('queries approval history with the authenticated tenant ID', async () => {
    await createApprovalRequest(requestInput);
    await listApprovalRequests('tenant-a');
    const listQuery = execute.mock.calls.find(([query]) =>
      typeof query !== 'string' && query.sql.includes('FROM approval_requests WHERE tenant_id = ?'))?.[0];
    expect(listQuery).toMatchObject({ args: ['tenant-a', 100] });
    expect(String((listQuery as { sql: string }).sql)).toContain('ORDER BY created_at DESC');
  });

  it('cannot decide another owner’s request even with the correct request ID', async () => {
    const created = await createApprovalRequest(requestInput);
    expect(await decideApprovalRequest({
      requestId: created.requestId,
      tenantId: 'tenant-b',
      decision: 'approved',
      decidedBy: 'user:user-b',
    })).toBe(false);
    expect(row?.status).toBe('pending');
  });

  it('allows exactly one of two concurrent consumers to win the conditional update', async () => {
    const created = await createApprovalRequest(requestInput);
    row!.status = 'approved';
    const input = { requestId: created.requestId, ...requestInput };
    const outcomes = await Promise.all([consumeApprovalRequest(input), consumeApprovalRequest(input)]);
    expect(outcomes.filter(outcome => outcome.consumed)).toHaveLength(1);
    expect(row?.status).toBe('used');
  });
});
