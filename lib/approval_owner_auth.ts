import crypto from 'crypto';
import { getClient } from './db';
import { initApiKeySchema } from './api_keys';

export const APPROVAL_OWNER_COOKIE = 'lex_approval_owner';
export const APPROVAL_OWNER_SESSION_TTL_SECONDS = 60 * 60;
const MAX_API_KEY_LENGTH = 256;

interface StoredOwnerKey {
  ownerId: string;
  signingKey: string;
}

function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function sign(ownerId: string, expires: number, signingKey: string): string {
  return crypto.createHmac('sha256', signingKey)
    .update(`${APPROVAL_OWNER_COOKIE}:${ownerId}:${expires}`)
    .digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const a = crypto.createHash('sha256').update(left).digest();
  const b = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(a, b);
}

async function ownerKeyById(ownerId: string): Promise<StoredOwnerKey | null> {
  await initApiKeySchema();
  const result = await getClient().execute({
    sql: 'SELECT id, key_hash, expires_at FROM api_keys WHERE id = ? LIMIT 1',
    args: [ownerId],
  });
  const row = result.rows[0];
  if (!row || row.key_hash == null) return null;
  if (row.expires_at != null && Date.now() >= Number(row.expires_at)) return null;
  return { ownerId: String(row.id), signingKey: String(row.key_hash) };
}

/** Verify an API key without consuming its usage quota. */
export async function authenticateApprovalOwner(rawApiKey: string): Promise<StoredOwnerKey | null> {
  if (rawApiKey.length < 20 || rawApiKey.length > MAX_API_KEY_LENGTH) return null;
  await initApiKeySchema();
  const digest = hashApiKey(rawApiKey);
  const result = await getClient().execute({
    sql: 'SELECT id, key_hash, expires_at FROM api_keys WHERE key_hash = ? LIMIT 1',
    args: [digest],
  });
  const row = result.rows[0];
  if (!row || row.key_hash == null || !safeEqual(String(row.key_hash), digest)) return null;
  if (row.expires_at != null && Date.now() >= Number(row.expires_at)) return null;
  return { ownerId: String(row.id), signingKey: String(row.key_hash) };
}

export function createApprovalOwnerCookie(
  owner: StoredOwnerKey,
  nowMs = Date.now(),
): string {
  const expires = nowMs + APPROVAL_OWNER_SESSION_TTL_SECONDS * 1000;
  const signature = sign(owner.ownerId, expires, owner.signingKey);
  const value = `${owner.ownerId}.${expires}.${signature}`;
  return `${APPROVAL_OWNER_COOKIE}=${value}; Path=/approvals; Max-Age=${APPROVAL_OWNER_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

/** Return the API-key owner bound to a valid, unexpired signed browser session. */
export async function approvalOwnerFromCookie(
  cookieHeader: string | null,
  nowMs = Date.now(),
): Promise<string | null> {
  const entry = cookieHeader?.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${APPROVAL_OWNER_COOKIE}=`));
  if (!entry) return null;
  const value = entry.slice(APPROVAL_OWNER_COOKIE.length + 1);
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [ownerId, expiresText, signature] = parts;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(ownerId) || !/^\d+$/.test(expiresText) || !signature) return null;
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires <= nowMs) return null;
  const owner = await ownerKeyById(ownerId);
  if (!owner) return null;
  return safeEqual(signature, sign(owner.ownerId, expires, owner.signingKey)) ? owner.ownerId : null;
}
