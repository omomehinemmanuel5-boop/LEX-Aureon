import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getApiKeyById } = vi.hoisted(() => ({ getApiKeyById: vi.fn() }));
vi.mock('../lib/api_keys', () => ({ getApiKeyById }));
vi.mock('../lib/env', () => ({ env: { TURSO_AUTH_TOKEN: 'session-test-secret', MCP_OPERATOR_SECRET: undefined } }));

import { issueMcpSession, validateMcpSession } from '../lib/mcp_sessions';

const key = {
  id: 'key-1', key: '', key_preview: 'lex_sk_ab...wxyz', name: 'test', email: 'test@example.com',
  plan: 'private_test' as const, runs_used: 0, runs_limit: 100, created_at: Date.now(), last_used_at: null, expires_at: null,
};

describe('MCP sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApiKeyById.mockResolvedValue(key);
  });

  it('issues a short-lived signed session and revalidates the backing key', async () => {
    const session = issueMcpSession(key);
    expect(session?.token.split('.')).toHaveLength(2);
    expect(session!.expiresAt).toBeGreaterThan(Date.now());
    const checked = await validateMcpSession(session!.token);
    expect(checked).toMatchObject({ valid: true, key: { id: 'key-1', plan: 'private_test' } });
  });

  it('rejects tampering and an expired session', async () => {
    const session = issueMcpSession(key)!;
    expect((await validateMcpSession(`${session.token}x`)).valid).toBe(false);
    const now = Date.now;
    Date.now = () => now() + 16 * 60 * 1000;
    try { expect((await validateMcpSession(session.token)).valid).toBe(false); } finally { Date.now = now; }
  });
});
