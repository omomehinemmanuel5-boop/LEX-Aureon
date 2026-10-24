import { beforeEach, describe, expect, it, vi } from 'vitest';

const fakeDb = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('../lib/db', () => ({ getClient: () => fakeDb }));

import {
  consumeScopedGrant,
  createScopedGrant,
  findMatchingScopedGrant,
  revokeScopedGrant,
  scopedGrantMatchesAction,
  validateScopedGrantInput,
  type ScopedGrantRecord,
} from '../lib/scoped_grants';

const now = 1_800_000_000_000;
const grant: ScopedGrantRecord = {
  grant_id: 'grant-1',
  owner_id: 'owner-a',
  allowed_tools: ['create_branch', 'write_file', 'patch_file', 'open_pr'],
  branch_prefixes: ['govern/', 'fix/'],
  path_prefixes: ['docs/', 'lib/'],
  max_uses: 2,
  uses: 0,
  expires_at: now + 60 * 60 * 1000,
  revoked_at: null,
  created_at: now,
};

let rows: Array<Record<string, unknown>>;
let grantReceipts: Array<Record<string, unknown>>;

function installDb() {
  rows = [];
  grantReceipts = [];
  fakeDb.execute.mockImplementation(async (query: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof query === 'string' ? query : query.sql;
    const args = typeof query === 'string' ? [] : (query.args ?? []);
    if (sql.startsWith('INSERT INTO scoped_grants')) {
      rows.push({
        grant_id: args[0], owner_id: args[1], allowed_tools: args[2], branch_prefixes: args[3],
        path_prefixes: args[4], max_uses: args[5], uses: 0, expires_at: args[6], revoked_at: null, created_at: args[7],
      });
      return { rowsAffected: 1, rows: [] };
    }
    if (sql.startsWith('SELECT * FROM scoped_grants WHERE owner_id')) {
      return { rows: rows.filter(row => row.owner_id === args[0] && row.revoked_at === null
        && Number(row.expires_at) > Number(args[1]) && Number(row.uses) < Number(row.max_uses)).map(row => ({ ...row })) };
    }
    if (sql.startsWith('UPDATE scoped_grants SET revoked_at')) {
      const row = rows.find(item => item.grant_id === args[1] && item.revoked_at === null);
      if (!row) return { rowsAffected: 0, rows: [] };
      row.revoked_at = args[0];
      return { rowsAffected: 1, rows: [] };
    }
    return { rowsAffected: 0, rows: [] };
  });
  fakeDb.transaction.mockImplementation(async () => {
    const snapshot = rows.map(row => ({ ...row }));
    return {
      execute: async ({ sql, args = [] }: { sql: string; args?: unknown[] }) => {
        if (sql.startsWith('SELECT * FROM scoped_grants WHERE grant_id')) {
          const row = rows.find(item => item.grant_id === args[0] && item.owner_id === args[1]);
          return { rows: row ? [{ ...row }] : [] };
        }
        if (sql.includes('UPDATE scoped_grants SET uses = uses + 1')) {
          const row = rows.find(item => item.grant_id === args[0] && item.owner_id === args[1]
            && Number(item.uses) === Number(args[2]) && Number(item.uses) < Number(item.max_uses)
            && Number(item.expires_at) > Number(args[3]) && item.revoked_at === null);
          if (!row) return { rowsAffected: 0, rows: [] };
          row.uses = Number(row.uses) + 1;
          return { rowsAffected: 1, rows: [{ uses: row.uses }] };
        }
        if (sql.startsWith('INSERT INTO tool_receipts')) {
          grantReceipts.push({
            receipt_id: args[0], session_id: args[1], actor_id: args[2], tool_name: args[3],
            args_hash: args[4], reason: args[5], created_at: args[6], grant_id: args[7],
            grant_branch: args[8], grant_path: args[9], grant_use_number: args[10],
          });
          return { rowsAffected: 1, rows: [] };
        }
        return { rowsAffected: 0, rows: [] };
      },
      commit: async () => {},
      rollback: async () => { rows = snapshot; },
    };
  });
}

function action(toolName: string, args: Record<string, unknown>, ownerId = 'owner-a', nowMs = now) {
  return { ownerId, toolName, args, nowMs, sessionId: 'owner-a:session', actorId: `api_key:${ownerId}` };
}

describe('scoped branch grants — safety contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDb();
  });

  it('matches create_branch and write_file only inside the owner-approved govern/ scope', () => {
    expect(scopedGrantMatchesAction(grant, action('create_branch', { branch: 'govern/scoped' }))).toBe(true);
    expect(scopedGrantMatchesAction(grant, action('write_file', { branch: 'govern/scoped', path: 'docs/plan.md' }))).toBe(true);
  });

  it('allows one use and falls back after max_uses is exhausted', async () => {
    await createScopedGrant({ owner_id: 'owner-a', allowed_tools: ['create_branch'], path_prefixes: ['docs/'], max_uses: 1, expires_at: now + 30_000 }, true, now);
    const saved = rows[0];
    const input = { ...action('create_branch', { branch: 'govern/scoped' }), grantId: String(saved.grant_id) };
    expect(await consumeScopedGrant(input)).toMatchObject({ useNumber: 1, grantId: saved.grant_id });
    expect(await consumeScopedGrant(input)).toBeNull();
    expect(rows[0].uses).toBe(1);
  });

  it('rejects an expired grant without consuming a use', async () => {
    await createScopedGrant({ owner_id: 'owner-a', allowed_tools: ['create_branch'], path_prefixes: ['docs/'], max_uses: 2, expires_at: now + 10_000 }, true, now);
    const saved = rows[0];
    expect(await findMatchingScopedGrant(action('create_branch', { branch: 'govern/scoped' }, 'owner-a', now + 10_000))).toBeNull();
    expect(saved.uses).toBe(0);
  });

  it('rejects a revoked grant immediately', async () => {
    const saved = await createScopedGrant({ owner_id: 'owner-a', allowed_tools: ['create_branch'], path_prefixes: ['docs/'], max_uses: 2, expires_at: now + 30_000 }, true, now);
    expect(await revokeScopedGrant(saved.grant_id, true, now + 1)).toBe(true);
    expect(await findMatchingScopedGrant(action('create_branch', { branch: 'govern/scoped' }))).toBeNull();
    expect(await revokeScopedGrant(saved.grant_id, true, now + 2)).toBe(false);
  });

  it('never authorizes a branch named main', async () => {
    expect(scopedGrantMatchesAction(grant, action('create_branch', { branch: 'main' }))).toBe(false);
    expect(scopedGrantMatchesAction(grant, action('write_file', { branch: 'main', path: 'docs/plan.md' }))).toBe(false);
    expect(await findMatchingScopedGrant(action('create_branch', { branch: 'main' }))).toBeNull();
  });

  it('rejects a path outside the owner-approved path prefixes and traversal attempts', () => {
    expect(scopedGrantMatchesAction(grant, action('write_file', { branch: 'govern/scoped', path: 'app/api/route.ts' }))).toBe(false);
    expect(scopedGrantMatchesAction(grant, action('write_file', { branch: 'govern/scoped', path: 'docs/../.env' }))).toBe(false);
    expect(scopedGrantMatchesAction(grant, action('patch_file', { branch: 'govern/scoped', path: 'docs\\\\..\\\\.env' }))).toBe(false);
  });

  it('requires open_pr base main and a scoped non-main head', () => {
    expect(scopedGrantMatchesAction(grant, action('open_pr', { head: 'govern/scoped', base: 'release' }))).toBe(false);
    expect(scopedGrantMatchesAction(grant, action('open_pr', { head: 'main', base: 'main' }))).toBe(false);
    expect(scopedGrantMatchesAction(grant, action('open_pr', { head: 'govern/scoped', base: 'main' }))).toBe(true);
  });

  it('does not authorize tools outside the four-tool allowlist', () => {
    expect(scopedGrantMatchesAction(grant, action('dispatch_workflow', { branch: 'govern/scoped' }))).toBe(false);
  });

  it('does not match a grant owned by another caller', () => {
    expect(scopedGrantMatchesAction(grant, action('create_branch', { branch: 'govern/scoped' }, 'owner-b'))).toBe(false);
  });

  it('rejects expiry more than 60 minutes ahead', () => {
    expect(() => validateScopedGrantInput({
      owner_id: 'owner-a', allowed_tools: ['create_branch'], path_prefixes: ['docs/'],
      expires_at: now + 60 * 60 * 1000 + 1, max_uses: 1,
    }, now)).toThrow(/60 minutes/i);
  });

  it('rejects branch prefixes containing main', () => {
    expect(() => validateScopedGrantInput({
      owner_id: 'owner-a', allowed_tools: ['create_branch'], path_prefixes: ['docs/'],
      branch_prefixes: ['main'], expires_at: now + 30_000, max_uses: 1,
    }, now)).toThrow(/main/i);
  });

  it('does not consume a grant when the recovery gate denies the action', async () => {
    await createScopedGrant({ owner_id: 'owner-a', allowed_tools: ['create_branch'], path_prefixes: ['docs/'], max_uses: 2, expires_at: now + 30_000 }, true, now);
    const saved = rows[0];
    expect(await consumeScopedGrant({
      ...action('create_branch', { branch: 'govern/scoped' }), grantId: String(saved.grant_id), recoveryAllowed: false,
    })).toBeNull();
    expect(rows[0].uses).toBe(0);
    expect(grantReceipts).toHaveLength(0);
  });

  it('writes exactly one receipt containing grant_id and the allocated use number', async () => {
    const saved = await createScopedGrant({ owner_id: 'owner-a', allowed_tools: ['write_file'], path_prefixes: ['docs/'], max_uses: 2, expires_at: now + 30_000 }, true, now);
    const result = await consumeScopedGrant({
      ...action('write_file', { branch: 'govern/scoped', path: 'docs/plan.md' }),
      grantId: saved.grant_id,
    });
    expect(result?.useNumber).toBe(1);
    expect(grantReceipts).toHaveLength(1);
    expect(grantReceipts[0]).toMatchObject({
      grant_id: saved.grant_id, tool_name: 'write_file', grant_branch: 'govern/scoped',
      grant_path: 'docs/plan.md', grant_use_number: 1,
    });
  });

  it('rejects creation with an unapproved tool', () => {
    expect(() => validateScopedGrantInput({
      owner_id: 'owner-a', allowed_tools: ['dispatch_workflow'], path_prefixes: ['docs/'],
      expires_at: now + 30_000, max_uses: 1,
    }, now)).toThrow(/allowed_tools/i);
  });

  it('requires operator authority for creation and revocation', async () => {
    await expect(createScopedGrant({
      owner_id: 'owner-a', allowed_tools: ['create_branch'], path_prefixes: ['docs/'],
      expires_at: now + 30_000, max_uses: 1,
    }, false, now)).rejects.toThrow(/operator/i);
    await expect(revokeScopedGrant('grant-1', false, now)).rejects.toThrow(/operator/i);
  });
});
