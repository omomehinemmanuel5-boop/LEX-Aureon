/**
 * Read-only R1b database diagnostic.
 *
 * Reports schema/table presence and aggregate row counts only. It never reads
 * credential values, inserts/updates/deletes rows, or initializes schema.
 * Run through the manual Run Migration Script workflow.
 */
import { createClient } from '@libsql/client';

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error('TURSO_DATABASE_URL is not set.');

  const client = createClient({ url, authToken });
  try {
    const tables = await client.execute({
      sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      args: [],
    });
    const names = tables.rows.map(row => String(row.name));
    console.log('READ-ONLY DATABASE DIAGNOSTIC');
    console.log(`Application tables found: ${names.length}`);
    console.log(`Tables: ${names.join(', ') || '(none)'}`);

    for (const table of ['api_keys', 'benchmark_results', 'tenants', 'tenant_members', 'tenant_environments']) {
      if (!names.includes(table)) {
        console.log(`${table}: MISSING`);
        continue;
      }
      const count = await client.execute({ sql: `SELECT COUNT(*) AS count FROM "${table}"`, args: [] });
      console.log(`${table}: PRESENT; rows=${Number(count.rows[0]?.count ?? 0)}`);
    }

    if (names.includes('api_keys')) {
      const columns = await client.execute({ sql: 'PRAGMA table_info(api_keys)', args: [] });
      console.log(`api_keys columns: ${columns.rows.map(row => String(row.name)).join(', ')}`);
      console.log(`api_keys tenant_id column: ${columns.rows.some(row => String(row.name) === 'tenant_id') ? 'PRESENT' : 'MISSING'}`);
    }

    console.log('Diagnostic complete. No schema or data was modified.');
  } finally {
    await client.close();
  }
}

main().catch(error => {
  console.error('R1b read-only database diagnostic failed:', error);
  process.exit(1);
});
