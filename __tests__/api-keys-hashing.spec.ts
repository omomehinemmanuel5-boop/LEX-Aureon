import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbExecute, dbBatch } = vi.hoisted(() => ({ dbExecute: vi.fn(), dbBatch: vi.fn() }));
vi.mock('../lib/db', () => ({ getClient: () => ({ execute: dbExecute, batch: dbBatch }), initTenantSchema: async () => undefined }));

import { generateApiKey, getKeysByEmail, validateApiKey, consumeApiKey } from '../lib/api_keys';

function installFakeDb() {
  const rows: Array<Record<string, unknown>> = [];
  dbExecute.mockImplementation(async (query: string | { sql: string; args: unknown[] }) => {
    if (typeof query === 'string') return { rows: [] };
    const { sql, args } = query;
    if (sql === 'PRAGMA table_info(api_keys)') return { rows: [{ name: 'tenant_id' }] };
    if (sql.startsWith('SELECT id, key, key_hash')) return { rows: [] };
    if (sql.startsWith('SELECT * FROM api_keys WHERE key_hash')) {
      const [hash, raw] = args as [string, string];
      return { rows: rows.filter(row => row.key_hash === hash || row.key === raw).slice(0, 1) };
    }
    if (sql.startsWith('SELECT * FROM api_keys WHERE email')) {
      const [email] = args as [string];
      return { rows: rows.filter(row => row.email === email) };
    }

    if (sql.startsWith('UPDATE api_keys SET runs_used')) {
      const [hash, raw] = args as [string, string, number];
      const row = rows.find(candidate => candidate.key_hash === hash || candidate.key === raw);
      if (!row || Number(row.runs_used) >= Number(row.runs_limit)) return { rowsAffected: 0, rows: [] };
      row.runs_used = Number(row.runs_used) + 1;
      return { rowsAffected: 1, rows: [] };
    }
    return { rows: [], rowsAffected: 0 };
  });
  dbBatch.mockImplementation(async (statements: Array<{ sql: string; args: unknown[] }>) => {
    for (const statement of statements) {
      if (statement.sql.startsWith('INSERT INTO api_keys')) {
        const [id, key, keyHash, keyPrefix, keyPreview, name, email, plan, limit, expiresAt, tenantId] = statement.args;
        rows.push({ id, key, key_hash: keyHash, key_prefix: keyPrefix, key_preview: keyPreview, name, email, plan, runs_used: 0, runs_limit: limit, created_at: Date.now(), last_used_at: null, expires_at: expiresAt, tenant_id: tenantId });
      }
    }
    return [];
  });
}

describe('API key hashing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installFakeDb();
  });

  it('does not persist the raw new credential and validates it by digest', async () => {
    const created = await generateApiKey({ email: 'hashing@example.com', name: 'Hash test' });
    expect(created?.key).toMatch(/^lex_sk_/);
    const batch = dbBatch.mock.calls.map(([statements]) => statements as Array<{ sql: string; args: unknown[] }>)
      .find(statements => statements.some(statement => statement.sql.startsWith('INSERT INTO api_keys')))!;
    const insert = batch.find(statement => statement.sql.startsWith('INSERT INTO api_keys'))!;
    expect(insert.args[1]).not.toBe(created?.key);
    expect(insert.args[2]).toMatch(/^[a-f0-9]{64}$/);
    expect(insert.args).not.toContain(created?.key);
    expect(batch.map(statement => statement.sql)).toEqual(expect.arrayContaining([
      expect.stringContaining('INSERT INTO tenants'),
      expect.stringContaining('INSERT INTO tenant_members'),
      expect.stringContaining('INSERT INTO tenant_environments'),
    ]));
    expect(created?.tenant_id).toBe(`tn_personal_${created?.id}`);

    const validated = await validateApiKey(created!.key);
    expect(validated.valid).toBe(true);
    expect(validated.key?.key).toBe('');
    expect(validated.key?.key_preview).toBe(created?.key_preview);
    expect((await consumeApiKey(created!.key)).valid).toBe(true);
    expect((await getKeysByEmail('hashing@example.com'))[0].key).toBe('');
  });
});
