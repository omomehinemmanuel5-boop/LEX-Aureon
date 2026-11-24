import { beforeEach, describe, expect, it, vi } from 'vitest';

const { accountFromCookie, getKeysByTenantId, generateApiKey, revokeKeyForTenant, isTrustedApprovalOrigin } = vi.hoisted(() => ({
  accountFromCookie: vi.fn(),
  getKeysByTenantId: vi.fn(),
  generateApiKey: vi.fn(),
  revokeKeyForTenant: vi.fn(),
  isTrustedApprovalOrigin: vi.fn(),
}));

vi.mock('@/lib/auth_accounts', () => ({ accountFromCookie }));
vi.mock('@/lib/api_keys', () => ({ getKeysByTenantId, generateApiKey, revokeKeyForTenant }));
vi.mock('@/lib/security/approval_origin', () => ({ isTrustedApprovalOrigin }));

import { GET, POST } from '../app/api/keys/route';
import { DELETE } from '../app/api/keys/revoke/route';

const account = { id: 'user-1', email: 'owner@example.com', name: 'Owner', tenantId: 'tenant-one', plan: 'free' as const };
const createdKey = {
  id: 'key-one', key: 'lex_sk_secret', name: 'Production', plan: 'free', runs_limit: 1000, expires_at: null,
};

function request(method: string, path: string, body?: unknown, cookie = 'lex_account_session=session') {
  return new Request(`https://lexaureon.com${path}`, {
    method,
    headers: { Origin: 'https://lexaureon.com', Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('tenant-scoped API key routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTrustedApprovalOrigin.mockReturnValue(true);
    accountFromCookie.mockResolvedValue(account);
    getKeysByTenantId.mockResolvedValue([]);
    generateApiKey.mockResolvedValue(createdKey);
    revokeKeyForTenant.mockResolvedValue(true);
  });

  it('requires an authenticated verified account before creating a key', async () => {
    accountFromCookie.mockResolvedValue(null);
    const response = await POST(request('POST', '/api/keys', { name: 'Production' }));
    expect(response.status).toBe(401);
    expect(generateApiKey).not.toHaveBeenCalled();
  });

  it('creates keys only inside the signed-in account tenant', async () => {
    const response = await POST(request('POST', '/api/keys', { name: 'Production' }));
    expect(response.status).toBe(200);
    expect(generateApiKey).toHaveBeenCalledWith({
      email: account.email, name: 'Production', plan: 'free', tenantId: account.tenantId,
    });
    expect(JSON.stringify(await response.json())).toContain(createdKey.key);
  });

  it('lists only keys belonging to the signed-in account tenant', async () => {
    const response = await GET(request('GET', '/api/keys'));
    expect(response.status).toBe(200);
    expect(getKeysByTenantId).toHaveBeenCalledWith(account.tenantId);
  });

  it('revokes only through the signed-in account tenant binding', async () => {
    const response = await DELETE(request('DELETE', '/api/keys/revoke', { id: 'key-one' }));
    expect(response.status).toBe(200);
    expect(revokeKeyForTenant).toHaveBeenCalledWith('key-one', account.tenantId);
  });
});
