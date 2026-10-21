import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../lib/db', () => ({ getClient: () => ({ execute }) }));

import {
  approvalArgsHash,
  consumeApprovalRequest,
  createApprovalRequest,
  decideApprovalRequest,
} from '../lib/approval_requests';

let row: Record<string, unknown> | null;

function installDb() {
  execute.mockImplementation(async (query: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof query === 'string' ? query : query.sql;
    const args = typeof query === 'string' ? [] : (query.args ?? []);
    if (sql.startsWith('INSERT INTO approval_requests')) {
      row = {
        request_id: args[0], owner_id: args[1], session_id: args[2], tool_name: args[3],
        args_hash: args[4], args_json: args[5], status: 'pending', created_at: args[6], expires_at: args[7],
        decided_at: null, decided_by: null,
      };
      return { rowsAffected: 1, rows: [] };
    }
    if (sql.includes('FROM approval_requests WHERE request_id = ?')) {
      return { rows: row && row.request_id === args[0] ? [{ ...row }] : [] };
    }
    if (sql.startsWith("UPDATE approval_requests SET status = 'used'")) {
      if (row && row.request_id === args[0] && row.owner_id === args[1] && row.session_id === args[2]
        && row.tool_name === args[3] && row.args_hash === args[4] && row.status === 'approved'
        && Number(row.expires_at) > Number(args[5])) {
        row.status = 'used';
        return { rowsAffected: 1, rows: [] };
      }
      return { rowsAffected: 0, rows: [] };
    }
    if (sql.startsWith('UPDATE approval_requests SET status = ?, decided_at = ?, decided_by = ?')) {
      if (row && row.request_id === args[3] && row.status === 'pending' && Number(row.expires_at) > Number(args[4])) {
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
    expect(await decideApprovalRequest({ requestId: created.requestId, decision: 'approved', decidedBy: 'operator' })).toBe(true);
    expect(row).toMatchObject({ status: 'approved', decided_by: 'operator' });
    const consumed = await consumeApprovalRequest({ requestId: created.requestId, ...requestInput });
    expect(consumed.consumed).toBe(true);
    expect(row?.status).toBe('used');
  });

  it('binds branch and every PR-defining field into the approval hash', async () => {
    const action = {
      ownerId: 'owner-a',
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

  it('denies a mismatched session or tool and an expired request', async () => {
    const created = await createApprovalRequest(requestInput);
    row!.status = 'approved';
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...requestInput, sessionId: 'owner-a:other' })).consumed).toBe(false);
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...requestInput, toolName: 'dispatch_workflow' })).consumed).toBe(false);
    expect((await consumeApprovalRequest({ requestId: created.requestId, ...requestInput, nowMs: created.expiresAt })).consumed).toBe(false);
    expect(row?.status).toBe('approved');
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
