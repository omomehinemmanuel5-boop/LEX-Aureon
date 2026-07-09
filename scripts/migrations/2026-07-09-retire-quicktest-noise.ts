/**
 * One-off migration: retire benchmark_results ids 76-80.
 *
 * These are NOT a flawed benchmark run -- they're an operator error. A
 * quick-test dispatch of LexBench Production (workflow_dispatch, limit=10,
 * meant only to validate today's judge/concurrency/HarmBench-retry fixes
 * end-to-end before committing to an expensive full run) published its
 * n=10-per-benchmark results to the live leaderboard, because the
 * "Publish results to live leaderboard" step's guard only checked
 * event_name (true for both a real full run and a quick-test run) --
 * unlike the "Commit summary to repo" step below it, which already
 * correctly excluded quick-test mode. Fixed in
 * .github/workflows/lexbench-prod.yml (2026-07-09) and mirrored in
 * lexbench-extended.yml, which had the identical bug.
 *
 * These 5 rows became the new MAX(id) for their (benchmark, metric_name)
 * groups and were live on the site for a short window, including
 * overwriting the AdvBench id=62 clean baseline that this same session had
 * just finished restoring.
 *
 * Ids and their pre-migration state (verified before writing this script):
 *   76 | TruthfulQA     | truthful_pct                   | n=10
 *   77 | AgentDojo      | injection_resisted_pct_PROXY   | n=10
 *   78 | JailbreakBench | ASR                             | n=10
 *   79 | AdvBench       | ASR                             | n=10
 *   80 | HarmBench      | ASR                             | n=10
 *
 * Append-only (project philosophy): rows are renamed, not deleted, even
 * though these carry no genuine methodological value (unlike id=68/74's
 * partial-contamination case) -- consistency with the established pattern
 * matters more than the marginal audit value lost by keeping them findable
 * under a distinct retired name.
 *
 * Run via: .github/workflows/run-migration.yml (workflow_dispatch),
 * script_path=scripts/migrations/2026-07-09-retire-quicktest-noise.ts
 */

import { createClient } from '@libsql/client';

const TARGETS: Array<{ id: number; benchmark: string; metric_name: string }> = [
  { id: 76, benchmark: 'TruthfulQA',     metric_name: 'truthful_pct' },
  { id: 77, benchmark: 'AgentDojo',      metric_name: 'injection_resisted_pct_PROXY' },
  { id: 78, benchmark: 'JailbreakBench', metric_name: 'ASR' },
  { id: 79, benchmark: 'AdvBench',       metric_name: 'ASR' },
  { id: 80, benchmark: 'HarmBench',      metric_name: 'ASR' },
];

const RETIRED_SUFFIX = '_RETIRED_QUICKTEST_2026-07-09';

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    console.error('TURSO_DATABASE_URL is not set');
    process.exit(1);
  }

  const client = createClient({ url, authToken });
  const results: Array<{ id: number; ok: boolean; detail: string }> = [];

  for (const target of TARGETS) {
    const before = await client.execute({
      sql: `SELECT id, benchmark, metric_name, n_total, bare_score, governed_score
            FROM benchmark_results WHERE id = ?`,
      args: [target.id],
    });

    if (before.rows.length === 0) {
      results.push({ id: target.id, ok: false, detail: 'not found, skipped' });
      continue;
    }

    const row = before.rows[0];
    if (row.benchmark !== target.benchmark || row.metric_name !== target.metric_name) {
      results.push({
        id: target.id, ok: false,
        detail: `mismatch: expected (${target.benchmark}, ${target.metric_name}), found (${row.benchmark}, ${row.metric_name}) — skipped, verify manually`,
      });
      continue;
    }
    if (Number(row.n_total) !== 10) {
      results.push({
        id: target.id, ok: false,
        detail: `n_total is ${row.n_total}, not the expected 10 — this may not be the quick-test row, skipped, verify manually`,
      });
      continue;
    }

    const newMetricName = target.metric_name + RETIRED_SUFFIX;
    await client.execute({
      sql: `UPDATE benchmark_results
            SET metric_name = ?,
                notes = notes || ' [RETIRED 2026-07-09: accidental publish from a quick-test workflow_dispatch (limit=10) meant only for pipeline validation; publish step lacked a quick-test guard, since fixed]'
            WHERE id = ?`,
      args: [newMetricName, target.id],
    });

    results.push({ id: target.id, ok: true, detail: `renamed metric_name -> ${newMetricName}` });
  }

  console.log('Migration results:');
  for (const r of results) {
    console.log(`  id=${r.id}: ${r.ok ? 'OK' : 'SKIPPED'} — ${r.detail}`);
  }

  const failures = results.filter(r => !r.ok);
  if (failures.length > 0) {
    console.error(`${failures.length} row(s) were skipped — see above. Fix RETIRED_METRICS / verify manually for those before assuming the site is fully clean.`);
    process.exit(1);
  }
  console.log('All 5 rows retired successfully.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
