import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getApiKeyById, dbExecute } = vi.hoisted(() => ({
  getApiKeyById: vi.fn(),
  dbExecute: vi.fn(),
}));
vi.mock('../lib/api_keys', () => ({ getApiKeyById }));
vi.mock('../lib/db', () => ({ getClient: () => ({ execute: dbExecute }) }));

import {
  issueMcpSession,
  refreshMcpSession,
  validateMcpSession,
  REFRESH_MAX_LIFETIME_MS,
  SESSION_TTL_MS,
} from '../lib/mcp_sessions';

const key = {
  id: 'key-1', key: '', key_preview: 'lex_sk_ab...wxyz', name: 'test', email: 'test@example.com',
  plan: 'private_test' as const, runs_used: 0, runs_limit: 100, created_at: Date.now(), last_used_at: null, expires_at: null,
};

describe('MCP sessions', () => {
  let refreshHash = '';
  let refreshRow: { key_id: string; issued_at: number; expires_at: number; used_at: number | null } | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MCP_SESSION_SECRET', 'session-test-secret');
    getApiKeyById.mockResolvedValue(key);
    refreshRow = null;
    dbExecute.mockImplementation(async (query: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof query === 'string' ? query : query.sql;
      const args = typeof query === 'string' ? [] : query.args ?? [];
      if (sql.includes('INSERT INTO mcp_session_refresh_tokens')) {
        refreshHash = String(args[0]);
        refreshRow = { key_id: String(args[1]), issued_at: Number(args[2]), expires_at: Number(args[3]), used_at: null };
      } else if (sql.startsWith('SELECT key_id')) {
        if (String(args[0]) !== refreshHash || !refreshRow) return { rows: [] };
        return { rows: [refreshRow] };
      } else if (sql.startsWith('UPDATE mcp_session_refresh_tokens')) {
        if (!refreshRow || refreshRow.used_at !== null) return { rowsAffected: 0 };
        refreshRow.used_at = Number(args[0]);
        return { rowsAffected: 1 };
      }
      return { rows: [] };
    });
  });

  it('issues a dedicated-secret signed session and revalidates the backing key', async () => {
    const session = await issueMcpSession(key);
    expect(session?.token.split('.')).toHaveLength(2);
    expect(session!.expiresAt - Date.now()).toBeCloseTo(SESSION_TTL_MS, -2);
    expect(session!.refreshExpiresAt - Date.now()).toBeCloseTo(REFRESH_MAX_LIFETIME_MS, -2);
    const checked = await validateMcpSession(session!.token);
    expect(checked).toMatchObject({ valid: true, key: { id: 'key-1', plan: 'private_test' } });
  });

  it('uses the same 15-minute TTL for public and private-test sessions', async () => {
    const publicSession = await issueMcpSession({ ...key, id: 'public-key', plan: 'free' as const });
    expect(publicSession!.expiresAt - Date.now()).toBeCloseTo(SESSION_TTL_MS, -2);
    const privateSession = await issueMcpSession(key);
    expect(privateSession!.expiresAt - Date.now()).toBeCloseTo(SESSION_TTL_MS, -2);
  });

  it('rejects a session older than 15 minutes', async () => {
    const session = await issueMcpSession(key);
    const now = Date.now;
    Date.now = () => now() + SESSION_TTL_MS + 1;
    try { expect(await validateMcpSession(session!.token)).toEqual({ valid: false, error: 'MCP session expired' }); }
    finally { Date.now = now; }
  });

  it('rotates refresh credentials and rejects reuse of the old credential', async () => {
    const session = await issueMcpSession(key);
    const refreshed = await refreshMcpSession(session!.refreshToken);
    expect(refreshed?.refreshToken).toBeDefined();
    expect(refreshed?.refreshToken).not.toBe(session!.refreshToken);
    expect(await refreshMcpSession(session!.refreshToken)).toBeNull();
  });

  it('rejects a refresh credential when the backing key is revoked', async () => {
    const session = await issueMcpSession(key);
    getApiKeyById.mockResolvedValueOnce(null);
    expect(await refreshMcpSession(session!.refreshToken)).toBeNull();
  });

  it('rejects a refresh credential after the 24-hour maximum lifetime', async () => {
    const session = await issueMcpSession(key);
    const now = Date.now;
    Date.now = () => now() + REFRESH_MAX_LIFETIME_MS + 1;
    try { expect(await refreshMcpSession(session!.refreshToken)).toBeNull(); }
    finally { Date.now = now; }
  });

  it('does not fall back to database or operator secrets', async () => {
    vi.stubEnv('MCP_SESSION_SECRET', undefined);
    vi.stubEnv('TURSO_AUTH_TOKEN', 'database-secret');
    vi.stubEnv('MCP_OPERATOR_SECRET', 'operator-secret');
    expect(await issueMcpSession(key)).toBeNull();
  });

  it('keeps non-session imports bootable in production when the session secret is missing', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('MCP_SESSION_SECRET', undefined);
    const { siteUrlForMetadata } = await import('../lib/env');
    expect(siteUrlForMetadata()).toBeDefined();
    expect(await issueMcpSession(key)).toBeNull();
  });
});
