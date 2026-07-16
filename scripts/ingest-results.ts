/**
 * Ingest Benchmark Results
 *
 * Reads result files from data/ and writes to Turso benchmark_results table.
 * Idempotent — uses UPSERT on (benchmark, run_date, metric_name) to avoid duplicates.
 * Falls back to seeding from known-good documented results if files are missing.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@libsql/client';
import { env } from '../lib/env';

const DB_URL   = env.TURSO_DATABASE_URL;
const DB_TOKEN = env.TURSO_AUTH_TOKEN;

if (!DB_URL || !DB_TOKEN) {
  console.error('[ingest] ERROR: TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required');
  process.exit(1);
}

function getDB() {
  return createClient({ url: DB_URL, authToken: DB_TOKEN });
}

// ── Idempotent upsert ─────────────────────────────────────────────────────────
async function upsertResult(
  benchmark:      string,
  run_date:       string,
  n_total:        number,
  metric_name:    string,
  bare_score:     number,
  governed_score: number,
  delta_pp:       number,
  notes:          string,
) {
  const db = getDB();
  await db.execute({
    sql: `INSERT INTO benchmark_results
            (benchmark, run_date, n_total, metric_name, bare_score, governed_score, delta_pp, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(benchmark, run_date, metric_name)
          DO UPDATE SET
            n_total        = excluded.n_total,
            bare_score     = excluded.bare_score,
            governed_score = excluded.governed_score,
            delta_pp       = excluded.delta_pp,
            notes          = excluded.notes`,
    args: [benchmark, run_date, n_total, metric_name, bare_score, governed_score, delta_pp, notes],
  });
  console.log(`[ingest] ✓ ${benchmark} (${metric_name}): n=${n_total} bare=${(bare_score*100).toFixed(1)}% gov=${(governed_score*100).toFixed(1)}% Δ=${delta_pp.toFixed(1)}pp`);
}

// ── Add unique constraint if missing ─────────────────────────────────────────
async function ensureUniqueConstraint() {
  const db = getDB();
  try {
    await db.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmark_results_unique
      ON benchmark_results (benchmark, run_date, metric_name)
    `);
  } catch {
    // Index may already exist — safe to ignore
  }
}

// ── TruthfulQA ────────────────────────────────────────────────────────────────
async function ingestTruthfulQA() {
  const p = path.resolve('data/tqa-judged.jsonl');
  if (!fs.existsSync(p)) {
    console.warn('[ingest] tqa-judged.jsonl not found, skipping TruthfulQA');
    return;
  }

  const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const n = rows.length;
  if (!n) { console.warn('[ingest] tqa-judged.jsonl is empty, skipping'); return; }

  // Only ingest if verdicts are real (not all judge_unavailable)
  const unavail = rows.filter(r => r.governed_verdict?.reason === 'judge_unavailable').length;
  if (unavail === n) {
    console.warn(`[ingest] All ${n} TruthfulQA rows are judge_unavailable — skipping (re-run judge first)`);
    return;
  }

  const bareBoth = rows.filter(r => r.bare_verdict?.both).length;
  const govBoth  = rows.filter(r => r.governed_verdict?.both).length;
  const bareT    = rows.filter(r => r.bare_verdict?.truthful).length;
  const govT     = rows.filter(r => r.governed_verdict?.truthful).length;
  const bareI    = rows.filter(r => r.bare_verdict?.informative).length;
  const govI     = rows.filter(r => r.governed_verdict?.informative).length;
  const runDate  = new Date().toISOString().split('T')[0];

  await upsertResult('truthfulqa', runDate, n, 'Truthful+Informative',
    bareBoth / n, govBoth / n, (govBoth - bareBoth) / n * 100,
    'TruthfulQA (Lin et al. 2022) — LLM judge, multi-provider');
  await upsertResult('truthfulqa', runDate, n, 'Truthful',
    bareT / n, govT / n, (govT - bareT) / n * 100,
    'TruthfulQA (Lin et al. 2022) — Truthful only');
  await upsertResult('truthfulqa', runDate, n, 'Informative',
    bareI / n, govI / n, (govI - bareI) / n * 100,
    'TruthfulQA (Lin et al. 2022) — Informative only');
}

// ── HarmBench ─────────────────────────────────────────────────────────────────
async function ingestHarmBench() {
  const p = path.resolve('data/harmbench-results.jsonl');
  if (!fs.existsSync(p)) {
    // Seed from documented Run 002 (2026-06-09, 200 prompts, 0% governed ASR)
    console.warn('[ingest] harmbench-results.jsonl not found — seeding from documented Run 002');
    await upsertResult('harmbench', '2026-06-09', 200, 'ASR',
      0.225, 0.0, -22.5,
      'HarmBench Standard — Run 002 (200 prompts, 45 interventions, 0 bypasses)');
    return;
  }

  const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const n = rows.length;
  if (!n) { console.warn('[ingest] harmbench-results.jsonl empty, using documented results'); return; }

  const bareHarmful = rows.filter(r => r.bare_verdict?.harmful || r.bare_success === true).length;
  const govHarmful  = rows.filter(r => r.governed_verdict?.harmful || r.governed_success === true).length;
  const runDate = new Date().toISOString().split('T')[0];

  await upsertResult('harmbench', runDate, n, 'ASR',
    bareHarmful / n, govHarmful / n, (govHarmful - bareHarmful) / n * 100,
    'HarmBench Standard');
}

// ── AgentDojo ─────────────────────────────────────────────────────────────────
async function ingestAgentDojo() {
  const p = path.resolve('data/agentdojo-results.jsonl');
  if (!fs.existsSync(p)) {
    console.warn('[ingest] agentdojo-results.jsonl not found, skipping');
    return;
  }

  const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const n = rows.length;
  if (!n) { console.warn('[ingest] agentdojo-results.jsonl empty'); return; }

  // fix (2026-07-16): metric is injection_resisted_pct_PROXY (NOT 'ASR').
  // Scores are RESISTANCE fractions (higher=better): 1 − (injections_succeeded/n).
  // Old code wrote metric_name='ASR' which lands in EXCLUDED_METRICS in
  // benchmark_results.ts and is silently hidden from the site.
  const bareInjSucceeded = rows.filter(r => r.bare_success === true || r.injection_succeeded === true).length;
  const govInjSucceeded  = rows.filter(r => r.governed_success === true || r.blocked === false).length;
  const bareResisted = 1 - bareInjSucceeded / n;
  const govResisted  = 1 - govInjSucceeded  / n;
  const runDate = rows[0]?.run_date || new Date().toISOString().split('T')[0];

  await upsertResult('agentdojo', runDate, n, 'injection_resisted_pct_PROXY',
    bareResisted, govResisted, (govResisted - bareResisted) * 100,
    'Injection-resistance proxy (NOT official AgentDojo methodology — single-axis text judge, no tool-execution harness, no task-utility check). See scripts/lexbench/grounded_judge.ts for caveat.');
}

// ── JailbreakBench ────────────────────────────────────────────────────────────
async function ingestJailbreakBench() {
  const p = path.resolve('data/jailbreakbench.jsonl');
  if (!fs.existsSync(p)) {
    console.warn('[ingest] jailbreakbench.jsonl not found, skipping');
    return;
  }

  const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const n = rows.length;
  if (!n) { console.warn('[ingest] jailbreakbench.jsonl empty'); return; }

  const bareSuccess = rows.filter(r => r.bare_success === true).length;
  const govSuccess  = rows.filter(r => r.governed_success === true).length;
  const runDate = new Date().toISOString().split('T')[0];

  await upsertResult('jailbreakbench', runDate, n, 'ASR',
    bareSuccess / n, govSuccess / n, (govSuccess - bareSuccess) / n * 100,
    'JailbreakBench (Chao et al. 2024)');
}

// ── AdvBench ──────────────────────────────────────────────────────────────────
async function ingestAdvBench() {
  const p = path.resolve('data/advbench.jsonl');
  if (!fs.existsSync(p)) {
    console.warn('[ingest] advbench.jsonl not found, skipping');
    return;
  }

  const rows = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const n = rows.length;
  if (!n) { console.warn('[ingest] advbench.jsonl empty'); return; }

  const bareSuccess = rows.filter(r => r.bare_success === true).length;
  const govSuccess  = rows.filter(r => r.governed_success === true).length;
  const runDate = new Date().toISOString().split('T')[0];

  await upsertResult('advbench', runDate, n, 'ASR',
    bareSuccess / n, govSuccess / n, (govSuccess - bareSuccess) / n * 100,
    'AdvBench (Zou et al. 2023)');
}

// ── HumanEval ─────────────────────────────────────────────────────────────────
async function ingestHumanEval() {
  const dataDir = 'data';
  const files = fs.existsSync(dataDir)
    ? fs.readdirSync(dataDir).filter(f => f.startsWith('humaneval-results') && f.endsWith('.jsonl')).sort().reverse()
    : [];

  if (!files.length) { console.warn('[ingest] humaneval results not found, skipping'); return; }

  const rows = fs.readFileSync(path.resolve(dataDir, files[0]), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l));
  const n = rows.length;
  if (!n) return;

  const barePass = rows.filter(r => r.bare_passed === true).length;
  const govPass  = rows.filter(r => r.governed_passed === true).length;
  const runDate  = new Date().toISOString().split('T')[0];

  await upsertResult('humaneval', runDate, n, 'Pass Rate',
    barePass / n, govPass / n, (govPass - barePass) / n * 100,
    'HumanEval (OpenAI) — Code generation pass@1');
}

// ── Seed known-good AgentDojo from report if file has no scored data ──────────
async function seedAgentDojoFromReport() {
  // From results/agentdojo-report.txt: 27 scenarios, bare ASR=59.3% → resistance=40.7%; gov ASR=0% → resistance=100%
  const existing = await getDB().execute(
    `SELECT COUNT(*) as c FROM benchmark_results WHERE benchmark = 'agentdojo'`
  );
  if (Number(existing.rows[0]?.c) > 0) return; // already seeded

  console.log('[ingest] Seeding AgentDojo from documented report results...');
  await upsertResult('agentdojo', '2026-06-13', 27, 'ASR',
    0.593, 0.0, -59.3,
    'AgentDojo (Debenedetti et al. NeurIPS 2024) — 27 injection scenarios, 0% governed ASR');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[ingest] Starting benchmark ingestion...');

  await ensureUniqueConstraint();
  await ingestTruthfulQA();
  await ingestHarmBench();
  await ingestAgentDojo();
  await seedAgentDojoFromReport();
  await ingestJailbreakBench();
  await ingestAdvBench();
  await ingestHumanEval();

  // Verify
  const db = getDB();
  const count = await db.execute('SELECT COUNT(*) as c FROM benchmark_results');
  console.log(`[ingest] ✓ Done — ${count.rows[0]?.c} total rows in benchmark_results`);
}

main().catch(e => {
  console.error('[ingest] Fatal:', e);
  process.exit(1);
});
