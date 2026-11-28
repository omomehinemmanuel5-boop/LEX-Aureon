import crypto from 'crypto';
import { env } from './env';
import { getClient } from './db';
import { initApiKeySchema } from './api_keys';
import { logger } from './logger';

export const ACCOUNT_SESSION_COOKIE = 'lex_account_session';
export const ACCOUNT_SESSION_TTL_SECONDS = 12 * 60 * 60;
const EMAIL_TOKEN_TTL_MS = 30 * 60 * 1000;
const SITE_NAME = 'Lex Aureon';

export interface AccountUser {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  plan: 'free';
}

function randomId(bytes = 18): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function ensureAccountSchema(): Promise<void> {
  const db = getClient();
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS account_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      company_name TEXT NOT NULL,
      tenant_id TEXT NOT NULL UNIQUE,
      email_verified INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS account_email_verifications (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      consumed_at INTEGER
    )`, args: [] },
    { sql: 'CREATE INDEX IF NOT EXISTS idx_account_verification_user ON account_email_verifications(user_id)', args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS account_rate_limits (
      key TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL
    )`, args: [] },
  ], 'write');
}

export async function checkAccountRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  await ensureAccountSchema();
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds;
  const result = await getClient().execute({
    sql: `INSERT INTO account_rate_limits (key, window_start, count) VALUES (?, ?, 1)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE WHEN account_rate_limits.window_start = excluded.window_start THEN account_rate_limits.count + 1 ELSE 1 END,
            window_start = excluded.window_start
          RETURNING count`,
    args: [key, windowStart],
  });
  return Number(result.rows[0]?.count ?? limit + 1) <= limit;
}

export function clientRateLimitKey(ip: string, suffix: string): string {
  return crypto.createHash('sha256').update(`${ip}\0${suffix}`).digest('hex');
}

async function passwordDigest(password: string, salt: Buffer): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });
}

export async function hashAccountPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const digest = await passwordDigest(password, salt);
  return `scrypt$32768$8$1$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}

export async function verifyAccountPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt' || parts[1] !== '32768' || parts[2] !== '8' || parts[3] !== '1') return false;
  try {
    const salt = Buffer.from(parts[4], 'base64url');
    const expected = Buffer.from(parts[5], 'base64url');
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await passwordDigest(password, salt);
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function rowToUser(row: Record<string, unknown>): AccountUser {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.company_name),
    tenantId: String(row.tenant_id),
    plan: 'free',
  };
}

async function findByEmail(email: string): Promise<Record<string, unknown> | null> {
  await ensureAccountSchema();
  const result = await getClient().execute({
    sql: 'SELECT id, email, password_hash, company_name, tenant_id, email_verified FROM account_users WHERE email = ? COLLATE NOCASE LIMIT 1',
    args: [normalizeEmail(email)],
  });
  return result.rows[0] as Record<string, unknown> | undefined ?? null;
}

function continuationSignature(encoded: string): string {
  const secret = env.MCP_SESSION_SECRET || '';
  if (secret.length < 32) throw new Error('Account session signing secret is not configured securely.');
  return crypto.createHmac('sha256', secret).update('oauth-continuation:' + encoded).digest('base64url');
}

function encodeOAuthContinuation(value?: string): { encoded: string; signature: string } | null {
  if (!value) return null;
  const url = new URL(value);
  const siteOrigin = new URL(env.NEXT_PUBLIC_SITE_URL).origin;
  if (url.origin !== siteOrigin || url.pathname !== '/oauth/authorize') throw new Error('Invalid OAuth continuation.');
  const encoded = Buffer.from(url.toString()).toString('base64url');
  return { encoded, signature: continuationSignature(encoded) };
}

export function verifyOAuthContinuation(encoded?: string | null, signature?: string | null): string | null {
  if (!encoded || !signature || !/^[A-Za-z0-9_-]{1,4096}$/.test(encoded)) return null;
  try {
    const expected = continuationSignature(encoded);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const value = Buffer.from(encoded, 'base64url').toString('utf8');
    const url = new URL(value);
    if (url.origin !== new URL(env.NEXT_PUBLIC_SITE_URL).origin || url.pathname !== '/oauth/authorize') return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function issueVerificationEmail(userId: string, email: string, continuationUrl?: string): Promise<boolean> {
  const resendKey = env.RESEND_API_KEY;
  if (!resendKey) return false;
  const token = randomId(32);
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = Date.now() + EMAIL_TOKEN_TTL_MS;
  await ensureAccountSchema();
  await getClient().execute({
    sql: 'INSERT INTO account_email_verifications (token_hash, user_id, expires_at, consumed_at) VALUES (?, ?, ?, NULL)',
    args: [tokenHash, userId, expiresAt],
  });
  const origin = new URL(env.NEXT_PUBLIC_SITE_URL).origin;
  const continuation = encodeOAuthContinuation(continuationUrl);
  const verificationParams = new URLSearchParams({ token });
  if (continuation) {
    verificationParams.set('continue', continuation.encoded);
    verificationParams.set('continue_sig', continuation.signature);
  }
  const verificationUrl = `${origin}/verify-email?${verificationParams.toString()}`;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Lex Aureon <noreply@lexaureon.com>',
        to: email,
        subject: 'Verify your Lex Aureon account',
        text: `Confirm your email address to activate your Lex Aureon account. This link expires in 30 minutes.\n\n${verificationUrl}\n\nIf you did not create this account, you can ignore this message.`,
      }),
    });
    if (!response.ok) {
      logger.error('auth.email_verification', 'Resend rejected verification email', { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('auth.email_verification', 'Verification email send failed', { error: String(error).slice(0, 160) });
    return false;
  }
}

/** Create an account and its private owner tenant, or re-send verification for a pending account. */
export async function registerAccount(input: { email: string; password: string; companyName: string; continuationUrl?: string }): Promise<'sent' | 'already_exists' | 'unavailable'> {
  const email = normalizeEmail(input.email);
  if (!env.RESEND_API_KEY) return 'unavailable';
  await initApiKeySchema();
  await ensureAccountSchema();
  let row = await findByEmail(email);
  if (!row) {
    const id = randomId();
    const tenantId = `tn_user_${id}`;
    const environmentId = `env_${randomId(12)}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const passwordHash = await hashAccountPassword(input.password);
    try {
      await getClient().batch([
        { sql: `INSERT INTO tenants (id, kind, display_name, created_at, updated_at) VALUES (?, 'personal', ?, ?, ?)`, args: [tenantId, input.companyName.trim(), createdAt, createdAt] },
        { sql: `INSERT INTO tenant_members (tenant_id, actor_id, role, status, created_at) VALUES (?, ?, 'owner', 'active', ?)`, args: [tenantId, `user:${id}`, createdAt] },
        { sql: `INSERT INTO tenant_environments (environment_id, tenant_id, display_name, status, created_at) VALUES (?, ?, 'Default environment', 'active', ?)`, args: [environmentId, tenantId, createdAt] },
        { sql: `INSERT INTO account_users (id, email, password_hash, company_name, tenant_id, email_verified, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`, args: [id, email, passwordHash, input.companyName.trim(), tenantId, createdAt] },
      ], 'write');
    } catch (error) {
      // A concurrent registration for this email is not an authentication signal.
      row = await findByEmail(email);
      if (!row) throw error;
    }
    row = await findByEmail(email);
  }
  if (!row) throw new Error('Account persistence failed.');
  if (Number(row.email_verified) === 1) return 'already_exists';
  const sent = await issueVerificationEmail(String(row.id), String(row.email), input.continuationUrl);
  return sent ? 'sent' : 'unavailable';
}

export async function authenticateAccount(email: string, password: string): Promise<{ user: AccountUser; verified: boolean } | null> {
  const row = await findByEmail(email);
  if (!row) {
    // Equalize the expensive path for unknown addresses without a reusable password hash.
    const dummy = await hashAccountPassword('not-a-real-password');
    await verifyAccountPassword(password, dummy);
    return null;
  }
  if (!await verifyAccountPassword(password, String(row.password_hash))) return null;
  return { user: rowToUser(row), verified: Number(row.email_verified) === 1 };
}

export async function verifyAccountEmail(token: string, continuation?: string | null, continuationSig?: string | null): Promise<{ user: AccountUser; continuationUrl: string | null } | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  await ensureAccountSchema();
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  const db = getClient();
  const found = await db.execute({ sql: 'SELECT user_id FROM account_email_verifications WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ? LIMIT 1', args: [hash, now] });
  const userId = found.rows[0]?.user_id;
  if (!userId) return null;
  const consumed = await db.execute({
    sql: 'UPDATE account_email_verifications SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?',
    args: [now, hash, now],
  });
  if ((consumed.rowsAffected ?? 0) !== 1) return null;
  await db.execute({ sql: 'UPDATE account_users SET email_verified = 1 WHERE id = ?', args: [String(userId)] });
  const result = await db.execute({ sql: 'SELECT id, email, company_name, tenant_id FROM account_users WHERE id = ? AND email_verified = 1 LIMIT 1', args: [String(userId)] });
  if (!result.rows[0]) return null;
  return { user: rowToUser(result.rows[0] as Record<string, unknown>), continuationUrl: verifyOAuthContinuation(continuation, continuationSig) };
}

function sessionSecret(): string {
  return env.MCP_SESSION_SECRET || '';
}

function sessionSignature(payload: string): string {
  const secret = sessionSecret();
  if (secret.length < 32) throw new Error('Account session signing secret is not configured securely.');
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createAccountSessionCookie(user: AccountUser, nowMs = Date.now()): string {
  const expires = Math.floor(nowMs / 1000) + ACCOUNT_SESSION_TTL_SECONDS;
  const payload = `${user.id}.${user.tenantId}.${expires}`;
  const signature = sessionSignature(payload);
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${ACCOUNT_SESSION_COOKIE}=${payload}.${signature}; Path=/; Max-Age=${ACCOUNT_SESSION_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure}`;
}

export function clearAccountSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${ACCOUNT_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}

function safeEqual(left: string, right: string): boolean {
  const a = crypto.createHash('sha256').update(left).digest();
  const b = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function accountFromCookie(cookieHeader: string | null, nowMs = Date.now()): Promise<AccountUser | null> {
  const entry = cookieHeader?.split(';').map(part => part.trim()).find(part => part.startsWith(`${ACCOUNT_SESSION_COOKIE}=`));
  if (!entry) return null;
  const parts = entry.slice(ACCOUNT_SESSION_COOKIE.length + 1).split('.');
  if (parts.length !== 4) return null;
  const [userId, tenantId, expiresText, signature] = parts;
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(userId) || !/^tn_user_[A-Za-z0-9_-]{8,80}$/.test(tenantId) || !/^\d+$/.test(expiresText)) return null;
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(nowMs / 1000)) return null;
  const payload = `${userId}.${tenantId}.${expires}`;
  if (!safeEqual(signature, sessionSignature(payload))) return null;
  await ensureAccountSchema();
  const result = await getClient().execute({
    sql: `SELECT u.id, u.email, u.company_name, u.tenant_id FROM account_users u
          JOIN tenant_members m ON m.tenant_id = u.tenant_id AND m.actor_id = 'user:' || u.id
          WHERE u.id = ? AND u.tenant_id = ? AND u.email_verified = 1
            AND m.role = 'owner' AND m.status = 'active' LIMIT 1`,
    args: [userId, tenantId],
  });
  return result.rows[0] ? rowToUser(result.rows[0] as Record<string, unknown>) : null;
}
