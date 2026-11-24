import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, batch } = vi.hoisted(() => ({ execute: vi.fn(), batch: vi.fn() }));
vi.mock('../lib/db', () => ({ getClient: () => ({ execute, batch }) }));
vi.mock('../lib/api_keys', () => ({ initApiKeySchema: vi.fn(async () => {}) }));

import {
  ACCOUNT_SESSION_TTL_SECONDS,
  accountFromCookie,
  createAccountSessionCookie,
  hashAccountPassword,
  verifyAccountPassword,
  type AccountUser,
} from '../lib/auth_accounts';

const user: AccountUser = {
  id: 'user_12345678',
  email: 'owner@example.com',
  name: 'Owner Company',
  tenantId: 'tn_user_12345678',
  plan: 'free',
};
const SESSION_SECRET = 'test-account-session-secret-at-least-32-chars';

describe('verified account credentials', () => {
  beforeEach(() => {
    vi.stubEnv('MCP_SESSION_SECRET', SESSION_SECRET);
    vi.stubEnv('NODE_ENV', 'test');
    vi.clearAllMocks();
    batch.mockResolvedValue([]);
    execute.mockResolvedValue({ rows: [{ id: user.id, email: user.email, company_name: user.name, tenant_id: user.tenantId }], rowsAffected: 1 });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('stores only a salted scrypt digest and verifies passwords without plaintext storage', async () => {
    const digest = await hashAccountPassword('a-long-test-password');
    expect(digest).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(digest).not.toContain('a-long-test-password');
    expect(await verifyAccountPassword('a-long-test-password', digest)).toBe(true);
    expect(await verifyAccountPassword('wrong-password', digest)).toBe(false);
  });

  it('creates a signed HttpOnly SameSite cookie and resolves only active verified tenant owners', async () => {
    const cookie = createAccountSessionCookie(user, 1_000);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain(`Max-Age=${ACCOUNT_SESSION_TTL_SECONDS}`);
    expect(cookie).not.toContain(user.email);
    const pair = cookie.split(';')[0];
    await expect(accountFromCookie(pair, 2_000)).resolves.toMatchObject({ id: user.id, tenantId: user.tenantId });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      sql: expect.stringContaining("m.role = 'owner' AND m.status = 'active'"),
      args: [user.id, user.tenantId],
    }));
    await expect(accountFromCookie(pair, 1_000 + ACCOUNT_SESSION_TTL_SECONDS * 1000 + 1)).resolves.toBeNull();
  });

  it('rejects a modified signature before querying the account store', async () => {
    const cookie = createAccountSessionCookie(user, 1_000).split(';')[0];
    const tampered = cookie.replace(/.$/, cookie.endsWith('a') ? 'b' : 'a');
    execute.mockClear();
    await expect(accountFromCookie(tampered, 2_000)).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('returns no session when the user no longer has an active owner membership', async () => {
    const cookie = createAccountSessionCookie(user, 1_000).split(';')[0];
    execute.mockResolvedValue({ rows: [] });
    await expect(accountFromCookie(cookie, 2_000)).resolves.toBeNull();
  });
});
