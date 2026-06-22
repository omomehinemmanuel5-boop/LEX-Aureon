/**
 * scripts/lexbench/publish-results.ts
 *
 * Closes the actual gap that left benchmark_results empty: nothing in
 * lexbench-prod.yml ever wrote into the live Turso table the public
 * /api/benchmarks endpoint reads from — the workflow only committed
 * summary.json back into the git repo. This script POSTs the aggregated
 * per-benchmark summary to /api/benchmarks (one row per metric: asr,
 * toxicity, truth_score), using ADMIN_PASSWORD as bearer auth, same as the
 * route already requires for POST.
 *
 * Usage:
 *   ADMIN_PASSWORD=... NEXT_PUBLIC_SITE_URL=https://lexaureon.com \
 *     npx tsx scripts/lexbench/publish-results.ts summary.json
 */

import * as fs from 'fs';

interface BenchmarkSummary {
  benchmark: string;
  total_prompts: number;
  avg_bare_asr: number;
  avg_governed_asr: number;
  asr_delta_pp: number;
  avg_bare_toxicity: number;
  avg_governed_toxicity: number;
  toxicity_delta_pp: number;
  avg_bare_truth_score: number;
  avg_governed_truth_score: number;
  truth_score_delta_pp: number;
}

interface PublishRow {
  benchmark: string;
  run_date: string;
  n_total: number;
  metric_name: string;
  bare_score: number;
  governed_score: number;
  delta_pp: number;
  notes: string;
}

function buildRows(summary: Record<string, BenchmarkSummary>, runDate: string): PublishRow[] {
  const rows: PublishRow[] = [];
  for (const key in summary) {
    const s = summary[key];
    const notes = `LexBench nightly run, n=${s.total_prompts}`;
    rows.push({
      benchmark: s.benchmark, run_date: runDate, n_total: s.total_prompts,
      metric_name: 'asr',
      bare_score: +(s.avg_bare_asr * 100).toFixed(2),
      governed_score: +(s.avg_governed_asr * 100).toFixed(2),
      delta_pp: s.asr_delta_pp, notes,
    });
    rows.push({
      benchmark: s.benchmark, run_date: runDate, n_total: s.total_prompts,
      metric_name: 'toxicity',
      bare_score: +(s.avg_bare_toxicity * 100).toFixed(2),
      governed_score: +(s.avg_governed_toxicity * 100).toFixed(2),
      delta_pp: s.toxicity_delta_pp, notes,
    });
    rows.push({
      benchmark: s.benchmark, run_date: runDate, n_total: s.total_prompts,
      metric_name: 'truth_score',
      bare_score: +(s.avg_bare_truth_score * 100).toFixed(2),
      governed_score: +(s.avg_governed_truth_score * 100).toFixed(2),
      delta_pp: s.truth_score_delta_pp, notes,
    });
  }
  return rows;
}

async function publishRow(endpoint: string, adminPassword: string, row: PublishRow): Promise<void> {
  const res = await fetch(`${endpoint}/api/benchmarks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminPassword}`,
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /api/benchmarks failed for ${row.benchmark}/${row.metric_name}: HTTP ${res.status} ${text}`);
  }
}

async function main() {
  const summaryFile = process.argv[2];
  if (!summaryFile) {
    console.error('Usage: tsx scripts/lexbench/publish-results.ts <summary.json>');
    process.exit(1);
  }
  if (!fs.existsSync(summaryFile)) {
    console.error(`Summary file not found: ${summaryFile}`);
    process.exit(1);
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const endpoint = process.env.NEXT_PUBLIC_SITE_URL;
  if (!adminPassword) { console.error('ADMIN_PASSWORD not set'); process.exit(1); }
  if (!endpoint)       { console.error('NEXT_PUBLIC_SITE_URL not set'); process.exit(1); }

  const summary: Record<string, BenchmarkSummary> = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
  const runDate = new Date().toISOString().slice(0, 10);
  const rows = buildRows(summary, runDate);

  console.log(`Publishing ${rows.length} rows (${Object.keys(summary).length} benchmarks × 3 metrics) to ${endpoint}/api/benchmarks ...`);

  let failures = 0;
  for (const row of rows) {
    try {
      await publishRow(endpoint, adminPassword, row);
      console.log(`  ✓ ${row.benchmark}/${row.metric_name}: bare=${row.bare_score} governed=${row.governed_score} delta=${row.delta_pp}pp`);
    } catch (err) {
      failures++;
      console.error(`  ✗ ${err}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures}/${rows.length} rows failed to publish.`);
    process.exit(1);
  }
  console.log(`\nAll ${rows.length} rows published successfully.`);
}

main();
