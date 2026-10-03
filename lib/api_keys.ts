/**
 * API key management for Lex Aureon.
 *
 * Raw credentials are returned only at creation time. New credentials are
 * persisted as SHA-256 digests plus a short preview; legacy plaintext rows
 * are migrated once per warm instance and remain accepted until rotated.
 */
import crypto from 'crypto';
import { getClient } from './db';
import { FREE_AGENT_TOOL_RUN_LIMIT } from './pricing';

function generateSecureRandom(bytes: number): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    const buf = crypto.randomBytes(bytes);
    for (let i = 0; i < bytes; i++) arr[i] = buf[i];
  }
  return Buffer.from(arr).toString('base64url');
}

function hashApiKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export interface ApiKey {
  id: string;
  /** Raw key only for the creation response; empty when loaded from storage. */
  key: string;
  key_preview: string;
  name: string;
  email: string;
  plan: 'free' | 'sovereign' | 'private_test';
  runs_used: number;
  runs_limit: number;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
}

const PLANS = {
  free: { limit: FREE_AGENT_TOOL_RUN_LIMIT, label: 'Free' },
  sovereign: { limit: 10000, label: 'Sovereign' },
  private_test: { limit: 1_000_000_000, label: 'Private test' },
};

let freeQuotaMigrated = false;
let keyHashMigrated = false;

export async function initApiKeySchema(): Promise<void> {
  const db = getClient();
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      key_hash TEXT,
      key_prefix TEXT,
      key_preview TEXT,
      name TEXT NOT NULL DEFAULT 'My Key',
      email TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free',
      runs_used INTEGER NOT NULL DEFAULT 0,
      runs_limit INTEGER NOT NULL DEFAULT 1000,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used_at INTEGER,
      expires_at INTEGER
    )`,
    args: [],
  });
  for (const column of ['key_hash TEXT', 'key_prefix TEXT', 'key_preview TEXT', 'expires_at INTEGER']) {
    try { await db.execute(`ALTER TABLE api_keys ADD COLUMN ${column}`); } catch { /* already migrated */ }
  }
  try { await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash) WHERE key_hash IS NOT NULL'); } catch { /* legacy duplicate data is handled below */ }

  if (!keyHashMigrated) {
    const legacy = await db.execute({
      sql: 'SELECT id, key, key_hash FROM api_keys WHERE key_hash IS NULL AND key NOT LIKE \'legacy_%\'',
      args: [],
    });
    for (const row of legacy.rows as Array<Record<string, unknown>>) {
      const raw = String(row.key);
      await db.execute({
        sql: 'UPDATE api_keys SET key_hash = ?, key_prefix = ?, key_preview = ?, key = ? WHERE id = ?',
        args: [hashApiKey(raw), raw.slice(0, 10), `${raw.slice(0, 10)}...${raw.slice(-4)}`, `legacy_${String(row.id)}`, row.id as string],
      });
    }
    keyHashMigrated = true;
  }
  if (!freeQuotaMigrated) {
    await db.execute('UPDATE api_keys SET runs_limit = 1000 WHERE plan = \'free\' AND runs_limit < 1000');
    freeQuotaMigrated = true;
  }
}

export async function generateApiKey(params: {
  email: string;
  name?: string;
  plan?: 'free' | 'sovereign' | 'private_test';
  expiresAt?: number;
}): Promise<ApiKey | null> {
  const db = getClient();
  await initApiKeySchema();
  const id = generateSecureRandom(8).slice(0, 16);
  const raw = `lex_sk_${generateSecureRandom(24)}`;
  const plan = params.plan ?? 'free';
  const limit = PLANS[plan].limit;
  const expiresAt = params.expiresAt ?? (plan === 'private_test' ? Date.now() + 2 * 60 * 60 * 1000 : null);
  await db.execute({
    sql: `INSERT INTO api_keys (id, key, key_hash, key_prefix, key_preview, name, email, plan, runs_limit, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, `legacy_${id}`, hashApiKey(raw), raw.slice(0, 10), `${raw.slice(0, 10)}...${raw.slice(-4)}`, params.name ?? 'My Key', params.email, plan, limit, expiresAt],
  });
  return {
    id, key: raw, key_preview: `${raw.slice(0, 10)}...${raw.slice(-4)}`,
    name: params.name ?? 'My Key', email: params.email, plan,
    runs_used: 0, runs_limit: limit, created_at: Date.now(), last_used_at: null, expires_at: expiresAt,
  };
}

function rowToApiKey(row: Record<string, unknown>): ApiKey {
  const preview = String(row.key_preview ?? row.key_prefix ?? (typeof row.key === 'string' && !row.key.startsWith('legacy_') ? row.key.slice(0, 10) : ''));
  return {
    id: String(row.id), key: '', key_preview: preview || 'unavailable',
    name: String(row.name), email: String(row.email), plan: row.plan as ApiKey['plan'],
    runs_used: Number(row.runs_used), runs_limit: Number(row.runs_limit),
    created_at: Number(row.created_at), last_used_at: row.last_used_at == null ? null : Number(row.last_used_at),
    expires_at: row.expires_at == null ? null : Number(row.expires_at),
  };
}

async function oauthKeyIdForAccessToken(raw: string): Promise<string | null> {
  if (!raw.startsWith('lex_at_')) return null;
  try {
    const r = await getClient().execute({
      sql: `SELECT key_id FROM mcp_oauth_tokens
            WHERE access_hash = ? AND resource = ? AND revoked_at IS NULL AND expires_at > ?
            LIMIT 1`,
      args: [hashApiKey(raw), 'https://www.lexaureon.com/api/mcp', Date.now()],
    });
    return r.rows.length ? String(r.rows[0].key_id) : null;
  } catch {
    // The OAuth table is absent until the first OAuth deployment initializes it.
    return null;
  }
}

export interface ValidateResult { valid: boolean; error?: string; key?: ApiKey }

export async function validateApiKey(raw: string): Promise<ValidateResult> {
  const db = getClient();
  await initApiKeySchema();
  const oauthKeyId = await oauthKeyIdForAccessToken(raw);
  if (oauthKeyId) return getApiKeyById(oauthKeyId).then(key =>
    key ? { valid: true, key } : { valid: false, error: 'OAuth access token is invalid or expired' }
  );
  const r = await db.execute({
    sql: 'SELECT * FROM api_keys WHERE key_hash = ? OR key = ? LIMIT 1',
    args: [hashApiKey(raw), raw],
  });
  if (!r.rows.length) return { valid: false, error: 'Invalid API key' };
  const row = r.rows[0] as Record<string, unknown>;
  if (Number(row.runs_used) >= Number(row.runs_limit)) {
    return { valid: false, error: `Rate limit reached (${row.runs_used}/${row.runs_limit})` };
  }
  if (row.expires_at != null && Date.now() >= Number(row.expires_at)) {
    return { valid: false, error: 'API key expired' };
  }
  return { valid: true, key: rowToApiKey(row) };
}

export async function consumeApiKey(raw: string): Promise<ValidateResult> {
  const db = getClient();
  await initApiKeySchema();
  const oauthKeyId = await oauthKeyIdForAccessToken(raw);
  if (oauthKeyId) return consumeApiKeyById(oauthKeyId);
  const result = await db.execute({
    sql: `UPDATE api_keys SET runs_used = runs_used + 1, last_used_at = unixepoch()
          WHERE (key_hash = ? OR key = ?) AND runs_used < runs_limit
            AND (expires_at IS NULL OR expires_at > ?)`,
    args: [hashApiKey(raw), raw, Date.now()],
  });
  if ((result.rowsAffected ?? 0) !== 1) return { valid: false, error: 'API key is invalid or exhausted' };
  const r = await db.execute({
    sql: 'SELECT * FROM api_keys WHERE key_hash = ? OR key = ? LIMIT 1',
    args: [hashApiKey(raw), raw],
  });
  if (!r.rows.length) return { valid: false, error: 'API key unavailable after consumption' };
  return { valid: true, key: rowToApiKey(r.rows[0] as Record<string, unknown>) };
}

export async function getApiKeyById(id: string): Promise<ApiKey | null> {
  const db = getClient();
  await initApiKeySchema();
  const r = await db.execute({ sql: 'SELECT * FROM api_keys WHERE id = ? LIMIT 1', args: [id] });
  if (!r.rows.length) return null;
  const row = r.rows[0] as Record<string, unknown>;
  if (row.expires_at != null && Date.now() >= Number(row.expires_at)) return null;
  if (Number(row.runs_used) >= Number(row.runs_limit)) return null;
  return rowToApiKey(row);
}

export async function consumeApiKeyById(id: string): Promise<ValidateResult> {
  const db = getClient();
  await initApiKeySchema();
  const result = await db.execute({
    sql: `UPDATE api_keys SET runs_used = runs_used + 1, last_used_at = unixepoch()
          WHERE id = ? AND runs_used < runs_limit
            AND (expires_at IS NULL OR expires_at > ?)`,
    args: [id, Date.now()],
  });
  if ((result.rowsAffected ?? 0) !== 1) return { valid: false, error: 'API key is invalid or exhausted' };
  const r = await db.execute({ sql: 'SELECT * FROM api_keys WHERE id = ? LIMIT 1', args: [id] });
  if (!r.rows.length) return { valid: false, error: 'API key unavailable after consumption' };
  return { valid: true, key: rowToApiKey(r.rows[0] as Record<string, unknown>) };
}

export async function validateAndConsumeKey(raw: string): Promise<ValidateResult> {
  const validation = await validateApiKey(raw);
  return validation.valid ? consumeApiKey(raw) : validation;
}

export async function getKeysByEmail(email: string): Promise<ApiKey[]> {
  const db = getClient();
  await initApiKeySchema();
  const r = await db.execute({ sql: 'SELECT * FROM api_keys WHERE email = ? ORDER BY created_at DESC', args: [email] });
  return r.rows.map(row => rowToApiKey(row as Record<string, unknown>));
}

export async function revokeKey(id: string, email: string): Promise<boolean> {
  const db = getClient();
  const r = await db.execute({ sql: 'DELETE FROM api_keys WHERE id = ? AND email = ?', args: [id, email] });
  return (r.rowsAffected ?? 0) > 0;
}
