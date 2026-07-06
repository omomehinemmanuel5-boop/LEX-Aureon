/**
 * scripts/lexbench/publish-results.ts
 *
 * Publishes the aggregated per-benchmark summary into the live Turso table the
 * public site reads (benchmark_results), so a scored run auto-appears on the
 * landing + /benchmarks pages.
 *
 * One metric per benchmark, matching its actual kind:
 *   - AdvBench/HarmBench/JailbreakBench -> "ASR" (LLM-judged harm compliance)
 *   - TruthfulQA                        -> "truthful_pct"
 *   - AgentDojo                         -> "injection_resisted_pct_PROXY"
 *                                          (NOT the official methodology)
 *   - XSTest                            -> "appropriate_pct" (did NOT
 *                                          over-refuse benign prompts —
 *                                          contrast/unsafe set excluded
 *                                          upstream by the transformer)
 *   - StrongREJECT                      -> "refusal_robustness_pct"
 *                                          (normalized 1–5 severity scale,
 *                                          (severity−1)/4, higher=more robust)
 * A benchmark with zero scored_prompts (every judge call failed/unavailable)
 * is skipped entirely rather than publishing a misleading 0%/100%.
 *
 * Usage:
 *   BENCH_SECRET=... NEXT_PUBLIC_SITE_URL=https://www.lexaureon.com \
 *     npx tsx scripts/lexbench/publish-results.ts summary.json
 *   # optional: --dry-run to print the payload without sending
 */

import * as fs from 'fs';

type BenchmarkKind = 'harm' | 'truthfulness' | 'injection' | 'over_refusal' | 'severity';

interface BenchmarkSummary {
  benchmark: string;
  kind: BenchmarkKind;
  total_prompts: number;
  scored_prompts: number;
  judge_methods_used: string[];
  avg_bare_pct?: number;
  avg_governed_pct?: number;
  delta_pp?: number;
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

    if (s.scored_prompts === 0 || s.avg_bare_pct === undefined || s.avg_governed_pct === undefined) {
      console.log(`  (skipping ${s.benchmark} — 0 of ${s.total_prompts} prompts got a usable judge verdict; judge_methods_used=${s.judge_methods_used.join(',')})`);
      continue;
    }

    const scoredNote = s.scored_prompts < s.total_prompts
      ? `scored ${s.scored_prompts}/${s.total_prompts} (rest: judge unavailable)`
      : `scored ${s.scored_prompts}/${s.total_prompts}`;
    const judgeNote = `judge_methods=${s.judge_methods_used.join('|')}`;
    const base = { benchmark: s.benchmark, run_date: runDate, n_total: s.total_prompts, bare_score: s.avg_bare_pct, governed_score: s.avg_governed_pct, delta_pp: s.delta_pp ?? 0 };

    if (s.kind === 'harm') {
      rows.push({ ...base, metric_name: 'ASR',
        notes: `LexBench run, n=${s.total_prompts}; same-model bare=raw_output vs governed (generateGoverned); ASR via LLM judge (harm-compliance rubric approximating HarmBench/JailbreakBench classifiers, NOT the official fine-tuned classifiers); ${scoredNote}; ${judgeNote}` });
    } else if (s.kind === 'truthfulness') {
      rows.push({ ...base, metric_name: 'truthful_pct',
        notes: `LexBench run, n=${s.total_prompts}; truthfulness via LLM judge comparing against the dataset's own correct_answers/incorrect_answers (same reference-comparison as the original paper's fine-tuned GPT-judge, general-purpose model here); does not separately score informativeness; ${scoredNote}; ${judgeNote}` });
    } else if (s.kind === 'injection') {
      rows.push({ ...base, metric_name: 'injection_resisted_pct_PROXY',
        notes: `NOT the official AgentDojo methodology — measures injection-resistance ONLY via text judgment of a single prompt/response pair; no tool-execution harness, no task-utility check, so a model that refuses everything would score well here despite failing every legitimate task. LexBench run, n=${s.total_prompts}; ${scoredNote}; ${judgeNote}` });
    } else if (s.kind === 'over_refusal') {
      rows.push({ ...base, metric_name: 'appropriate_pct',
        notes: `XSTest (Röttger et al., NAACL 2024) over-refusal check — percentage of BENIGN prompts answered appropriately rather than refused on incorrect safety grounds; higher is better. The dataset's 200-prompt "contrast" set of genuinely unsafe prompts is excluded upstream (not part of this metric — see transform-xstest.ts). LLM judge, general-purpose model, not the paper's own annotation process. LexBench run, n=${s.total_prompts}; ${scoredNote}; ${judgeNote}` });
    } else {
      rows.push({ ...base, metric_name: 'refusal_robustness_pct',
        notes: `StrongREJECT (Souly et al. 2024) refusal-quality severity, normalized: judge rates 1 (fully complies, worst) to 5 (complete robust refusal, best), reported here as (severity-1)/4 × 100; higher is better. Captures nuance ASR misses (e.g. a substantive-but-hedged compliance vs a clean refusal) but is NOT the official StrongREJECT scoring pipeline. LexBench run, n=${s.total_prompts}; ${scoredNote}; ${judgeNote}` });
    }
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
    console.log(`[dry-run] would publish ${rows.length} rows across ${Object.keys(summary).length} benchmarks:`);
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
  if (rows.length === 0) {
    console.log('No benchmarks had a usable judge verdict — nothing to publish.');
    return;
  }

  console.log(`Publishing ${rows.length} rows across ${Object.keys(summary).length} benchmarks to ${endpoint}/api/benchmarks/publish ...`);

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
