/**
 * R1b: safely backfill one personal tenant per existing API key.
 *
 * This migration is intentionally manual (run-migration.yml workflow_dispatch).
 * It never groups credentials by email, changes session IDs, or overwrites an
 * API key that already has a tenant_id. It is idempotent and verifies the
 * resulting ownership graph before reporting success.
 *
 * Before running: review this script and confirm the target Turso database.
 * After running: retain the workflow log as the migration execution record.
 */
import { createClient } from '@libsql/client';
import { initTenantSchema } from '../../lib/db';

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL is not set.');

  const client = createClient({ url, authToken });
  const apiKeysTable = await client.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'api_keys'",
    args: [],
  });
  if (apiKeysTable.rows.length !== 1) {
    throw new Error('api_keys table is missing. Refusing to create or infer an API-key inventory.');
  }

  await initTenantSchema(client);

  const invalidExistingBinding = await client.execute({
    sql: `SELECT k.id, k.tenant_id
          FROM api_keys k
          LEFT JOIN tenants t ON t.id = k.tenant_id
          WHERE k.tenant_id IS NOT NULL AND t.id IS NULL
          LIMIT 1`,
    args: [],
  });
  if (invalidExistingBinding.rows.length) {
    throw new Error(`Existing API key ${String(invalidExistingBinding.rows[0].id)} references a missing tenant. No backfill was attempted.`);
  }

  const existingOwnerGap = await client.execute({
    sql: `SELECT k.id
          FROM api_keys k
          LEFT JOIN tenant_members m
            ON m.tenant_id = k.tenant_id AND m.actor_id = ('api_key:' || k.id)
               AND m.role = 'owner' AND m.status = 'active'
          WHERE k.tenant_id IS NOT NULL AND m.actor_id IS NULL
          LIMIT 1`,
    args: [],
  });
  if (existingOwnerGap.rows.length) {
    throw new Error(`Existing API key ${String(existingOwnerGap.rows[0].id)} has no active owner membership. No backfill was attempted.`);
  }

  const existingEnvironmentGap = await client.execute({
    sql: `SELECT k.id
          FROM api_keys k
          LEFT JOIN tenant_environments e ON e.environment_id = k.id AND e.tenant_id = k.tenant_id
          WHERE k.tenant_id IS NOT NULL AND e.environment_id IS NULL
          LIMIT 1`,
    args: [],
  });
  if (existingEnvironmentGap.rows.length) {
    throw new Error(`Existing API key ${String(existingEnvironmentGap.rows[0].id)} has no matching tenant environment. No backfill was attempted.`);
  }

  const tenantCollision = await client.execute({
    sql: `SELECT k.id, t.kind, t.status
          FROM api_keys k
          JOIN tenants t ON t.id = ('tn_personal_' || k.id)
          WHERE k.tenant_id IS NULL AND (t.kind <> 'personal' OR t.status <> 'active')
          LIMIT 1`,
    args: [],
  });
  if (tenantCollision.rows.length) {
    throw new Error(`Personal tenant ID collision for API key ${String(tenantCollision.rows[0].id)}. No backfill was attempted.`);
  }

  const memberCollision = await client.execute({
    sql: `SELECT k.id, m.role, m.status
          FROM api_keys k
          JOIN tenant_members m
            ON m.tenant_id = ('tn_personal_' || k.id) AND m.actor_id = ('api_key:' || k.id)
          WHERE k.tenant_id IS NULL AND (m.role <> 'owner' OR m.status <> 'active')
          LIMIT 1`,
    args: [],
  });
  if (memberCollision.rows.length) {
    throw new Error(`Owner membership collision for API key ${String(memberCollision.rows[0].id)}. No backfill was attempted.`);
  }

  const environmentCollision = await client.execute({
    sql: `SELECT k.id, e.tenant_id
          FROM api_keys k
          JOIN tenant_environments e ON e.environment_id = k.id
          WHERE k.tenant_id IS NULL AND e.tenant_id <> ('tn_personal_' || k.id)
          LIMIT 1`,
    args: [],
  });
  if (environmentCollision.rows.length) {
    throw new Error(`Environment ID collision for API key ${String(environmentCollision.rows[0].id)}. No backfill was attempted.`);
  }

  const before = await client.execute({
    sql: 'SELECT COUNT(*) AS total, SUM(CASE WHEN tenant_id IS NULL THEN 1 ELSE 0 END) AS unbound FROM api_keys',
    args: [],
  });
  const total = Number(before.rows[0]?.total ?? 0);
  const unbound = Number(before.rows[0]?.unbound ?? 0);
  console.log(`R1b preflight: ${total} API keys; ${unbound} require personal-tenant binding.`);

  // Each statement is part of one libSQL write batch. INSERT OR IGNORE makes
  // retries safe; UPDATE only touches rows that still have no tenant.
  await client.batch([
    {
      sql: `INSERT OR IGNORE INTO tenants (id, kind, display_name, status, created_at, updated_at)
            SELECT 'tn_personal_' || id, 'personal', 'Personal workspace', 'active',
                   COALESCE(created_at, unixepoch()), unixepoch()
            FROM api_keys WHERE tenant_id IS NULL`,
      args: [],
    },
    {
      sql: `INSERT OR IGNORE INTO tenant_members (tenant_id, actor_id, role, status, created_at)
            SELECT 'tn_personal_' || id, 'api_key:' || id, 'owner', 'active',
                   COALESCE(created_at, unixepoch())
            FROM api_keys WHERE tenant_id IS NULL`,
      args: [],
    },
    {
      sql: `INSERT OR IGNORE INTO tenant_environments (environment_id, tenant_id, display_name, status, created_at)
            SELECT id, 'tn_personal_' || id, 'Default environment', 'active',
                   COALESCE(created_at, unixepoch())
            FROM api_keys WHERE tenant_id IS NULL`,
      args: [],
    },
    {
      sql: `UPDATE api_keys
            SET tenant_id = 'tn_personal_' || id
            WHERE tenant_id IS NULL`,
      args: [],
    },
  ], 'write');

  const verification = await client.execute({
    sql: `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN k.tenant_id IS NULL THEN 1 ELSE 0 END) AS unbound,
            SUM(CASE WHEN t.id IS NULL THEN 1 ELSE 0 END) AS missing_tenant,
            SUM(CASE WHEN m.actor_id IS NULL THEN 1 ELSE 0 END) AS missing_owner,
            SUM(CASE WHEN e.environment_id IS NULL OR e.tenant_id <> k.tenant_id THEN 1 ELSE 0 END) AS missing_environment
          FROM api_keys k
          LEFT JOIN tenants t ON t.id = k.tenant_id
          LEFT JOIN tenant_members m ON m.tenant_id = k.tenant_id AND m.actor_id = ('api_key:' || k.id) AND m.role = 'owner' AND m.status = 'active'
          LEFT JOIN tenant_environments e ON e.environment_id = k.id`,
    args: [],
  });
  const row = (verification.rows[0] ?? {}) as Record<string, unknown>;
  const failures = ['unbound', 'missing_tenant', 'missing_owner', 'missing_environment']
    .filter(field => Number(row[field] ?? 0) !== 0);
  if (failures.length) {
    throw new Error(`R1b verification failed (${failures.join(', ')}). Inspect the database before retrying.`);
  }

  const tenantCount = await client.execute({
    sql: "SELECT COUNT(*) AS count FROM tenants WHERE kind = 'personal'",
    args: [],
  });
  console.log(`R1b verified: ${Number(row.total ?? 0)} API keys bound; ${Number(tenantCount.rows[0]?.count ?? 0)} personal tenants exist. No session IDs were changed.`);
  await client.close();
}

main().catch(error => {
  console.error('R1b tenant backfill failed:', error);
  process.exit(1);
});
