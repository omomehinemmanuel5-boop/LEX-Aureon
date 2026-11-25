import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../lib/db', () => ({ getClient: () => ({ execute }) }));

import { decideApprovalRequestByLink, getApprovalRequestForLink } from '../lib/approval_link';

const requestId = 'a'.repeat(22);
const row = {
  request_id: requestId,
  owner_id: 'owner-a',
  tenant_id: 'tenant-a',
  session_id: 'owner-a:session-1',
  tool_name: 'write_file',
  args_json: '{"path":"README.md"}',
  status: 'pending',
  created_at: 1_800_000_000_000,
  expires_at: 1_800_000_900_000,
};

describe('tenant-scoped bearer approval links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({ rows: [row], rowsAffected: 1 });
  });

  it('loads only a request with a persisted tenant binding', async () => {
    const result = await getApprovalRequestForLink(requestId, 1_800_000_100_000);
    expect(result).toMatchObject({ request_id: requestId, tool_name: 'write_file', status: 'pending' });
    const select = execute.mock.calls.find(([query]) =>
      typeof query !== 'string' && query.sql.includes('FROM approval_requests'))?.[0] as { sql: string; args: unknown[] };
    expect(select.sql).toContain('tenant_id IS NOT NULL');
    expect(select.args).toEqual([requestId]);
  });

  it('rejects malformed identifiers without querying storage', async () => {
    expect(await getApprovalRequestForLink('../not-a-request')).toBeNull();
    expect(await decideApprovalRequestByLink({ requestId: 'bad', decision: 'approved' })).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('marks expired pending requests as expired without authorizing them', async () => {
    const result = await getApprovalRequestForLink(requestId, row.expires_at);
    expect(result?.status).toBe('expired');
  });

  it('decides only tenant-bound, pending, unexpired requests in one conditional update', async () => {
    expect(await decideApprovalRequestByLink({
      requestId,
      decision: 'approved',
      nowMs: 1_800_000_100_000,
    })).toBe(true);
    const update = execute.mock.calls.find(([query]) =>
      typeof query !== 'string' && query.sql.startsWith('UPDATE approval_requests'))?.[0] as { sql: string; args: unknown[] };
    expect(update.sql).toContain('tenant_id IS NOT NULL');
    expect(update.sql).toContain("status = 'pending'");
    expect(update.sql).toContain('expires_at > ?');
    expect(update.sql).toContain("decided_by = 'approval_link'");
    expect(update.args).toEqual(['approved', 1_800_000_100_000, requestId, 1_800_000_100_000]);
  });

  it('fails closed when the conditional update affects no row', async () => {
    execute.mockResolvedValue({ rows: [], rowsAffected: 0 });
    expect(await decideApprovalRequestByLink({ requestId, decision: 'denied' })).toBe(false);
  });
});
