/**
 * API Key management for Lex Aureon
 * Allows developers to integrate PRAXIS governance into their own systems
 */

import { getClient } from './db';

// Use Web Crypto for edge-compatible random key generation
function generateSecureRandom(bytes: number): string {
  const arr = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    // Node.js fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomBytes } = require('crypto') as { randomBytes: (n: number) => Buffer };
    const buf = randomBytes(bytes);
    for (let i = 0; i < bytes; i++) arr[i] = buf[i];
  }
  return Buffer.from(arr).toString('base64url');
}

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  email: string;
  plan: 'free' | 'sovereign';
  runs_used: number;
  runs_limit: number;
  created_at: number;
  last_used_at: number | null;
}

const PLANS = {
  free:      { limit: 100,   label: 'Free' },
  sovereign: { limit: 10000, label: 'Sovereign' },
};

// ── Schema ─────────────────────────────────────────────────────────────────

export async function initApiKeySchema(): Promise<void> {
  const db = getClient();
  if (!db) return;
  await db.execute({
    sql: `CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT PRIMARY KEY,
      key         TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL DEFAULT 'My Key',
      email       TEXT NOT NULL,
      plan        TEXT NOT NULL DEFAULT 'free',
      runs_used   INTEGER NOT NULL DEFAULT 0,
      runs_limit  INTEGER NOT NULL DEFAULT 100,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used_at INTEGER
    )`,
    args: [],
  });
}

// ── Generate ───────────────────────────────────────────────────────────────

export async function generateApiKey(params: {
  email: string;
  name?: string;
  plan?: 'free' | 'sovereign';
}): Promise<ApiKey | null> {
  const db = getClient();
  if (!db) return null;
  await initApiKeySchema();

  const id  = generateSecureRandom(8).slice(0, 16);
  const raw = generateSecureRandom(24);
  const key = `lex_sk_${raw}`;
  const plan = params.plan ?? 'free';
  const limit = PLANS[plan].limit;

  await db.execute({
    sql: `INSERT INTO api_keys (id, key, name, email, plan, runs_limit)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, key, params.name ?? 'My Key', params.email, plan, limit],
  });

  return {
    id, key,
    name: params.name ?? 'My Key',
    email: params.email,
    plan,
    runs_used: 0,
    runs_limit: limit,
    created_at: Date.now(),
    last_used_at: null,
  };
}

function rowToApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id: row.id as string,
    key: row.key as string,
    name: row.name as string,
    email: row.email as string,
    plan: row.plan as 'free' | 'sovereign',
    runs_used: row.runs_used as number,
    runs_limit: row.runs_limit as number,
    created_at: row.created_at as number,
    last_used_at: row.last_used_at as number | null,
  };
}

// ── Validate without consuming a run ──────────────────────────────────────

export interface ValidateResult {
  valid: boolean;
  error?: string;
  key?: ApiKey;
}

export async function validateApiKey(raw: string): Promise<ValidateResult> {
  const db = getClient();
  if (!db) return { valid: false, error: 'Database unavailable' };
  await initApiKeySchema();

  const r = await db.execute({
    sql: `SELECT * FROM api_keys WHERE key = ?`,
    args: [raw],
  });

  if (r.rows.length === 0) return { valid: false, error: 'Invalid API key' };

  const row = r.rows[0] as Record<string, unknown>;
  const used = row.runs_used as number;
  const limit = row.runs_limit as number;

  if (used >= limit) {
    return {
      valid: false,
      error: `Rate limit reached (${used}/${limit} runs). Upgrade at lexaureon.com`,
    };
  }

  return { valid: true, key: rowToApiKey(row) };
}

// ── Consume one run after all admission checks pass ────────────────────────

export async function consumeApiKey(raw: string): Promise<ValidateResult> {
  const db = getClient();
  if (!db) return { valid: false, error: 'Database unavailable' };

  const result = await db.execute({
    sql: `UPDATE api_keys
          SET runs_used = runs_used + 1, last_used_at = unixepoch()
          WHERE key = ? AND runs_used < runs_limit`,
    args: [raw],
  });

  if ((result.rowsAffected ?? 0) !== 1) {
    return { valid: false, error: 'API key is invalid or exhausted' };
  }

  const r = await db.execute({
    sql: `SELECT * FROM api_keys WHERE key = ?`,
    args: [raw],
  });
  if (r.rows.length === 0) return { valid: false, error: 'API key unavailable after consumption' };

  return { valid: true, key: rowToApiKey(r.rows[0] as Record<string, unknown>) };
}

// Backwards-compatible combined validation + consumption for existing callers.
export async function validateAndConsumeKey(raw: string): Promise<ValidateResult> {
  const validation = await validateApiKey(raw);
  if (!validation.valid) return validation;
  return consumeApiKey(raw);
}

// ── Lookup keys by email ───────────────────────────────────────────────────

export async function getKeysByEmail(email: string): Promise<ApiKey[]> {
  const db = getClient();
  if (!db) return [];
  await initApiKeySchema();

  const r = await db.execute({
    sql: `SELECT * FROM api_keys WHERE email = ? ORDER BY created_at DESC`,
    args: [email],
  });

  return r.rows.map(row => rowToApiKey(row as Record<string, unknown>));
}

// ── Revoke ─────────────────────────────────────────────────────────────────

export async function revokeKey(id: string, email: string): Promise<boolean> {
  const db = getClient();
  if (!db) return false;
  const r = await db.execute({
    sql: `DELETE FROM api_keys WHERE id = ? AND email = ?`,
    args: [id, email],
  });
  return (r.rowsAffected ?? 0) > 0;
}
