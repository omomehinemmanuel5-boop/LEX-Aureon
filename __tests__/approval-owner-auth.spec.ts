import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, initApiKeySchema, state } = vi.hoisted(() => ({
  execute: vi.fn(),
  initApiKeySchema: vi.fn(async () => {}),
  state: { owner: null as null | { id: string; key_hash: string; expires_at: number | null } },
}));
vi.mock('../lib/db', () => ({ getClient: () => ({ execute }) }));
vi.mock('../lib/api_keys', () => ({ initApiKeySchema }));

import {
  APPROVAL_OWNER_SESSION_TTL_SECONDS,
  approvalOwnerFromCookie,
  authenticateApprovalOwner,
  createApprovalOwnerCookie,
} from '../lib/approval_owner_auth';

const rawKey = 'lex_sk_0123456789abcdefghijklmnopqrstuv';
const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

describe('owner-only approval authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.owner = { id: 'owner-a', key_hash: keyHash, expires_at: null };
    execute.mockImplementation(async (query: { sql: string; args?: unknown[] }) => {
      if (query.sql.includes('WHERE key_hash = ?')) {
        return { rows: state.owner?.key_hash === query.args?.[0] ? [{ ...state.owner }] : [] };
      }
      if (query.sql.includes('WHERE id = ?')) {
        return { rows: state.owner?.id === query.args?.[0] ? [{ ...state.owner }] : [] };
      }
      return { rows: [] };
    });
  });

  it('authenticates a valid owner key without checking or consuming API quota', async () => {
    await expect(authenticateApprovalOwner(rawKey)).resolves.toMatchObject({ ownerId: 'owner-a', signingKey: keyHash });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining('WHERE key_hash = ?'),
      args: [keyHash],
    }));
    expect(String(execute.mock.calls[0][0].sql)).not.toMatch(/runs_used|runs_limit/);
  });

  it('rejects malformed, invalid, and expired API keys', async () => {
    await expect(authenticateApprovalOwner('too-short')).resolves.toBeNull();
    await expect(authenticateApprovalOwner(`${rawKey}wrong`)).resolves.toBeNull();
    state.owner!.expires_at = Date.now() - 1;
    await expect(authenticateApprovalOwner(rawKey)).resolves.toBeNull();
  });

  it('issues an HttpOnly secure owner cookie that is bound to the API key hash and expires', async () => {
    const owner = { ownerId: 'owner-a', signingKey: keyHash };
    const cookie = createApprovalOwnerCookie(owner, 1_000);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Max-Age=${APPROVAL_OWNER_SESSION_TTL_SECONDS}`);
    expect(cookie).not.toContain(rawKey);
    const cookiePair = cookie.split(';')[0];
    await expect(approvalOwnerFromCookie(cookiePair, 1_001)).resolves.toBe('owner-a');
    await expect(approvalOwnerFromCookie(cookiePair, 1_000 + APPROVAL_OWNER_SESSION_TTL_SECONDS * 1000 + 1)).resolves.toBeNull();
  });

  it('invalidates existing owner sessions when the API key is revoked or rotated', async () => {
    const cookiePair = createApprovalOwnerCookie({ ownerId: 'owner-a', signingKey: keyHash }, 1_000).split(';')[0];
    state.owner = null;
    await expect(approvalOwnerFromCookie(cookiePair, 1_001)).resolves.toBeNull();
    state.owner = { id: 'owner-a', key_hash: 'rotated-hash', expires_at: null };
    await expect(approvalOwnerFromCookie(cookiePair, 1_001)).resolves.toBeNull();
  });
});
