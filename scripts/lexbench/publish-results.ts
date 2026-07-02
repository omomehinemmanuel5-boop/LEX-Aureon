/**
 * scripts/lexbench/publish-results.ts
 *
 * Publishes the aggregated per-benchmark summary into the live Turso table the
 * public site reads (benchmark_results), so a scored run auto-appears on the
 * landing + /benchmarks pages.
 *
 * FIX (2026-07): previously this POSTed to `/api/benchmarks` (a reader route
 * with no writer) using ADMIN_PASSWORD. The ONLY writer is
 * `/api/benchmarks/publish`, gated on BENCH_SECRET (see
 * app/api/benchmarks/publish/route.ts). So every publish hit the wrong endpoint
 * with the wrong auth and failed silently — which is exactly why
 * benchmark_results stayed empty despite nightly runs. This now targets the
 * canonical writer with BENCH_SECRET and sends all rows in one array POST
 * (the endpoint accepts an array), matching the benchmark-repo publisher so
 * there is a single, consistent publish path.
 *
 * The row shape already matches the endpoint schema exactly:
 *   { benchmark, run_date, n_total, metric_name, bare_score, governed_score,
 *     delta_pp, notes }   (scores are percentages 0–100)
 *
 * Usage:
 *   BENCH_SECRET=... NEXT_PUBLIC_SITE_URL=https://lexaureon.com \
 *     npx tsx scripts/lexbench/publish-results.ts summary.json
 *   # optional: --dry-run to print the payload without sending
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
    const notes = `LexBench run, n=${s.total_prompts}; same-model bare=raw_output vs governed (generateGoverned); heuristic refusal judge`;
    rows.push({
      benchmark: s.benchmark, run_date: runDate, n_total: s.total_prompts,
      metric_name: 'ASR',
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

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const summaryFile = args.find(a => !a.startsWith('--'));

  if (!summaryFile) {
    console.error('Usage: BENCH_SECRET=... NEXT_PUBLIC_SITE_URL=... tsx scripts/lexbench/publish-results.ts <summary.json> [--dry-run]');
    process.exit(1);
  }
  if (!fs.existsSync(summaryFile)) {
    console.error(`Summary file not found: ${summaryFile}`);
    process.exit(1);
  }

  const summary: Record<string, BenchmarkSummary> = JSON.parse(fs.readFileSync(summaryFile, 'utf-8'));
  const runDate = new Date().toISOString().slice(0, 10);
  const rows = buildRows(summary, runDate);

  if (dryRun) {
    console.log(`[dry-run] would publish ${rows.length} rows (${Object.keys(summary).length} benchmarks × 3 metrics):`);
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const secret = process.env.BENCH_SECRET;
  const endpoint = process.env.NEXT_PUBLIC_SITE_URL;
  if (!secret) {
    console.error('BENCH_SECRET not set. Add it as a GitHub Actions secret (same value as the Vercel BENCH_SECRET env var) — it is the auth for the /api/benchmarks/publish writer.');
    process.exit(1);
  }
  if (!endpoint) { console.error('NEXT_PUBLIC_SITE_URL not set'); process.exit(1); }

  console.log(`Publishing ${rows.length} rows (${Object.keys(summary).length} benchmarks × 3 metrics) to ${endpoint}/api/benchmarks/publish ...`);

  // The publish endpoint accepts an array — send all rows atomically in one call.
  const res = await fetch(`${endpoint}/api/benchmarks/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify(rows),
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error(`\nPublish failed: HTTP ${res.status} ${text}`);
    process.exit(1);
  }

  console.log(`\nPublished successfully: ${text}`);
  for (const row of rows) {
    console.log(`  ✓ ${row.benchmark}/${row.metric_name}: bare=${row.bare_score} governed=${row.governed_score} delta=${row.delta_pp}pp`);
  }
}

main().catch(e => { console.error('[publish] fatal:', e); process.exit(1); });
