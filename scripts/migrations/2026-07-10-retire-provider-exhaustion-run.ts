/**
 * One-off migration: retire benchmark_results ids 90-94.
 *
 * These are NOT a real measurement of governance behavior -- they're a mass
 * provider-exhaustion event. Verified directly against the raw shard-0
 * artifact from GitHub Actions run 29088128698: 52-86% of prompts across
 * every benchmark in the run had BOTH raw_output and governed_output equal
 * to the literal static fallback string "Constitutional framework C + R + S
 * = 1 is operative." (SovereignKernel.callLLM's fallback when all 5
 * providers -- Groq primary/fast, Mistral, Gemini lite/full -- are
 * exhausted on a single request). This is almost certainly real external
 * API quota exhaustion (Groq/Gemini/Mistral daily or per-minute limits),
 * likely compounded by unusually heavy same-day traffic: multiple full and
 * partial LexBench runs, dozens of manual smoke-test calls to /api/lex/govern
 * and /api/lex/govern/stream, and the two earlier cancelled runs (which
 * still consumed real quota before being killed) -- all on 2026-07-10.
 *
 * Downstream effect on each benchmark's published number:
 *   - AdvBench/HarmBench/JailbreakBench (judgeHarmCompliance): mostly
 *     correctly returned null/'unavailable' for the fallback string (not a
 *     genuine harm-compliance attempt) -- but published bare=0/gov=0/delta=0
 *     anyway, meaning the near-empty scored set collapsed to a false "0%"
 *     rather than being excluded. That collapse-to-zero-instead-of-excluded
 *     behavior in the publish pipeline is a SEPARATE bug from the
 *     exhaustion itself and needs its own investigation -- not fixed by
 *     this migration.
 *   - AgentDojo/TruthfulQA (judgeInjectionResistanceProxy/judgeTruthfulness):
 *     did NOT return null for the fallback string -- they produced a real
 *     (if degenerate) verdict: a non-answer trivially "resists" an
 *     injection (pushing AgentDojo to 100%/100%) and trivially fails
 *     "truthful" (pushing TruthfulQA from its normal ~80% down to ~21%).
 *
 * Also exposed a real, separate gap: lib/sovereign_kernel.ts's runCycle()
 * already reports `governed_source` ('governed'|'raw_fallback'|'unavailable')
 * and this was surfaced in the /api/lex/govern response on 2026-07-08
 * specifically so scripts/lexbench/runner.ts could exclude exhausted turns
 * from scoring -- but runner.ts's callGovernAPI() was never actually updated
 * to read that field. That wiring is still incomplete; tracked separately,
 * not fixed here.
 *
 * Ids and pre-migration state (verified before writing this script):
 *   90 | TruthfulQA     | truthful_pct                   | n=817, bare=20.75, gov=21.3
 *   91 | AdvBench       | ASR                             | n=520, bare=0,     gov=0
 *   92 | JailbreakBench | ASR                             | n=200, bare=0,     gov=0
 *   93 | HarmBench      | ASR                             | n=200, bare=0,     gov=0
 *   94 | AgentDojo      | injection_resisted_pct_PROXY   | n=27,  bare=100,   gov=100
 *
 * With these retired, the site falls back to ids 86-89 (2026-07-10 03:45:56,
 * the earlier partial/cancelled run, pre-dating the concurrency fix) for
 * AdvBench/TruthfulQA/HarmBench/JailbreakBench, and the last known-good
 * AgentDojo row before that for AgentDojo. Those are a genuine, if
 * incomplete-sample, improvement over ids 90-94 -- not guaranteed
 * contamination-free themselves, but not showing the same implausible
 * exact-zero/exact-hundred signature either.
 *
 * Run via: .github/workflows/run-migration.yml (workflow_dispatch),
 * script_path=scripts/migrations/2026-07-10-retire-provider-exhaustion-run.ts
 */

import { createClient } from '@libsql/client';

const TARGETS: Array<{ id: number; benchmark: string; metric_name: string }> = [
  { id: 90, benchmark: 'TruthfulQA',     metric_name: 'truthful_pct' },
  { id: 91, benchmark: 'AdvBench',       metric_name: 'ASR' },
  { id: 92, benchmark: 'JailbreakBench', metric_name: 'ASR' },
  { id: 93, benchmark: 'HarmBench',      metric_name: 'ASR' },
  { id: 94, benchmark: 'AgentDojo',      metric_name: 'injection_resisted_pct_PROXY' },
];

const RETIRED_SUFFIX = '_RETIRED_PROVIDER_EXHAUSTION_2026-07-10';

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

    const newMetricName = target.metric_name + RETIRED_SUFFIX;
    await client.execute({
      sql: `UPDATE benchmark_results
            SET metric_name = ?,
                notes = notes || ' [RETIRED 2026-07-10: mass provider-exhaustion event, 52-86% of prompts in this run hit the static callLLM fallback string across all 5 providers -- verified directly against raw shard artifacts from GH Actions run 29088128698, not a genuine measurement of model/governance behavior]'
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
    console.error(`${failures.length} row(s) were skipped — see above.`);
    process.exit(1);
  }
  console.log('All 5 rows retired successfully.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
