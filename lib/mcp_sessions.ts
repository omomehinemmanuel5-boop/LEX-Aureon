import crypto from 'crypto';
import { getClient } from './db';
import { getApiKeyById, type ApiKey } from './api_keys';

export const SESSION_TTL_MS = 15 * 60 * 1000;
export const REFRESH_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

type Claims = { keyId: string; issuedAt: number; expiresAt: number };
type RefreshRow = { key_id: unknown; issued_at: unknown; expires_at: unknown; used_at: unknown };

function secret(): string {
  return process.env.MCP_SESSION_SECRET ?? '';
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function issueSignedSession(key: ApiKey, issuedAt: number): { token: string; expiresAt: number } {
  const expiresAt = issuedAt + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ keyId: key.id, issuedAt, expiresAt })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

async function ensureRefreshSchema(): Promise<void> {
  await getClient().execute(`CREATE TABLE IF NOT EXISTS mcp_session_refresh_tokens (
    refresh_hash TEXT PRIMARY KEY,
    key_id TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  )`);
  await getClient().execute('CREATE INDEX IF NOT EXISTS idx_mcp_session_refresh_key ON mcp_session_refresh_tokens(key_id)');
}

function newRefreshToken(): string {
  return `lex_mrt_${crypto.randomBytes(32).toString('base64url')}`;
}

async function issueRefreshCredential(key: ApiKey, issuedAt: number, expiresAt: number): Promise<string> {
  const refreshToken = newRefreshToken();
  await ensureRefreshSchema();
  await getClient().execute({
    sql: `INSERT INTO mcp_session_refresh_tokens (refresh_hash, key_id, issued_at, expires_at, used_at)
          VALUES (?, ?, ?, ?, NULL)`,
    args: [hashRefreshToken(refreshToken), key.id, issuedAt, expiresAt],
  });
  return refreshToken;
}

export type IssuedMcpSession = {
  token: string;
  expiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
};

export async function issueMcpSession(key: ApiKey): Promise<IssuedMcpSession | null> {
  if (!secret()) return null;
  const issuedAt = Date.now();
  const session = issueSignedSession(key, issuedAt);
  const refreshExpiresAt = issuedAt + REFRESH_MAX_LIFETIME_MS;
  const refreshToken = await issueRefreshCredential(key, issuedAt, refreshExpiresAt);
  return { ...session, refreshToken, refreshExpiresAt };
}

export async function refreshMcpSession(rawRefreshToken: string): Promise<IssuedMcpSession | null> {
  if (!secret() || !rawRefreshToken) return null;
  const now = Date.now();
  await ensureRefreshSchema();
  const result = await getClient().execute({
    sql: `SELECT key_id, issued_at, expires_at, used_at
          FROM mcp_session_refresh_tokens WHERE refresh_hash = ? LIMIT 1`,
    args: [hashRefreshToken(rawRefreshToken)],
  });
  if (!result.rows.length) return null;
  const row = result.rows[0] as unknown as RefreshRow;
  const issuedAt = Number(row.issued_at);
  const refreshExpiresAt = Number(row.expires_at);
  if (row.used_at != null || !Number.isFinite(issuedAt) || !Number.isFinite(refreshExpiresAt) || now >= refreshExpiresAt) return null;

  const key = await getApiKeyById(String(row.key_id));
  if (!key || (key.expires_at !== null && now >= key.expires_at)) return null;

  const consumed = await getClient().execute({
    sql: `UPDATE mcp_session_refresh_tokens SET used_at = ?
          WHERE refresh_hash = ? AND used_at IS NULL AND expires_at > ?`,
    args: [now, hashRefreshToken(rawRefreshToken), now],
  });
  if ((consumed.rowsAffected ?? 0) !== 1) return null;

  const session = issueSignedSession(key, now);
  const refreshToken = await issueRefreshCredential(key, issuedAt, refreshExpiresAt);
  return { ...session, refreshToken, refreshExpiresAt };
}

export type ValidatedMcpSession =
  | { valid: true; key: ApiKey }
  | { valid: false; error: string };

export async function validateMcpSession(raw: string): Promise<ValidatedMcpSession> {
  if (!secret()) return { valid: false, error: 'Session authentication unavailable' };
  const [payload, signature] = raw.split('.');
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return { valid: false, error: 'Invalid MCP session' };
  let claims: Claims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Claims; } catch { return { valid: false, error: 'Invalid MCP session' }; }
  if (!claims.keyId || !Number.isFinite(claims.expiresAt) || Date.now() >= claims.expiresAt) return { valid: false, error: 'MCP session expired' };
  const key = await getApiKeyById(claims.keyId);
  if (!key || (key.expires_at !== null && Date.now() >= key.expires_at)) return { valid: false, error: 'API credential expired or revoked' };
  return { valid: true, key };
}
