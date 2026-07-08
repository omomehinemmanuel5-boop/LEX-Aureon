/**
 * One-off migration: retire benchmark_results id=68 (AdvBench / ASR).
 *
 * id=68 was published 2026-07-08, ~20 minutes before id=74's catastrophic
 * failure, and carries the same 'keyword-fallback' tag in judge_methods at
 * lower severity: bare_score=3.85, governed_score=3.27, delta=0.58pp.
 *
 * Evidence this is contamination, not a real measurement:
 *   - governed_score=3.27 is a ~17x outlier against every other governed
 *     measurement in this benchmark's history (all other rows cluster
 *     0-0.19).
 *   - delta compressed to 0.58pp against a consistent 1.15-1.35pp trend in
 *     neighboring runs (id=47: 1.35, id=55: 1.15, id=62: 1.35).
 *   - Same symmetric bare+governed inflation signature documented for id=74
 *     (see that migration script / RETIRED_METRICS entry), just a smaller
 *     fraction of the 520 prompts apparently hit the fallback path this
 *     time.
 *
 * With this and id=74 both retired, AdvBench/ASR falls back to id=62 (bare
 * 1.54, gov 0.19, delta 1.35pp, clean 520/520, no keyword-fallback tag) --
 * the last AdvBench run scored entirely by real judge verdicts.
 *
 * Append-only (project philosophy, see lib/benchmark_results.ts header): the
 * row is renamed out of the live 'ASR' metric group, not deleted.
 *
 * Run via: .github/workflows/run-migration.yml (workflow_dispatch), passing
 * script_path=scripts/migrations/2026-07-08-retire-advbench-id68.ts. That
 * workflow injects TURSO_DATABASE_URL/TURSO_AUTH_TOKEN as real env vars, so
 * this script reads process.env directly -- no dotenv dependency (see the
 * id=74 migration script's header for why that matters: dotenv isn't in
 * package.json and the first id=74 CI run failed on exactly this).
 *
 * Verify after running with:
 *   SELECT id, metric_name, notes FROM benchmark_results WHERE id = 68;
 * and confirm getBenchmarkResults() / the live site now shows id=62's
 * numbers (bare 1.54, gov 0.19, delta 1.35pp) for AdvBench.
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
    sql: `SELECT id, benchmark, metric_name, bare_score, governed_score, delta_pp, notes
          FROM benchmark_results WHERE id = ?`,
    args: [68],
  });

  if (before.rows.length === 0) {
    console.error('id=68 not found — nothing to retire. Aborting without changes.');
    process.exit(1);
  }

  const row = before.rows[0];
  if (row.benchmark !== 'AdvBench' || row.metric_name !== 'ASR') {
    console.error(
      `id=68 does not match expected (benchmark='AdvBench', metric_name='ASR'). ` +
      `Found (benchmark='${row.benchmark}', metric_name='${row.metric_name}'). Aborting — verify manually.`
    );
    process.exit(1);
  }

  console.log('Before:', row);

  await client.execute({
    sql: `UPDATE benchmark_results
          SET metric_name = 'ASR_RETIRED_KEYWORD_FALLBACK_2026-07-08',
              notes = notes || ' [RETIRED 2026-07-08: keyword-fallback contamination, same root cause as id=74 at lower severity; governed_score=3.27 is a ~17x outlier vs benchmark history (0-0.19 elsewhere), delta compressed vs 1.15-1.35pp trend; see id=62 for last clean baseline]'
          WHERE id = ?`,
    args: [68],
  });

  const after = await client.execute({
    sql: `SELECT id, benchmark, metric_name, bare_score, governed_score, delta_pp, notes
          FROM benchmark_results WHERE id = ?`,
    args: [68],
  });

  console.log('After:', after.rows[0]);
  console.log('Done. Verify the live site now shows AdvBench ASR from id=62 (bare 1.54, gov 0.19, delta 1.35pp).');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
