import crypto from 'crypto';
import { env } from './env';
import { getApiKeyById, type ApiKey } from './api_keys';

const SESSION_TTL_MS = 15 * 60 * 1000;

type Claims = { keyId: string; issuedAt: number; expiresAt: number };

function secret(): string {
  return env.TURSO_AUTH_TOKEN ?? env.MCP_OPERATOR_SECRET ?? '';
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function issueMcpSession(key: ApiKey): { token: string; expiresAt: number } | null {
  if (!secret()) return null;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ keyId: key.id, issuedAt, expiresAt })).toString('base64url');
  return { token: `${payload}.${sign(payload)}`, expiresAt };
}

export async function validateMcpSession(raw: string): Promise<{ valid: true; key: ApiKey } | { valid: false; error: string }> {
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
