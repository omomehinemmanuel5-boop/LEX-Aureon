/**
 * One-off migration: retire benchmark_results id=74 (AdvBench / ASR).
 *
 * id=74 was published 2026-07-08 with a catastrophic LLM-judge failure: the
 * 8B judge fell back to keyword-heuristic scoring on both arms, inflating
 * bare_score to 31.54 and governed_score to 30.58 — a delta collapsed to
 * noise (0.96pp) versus the clean baseline's 1.35pp. judge_methods notes
 * show 'keyword-fallback|llm-judge-harm-compliance' contamination.
 *
 * This is append-only (project philosophy — see lib/benchmark_results.ts
 * header): the row is not deleted, only renamed out of the live 'ASR' metric
 * group so getBenchmarkResults()'s MAX(id)-per-(benchmark,metric_name) query
 * naturally falls back to id=62 (bare 1.54, gov 0.19, delta 1.35pp, clean
 * 520/520, no keyword-fallback tag).
 *
 * IMPORTANT: renaming metric_name alone does not hide the row from the site.
 * lib/benchmark_results.ts's isRetired() is an exact-match allowlist
 * (RETIRED_METRICS), not a suffix/pattern filter. The corresponding entry
 * { benchmark: 'AdvBench', metric_name: 'ASR_RETIRED_JUDGE_EXHAUSTION_2026-07-08' }
 * was added there in the same session this script was written — both changes
 * must ship together or this migration silently creates a second visible
 * "AdvBench" row instead of retiring the bad one.
 *
 * Run via: .github/workflows/run-migration.yml (workflow_dispatch — see that
 * file). It passes TURSO_DATABASE_URL/TURSO_AUTH_TOKEN as real env vars from
 * repo secrets, so this script reads process.env directly.
 *
 * fix (2026-07-08, first CI run): the original version of this script called
 * dotenv.config({path: '.env.local'}) / dotenv.config() at the top, copied
 * from scripts/seed-benchmarks.ts's local-dev pattern. 'dotenv' is not a
 * dependency anywhere in package.json — npm install in the GitHub Actions
 * runner does not install it, so the very first CI run failed immediately
 * with `Error: Cannot find module 'dotenv'` before ever reaching the SQL.
 * dotenv was never actually needed here: this script only runs via the
 * run-migration.yml workflow, which already injects the real secrets as
 * process.env vars directly (no .env.local file exists in that runner
 * either way). Removed the dependency entirely rather than adding dotenv to
 * package.json for a file whose only real execution path doesn't need it.
 * NOTE: scripts/seed-benchmarks.ts has this exact same latent bug and would
 * fail the same way if ever run fresh in CI — untouched here, out of scope
 * for this migration, flagged for whoever next needs that script in CI.
 *
 * Verify after running with:
 *   SELECT id, metric_name, notes FROM benchmark_results WHERE id = 74;
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
    args: [74],
  });

  if (before.rows.length === 0) {
    console.error('id=74 not found — nothing to retire. Aborting without changes.');
    process.exit(1);
  }

  const row = before.rows[0];
  if (row.benchmark !== 'AdvBench' || row.metric_name !== 'ASR') {
    console.error(
      `id=74 does not match expected (benchmark='AdvBench', metric_name='ASR'). ` +
      `Found (benchmark='${row.benchmark}', metric_name='${row.metric_name}'). Aborting — verify manually.`
    );
    process.exit(1);
  }

  console.log('Before:', row);

  await client.execute({
    sql: `UPDATE benchmark_results
          SET metric_name = 'ASR_RETIRED_JUDGE_EXHAUSTION_2026-07-08',
              notes = notes || ' [RETIRED 2026-07-08: catastrophic LLM-judge failure caused keyword-fallback misclassification on both arms symmetrically; delta collapsed to noise; see id=62 for last clean baseline]'
          WHERE id = ?`,
    args: [74],
  });

  const after = await client.execute({
    sql: `SELECT id, benchmark, metric_name, bare_score, governed_score, delta_pp, notes
          FROM benchmark_results WHERE id = ?`,
    args: [74],
  });

  console.log('After:', after.rows[0]);
  console.log('Done. Verify the live site now shows AdvBench ASR from id=62 (bare 1.54, gov 0.19, delta 1.35pp).');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
