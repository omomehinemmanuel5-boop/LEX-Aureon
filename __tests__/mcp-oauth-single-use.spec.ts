import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  batch: vi.fn(),
  getApiKeyById: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  getClient: () => ({ execute: mocks.execute, batch: mocks.batch }),
}));
vi.mock('@/lib/api_keys', () => ({
  getApiKeyById: mocks.getApiKeyById,
  validateApiKey: vi.fn(),
  getKeysByTenantId: vi.fn(),
  generateApiKey: vi.fn(),
}));
vi.mock('@/lib/auth_accounts', () => ({
  accountFromCookie: vi.fn(),
}));

import { exchangeAuthorizationCode, refreshAccessToken, MCP_RESOURCE } from '@/lib/mcp_oauth';

const KEY = { id: 'key_12345678' };
const VERIFIER = 'a sufficiently long PKCE verifier for the test';
const CHALLENGE = crypto.createHash('sha256').update(VERIFIER).digest('base64url');

describe('OAuth single-use credential transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.batch.mockResolvedValue([]);
    mocks.getApiKeyById.mockResolvedValue(KEY);
  });

  it('atomically consumes an authorization code so a replay cannot mint another token pair', async () => {
    let claimed = false;
    mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes('DELETE FROM mcp_oauth_codes')) {
        if (claimed) return { rows: [] };
        claimed = true;
        return { rows: [{
          client_id: 'client_123',
          redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
          resource: MCP_RESOURCE,
          code_challenge: CHALLENGE,
          expires_at: Date.now() + 60_000,
          key_id: KEY.id,
          scope: 'mcp',
        }] };
      }
      return { rows: [], rowsAffected: 1 };
    });

    const input = {
      code: 'lex_code_one_time',
      clientId: 'client_123',
      redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      codeVerifier: VERIFIER,
      resource: MCP_RESOURCE,
    };
    const first = await exchangeAuthorizationCode(input);
    const replay = await exchangeAuthorizationCode(input);

    expect(first).toHaveProperty('access_token');
    expect(replay).toEqual({ error: 'invalid_grant' });
    const claim = mocks.execute.mock.calls.find(([arg]) => arg.sql.includes('DELETE FROM mcp_oauth_codes'))?.[0].sql;
    expect(claim).toContain('RETURNING *');
    expect(claim).toContain('client_id = ?');
    expect(claim).toContain('redirect_uri = ?');
  });

  it('atomically rotates a refresh token so concurrent/replayed refreshes cannot both succeed', async () => {
    let rotated = false;
    mocks.execute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes('UPDATE mcp_oauth_tokens SET revoked_at')) {
        if (rotated) return { rows: [] };
        rotated = true;
        return { rows: [{
          client_id: 'client_123',
          resource: MCP_RESOURCE,
          revoked_at: Date.now(),
          refresh_expires_at: Date.now() + 60_000,
          key_id: KEY.id,
          scope: 'mcp',
        }] };
      }
      return { rows: [], rowsAffected: 1 };
    });

    const input = { refreshToken: 'lex_rt_one_time', clientId: 'client_123', resource: MCP_RESOURCE };
    const first = await refreshAccessToken(input);
    const replay = await refreshAccessToken(input);

    expect(first).toHaveProperty('access_token');
    expect(replay).toEqual({ error: 'invalid_grant' });
    const rotate = mocks.execute.mock.calls.find(([arg]) => arg.sql.includes('UPDATE mcp_oauth_tokens SET revoked_at'))?.[0].sql;
    expect(rotate).toContain('RETURNING *');
    expect(rotate).toContain('revoked_at IS NULL');
    expect(rotate).toContain('client_id = ?');
    expect(rotate).toContain('resource = ?');
  });
});
