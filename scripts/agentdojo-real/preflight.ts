import { createClient } from '@libsql/client';

export interface EvaluationPreflight {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

export function evaluationDatabaseCredentials(): { url?: string; token?: string } {
  return {
    url: process.env.TURSO_EVAL_DATABASE_URL ?? process.env.TURSO_DATABASE_URL,
    token: process.env.TURSO_EVAL_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN,
  };
}

/** Apply evaluation credentials to canonical runtime names for this process only. */
export function configureEvaluationDatabaseEnvironment(): void {
  const { url, token } = evaluationDatabaseCredentials();
  if (url) process.env.TURSO_DATABASE_URL = url;
  if (token) process.env.TURSO_AUTH_TOKEN = token;
}

/**
 * Validate the isolated evaluation store before spending model calls.
 * This is intentionally read-only: the first governed execution is responsible
 * for exercising actual receipt writes. Callers should not score a run when ok
 * is false.
 */
export async function runEvaluationPreflight(): Promise<EvaluationPreflight> {
  const checks: EvaluationPreflight['checks'] = [];
  const { url, token } = evaluationDatabaseCredentials();
  if (!url || !token) {
    return {
      ok: false,
      checks: [{ name: 'credentials', ok: false, detail: 'TURSO_EVAL_DATABASE_URL and TURSO_EVAL_AUTH_TOKEN (or canonical equivalents) are required for a state-backed evaluation' }],
    };
  }
  checks.push({ name: 'credentials', ok: true, detail: 'database credentials are present' });
  try {
    const client = createClient({ url, authToken: token });
    await client.execute('SELECT 1 AS evaluation_preflight');
    checks.push({ name: 'connectivity', ok: true, detail: 'database query succeeded' });
    const result = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('z_traj', 'trajectory_receipts') ORDER BY name");
    const tables = new Set(result.rows.map(row => String(row.name)));
    for (const table of ['z_traj', 'trajectory_receipts']) {
      checks.push({ name: table, ok: tables.has(table), detail: tables.has(table) ? 'required table exists' : 'required table is missing; run application schema initialization against the isolated evaluation database' });
    }
  } catch (error) {
    checks.push({ name: 'connectivity', ok: false, detail: `database preflight failed: ${String(error).slice(0, 180)}` });
  }
  return { ok: checks.every(check => check.ok), checks };
}

export function printEvaluationPreflight(result: EvaluationPreflight): void {
  console.log(`Evaluation preflight: ${result.ok ? 'READY' : 'NOT READY'}`);
  for (const check of result.checks) console.log(`  ${check.ok ? 'ok' : 'FAIL'} ${check.name}: ${check.detail}`);
}
