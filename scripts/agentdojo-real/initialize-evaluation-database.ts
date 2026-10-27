/**
 * Initialize the isolated Turso store used by the model-in-the-loop evaluator.
 *
 * This is intentionally separate from the evaluator preflight: preflight is
 * read-only, while this one-shot command performs only idempotent CREATE/ALTER
 * work against the explicitly named evaluation database.
 */
import {
  configureEvaluationDatabaseEnvironment,
  evaluationDatabaseCredentials,
} from './preflight';

async function main(): Promise<void> {
  const { url, token } = evaluationDatabaseCredentials();
  if (!url || !token) {
    throw new Error('TURSO_EVAL_DATABASE_URL and TURSO_EVAL_AUTH_TOKEN are required');
  }

  // Configure canonical names before dynamically importing modules that read
  // them. The mapping is process-local and never changes repository secrets.
  configureEvaluationDatabaseEnvironment();
  const { getClient, initSchema } = await import('../../lib/db');
  await initSchema();
  const client = getClient();

  await client.execute(`CREATE TABLE IF NOT EXISTS trajectory_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id TEXT,
    session_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args_hash TEXT NOT NULL,
    state_before_hash TEXT NOT NULL,
    state_after_hash TEXT NOT NULL,
    actual_effect_hash TEXT NOT NULL,
    approved INTEGER NOT NULL,
    decision TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await client.execute(
    'CREATE INDEX IF NOT EXISTS idx_trajectory_receipts_session ON trajectory_receipts(session_id)',
  );

  const result = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('z_traj', 'trajectory_receipts') ORDER BY name",
  );
  const tables = result.rows.map(row => String(row.name));
  if (!tables.includes('z_traj') || !tables.includes('trajectory_receipts')) {
    throw new Error(`Evaluation schema verification failed; found: ${tables.join(', ') || '(none)'}`);
  }
  console.log(`Evaluation database initialized and verified: ${tables.join(', ')}`);
}

main().catch(error => {
  console.error(`Evaluation database initialization failed: ${String(error)}`);
  process.exitCode = 1;
});
