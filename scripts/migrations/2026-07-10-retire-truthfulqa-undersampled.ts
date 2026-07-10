/**
 * One-off migration: retire benchmark_results id=95 (TruthfulQA / truthful_pct).
 *
 * id=95 was published from a run where 814 of 817 TruthfulQA prompts hit
 * total provider exhaustion (all 5 LLM providers down); only 3 prompts got
 * a real judge verdict. That n=3 sample published as if it were the full
 * n=817 attempt: bare=60%, governed=0%, delta=-60pp — statistically
 * meaningless noise from 3 data points, displayed with a misleadingly large
 * n_total.
 *
 * This is exactly the gap fixed in scripts/lexbench/aggregate-report.ts
 * (minimum coverage gate, 30% / 10-sample floor) and
 * scripts/lexbench/publish-results.ts (n_total now reports scored count,
 * not attempted count) in this same session — this migration retires the
 * one row that got published before those fixes landed.
 *
 * Run via: .github/workflows/run-migration.yml (workflow_dispatch),
 * script_path=scripts/migrations/2026-07-10-retire-truthfulqa-undersampled.ts
 */

import { createClient } from '@libsql/client';

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error('TURSO_DATABASE_URL is not set');
    process.exit(1);
  }

  const client = createClient({ url, authToken });

  const before = await client.execute({
    sql: `SELECT id, benchmark, metric_name, n_total, bare_score, governed_score, notes
          FROM benchmark_results WHERE id = ?`,
    args: [95],
  });

  if (before.rows.length === 0) {
    console.error('id=95 not found — nothing to retire. Aborting without changes.');
    process.exit(1);
  }

  const row = before.rows[0];
  if (row.benchmark !== 'TruthfulQA' || row.metric_name !== 'truthful_pct') {
    console.error(
      `id=95 does not match expected (benchmark='TruthfulQA', metric_name='truthful_pct'). ` +
      `Found (benchmark='${row.benchmark}', metric_name='${row.metric_name}'). Aborting — verify manually.`
    );
    process.exit(1);
  }

  console.log('Before:', row);

  await client.execute({
    sql: `UPDATE benchmark_results
          SET metric_name = 'truthful_pct_RETIRED_UNDERSAMPLED_2026-07-10',
              notes = notes || ' [RETIRED 2026-07-10: n=3 scored out of 817 attempted (814 hit provider exhaustion), published before the minimum-coverage gate was added to aggregate-report.ts]'
          WHERE id = ?`,
    args: [95],
  });

  const after = await client.execute({
    sql: `SELECT id, benchmark, metric_name, bare_score, governed_score, notes
          FROM benchmark_results WHERE id = ?`,
    args: [95],
  });

  console.log('After:', after.rows[0]);
  console.log('Done. Verify the live site now falls back to the last adequately-sampled TruthfulQA row.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
