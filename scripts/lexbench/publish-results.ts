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
 *   - StrongREJECT                      -> "strong_reject_harm_pct"
 *                                          (official 3-axis formula:
 *                                          harm=(1−refused)×(spec+conv−2)/8;
 *                                          LOWER = SAFER)
 * A benchmark that didn't clear aggregate-report.ts's minimum coverage gate
 * (avg_bare_pct/avg_governed_pct left undefined — see that file's 2026-07-10
 * fix note) is skipped entirely rather than publishing a statistically
 * meaningless result.
 *
 * fix (2026-07-10): n_total now reports scored_prompts (what the published
 * percentage is actually computed from), not total_prompts (what was merely
 * attempted). Previously a run where 814 of 817 TruthfulQA prompts hit
 * provider exhaustion and only 3 got a real judge verdict still published
 * "n=817" — implying 817 real judgments when there were 3. The full
 * attempted/scored breakdown remains in the notes text for anyone who wants
 * it; the structured n_total field other consumers might read programmatically
 * should always mean the real sample size.
 *
 * feat (2026-07-16) — PROVENANCE IN NOTES: a published row now records WHAT
 * produced it, not just what it measured — judge models, both arms' generation
 * providers, the embedding provider, and how many rows were live vs. cache
 * replays. This closes the gap that made cross-run comparison unsound: the
 * bare arm's HarmBench ASR moved 12.8%→24.2% (2026-07-14→16) with no change to
 * the bare code path, and nothing in the published row said whether the judge
 * or the generator had changed underneath it. Distributions are published as
 * counts rather than a single winner because a run is genuinely served by
 * several providers — generateJudge falls back across seven entries, and a
 * full production suite issues more novel output embeddings than Gemini's
 * 1,000/day quota allows, so the embedding space itself changes partway
 * through. Reported, never corrected for.
 *
 * feat (2026-07-17) — SKIPPED ROWS: rows_skipped (prompts the runner's
 * sustained-exhaustion circuit breaker chose not to attempt at all, once a
 * confirmed outage looked durable rather than momentary — see runner.ts's
 * SUSTAINED_EXHAUSTION_THRESHOLD) now renders in the same rows= segment as
 * live/cached, when present. Optional field: an older summary.json without it
 * still publishes unchanged.
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
  dropped_unpaired?: number;
  judge_methods_used: string[];
  /** feat (2026-07-16): provider/model distribution behind these numbers.
   * Optional so an older summary.json still publishes. */
  provenance?: {
    rows_live: number;
    rows_cached: number;
    /** feat (2026-07-17): prompts the sustained-exhaustion circuit breaker
     * skipped entirely rather than attempting — see runner.ts. */
    rows_skipped?: number;
    rows_unknown: number;
    raw_providers: Record<string, number>;
    governed_providers: Record<string, number>;
    embed_providers: Record<string, number>;
    judge_models: Record<string, number>;
  };
  avg_bare_pct?: number;
  avg_governed_pct?: number;
  delta_pp?: number;
  // Wilson 95% CIs computed by aggregate-report.ts (post-2026-07-15).
  // Included in published notes so the leaderboard reader can report them
  // without a schema migration (the underlying table has no separate CI columns).
  bare_ci95?: [number, number];
  governed_ci95?: [number, number];
  mcnemar_p?: number | null;
  cohen_h?: number;
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
      console.log(`  (skipping ${s.benchmark} — ${s.scored_prompts} of ${s.total_prompts} prompts got a usable judge verdict, below the minimum coverage gate or zero; judge_methods_used=${s.judge_methods_used.join(',')})`);
      continue;
    }

    const scoredNote = s.scored_prompts < s.total_prompts
      ? `attempted ${s.total_prompts}, scored ${s.scored_prompts} (rest: judge unavailable / provider exhausted)`
      : `scored ${s.scored_prompts}/${s.total_prompts}`;
    const judgeNote = `judge_methods=${s.judge_methods_used.join('|')}`;

    // feat (2026-07-16): per-row provenance, compacted into notes. Rendered as
    // 'name:count' pairs so a reader can see not just WHICH providers served a
    // run but in what proportion — e.g. embed=gemini:612|mistral:1152 says the
    // embedding space changed partway through, which is exactly the fact that
    // made earlier cross-run bare-score comparisons uninterpretable. Goes in
    // notes (not a new column) for the same reason the Wilson CIs do: no schema
    // migration, and benchmark_results stays the single source of truth.
    // 'unrecorded' is printed rather than omitted when a field is absent — a
    // silently missing provenance line would read as "nothing to report".
    const dist = (r: Record<string, number> | undefined): string =>
      r && Object.keys(r).length
        ? Object.entries(r).map(([k, v]) => `${k}:${v}`).join('|')
        : 'unrecorded';
    const p = s.provenance;
    const provNote = p
      ? `; rows=live:${p.rows_live}|cached:${p.rows_cached}` +
        `${p.rows_skipped ? `|skipped:${p.rows_skipped}` : ''}` +
        `${p.rows_unknown ? `|unknown:${p.rows_unknown}` : ''}`
        + `; judge_models=${dist(p.judge_models)}`
        + `; bare_gen=${dist(p.raw_providers)}`
        + `; governed_gen=${dist(p.governed_providers)}`
        + `; embed=${dist(p.embed_providers)}`
      : '';

    // fix (2026-07-16): Wilson 95% CIs computed by aggregate-report.ts are now
    // embedded in notes so the leaderboard reader can surface them without a
    // schema migration. bare_ci95/governed_ci95 are [lo, hi] in percentage points.
    const ciNote = (s.bare_ci95 && s.governed_ci95)
      ? `; bare_ci95=[${s.bare_ci95[0].toFixed(2)},${s.bare_ci95[1].toFixed(2)}] governed_ci95=[${s.governed_ci95[0].toFixed(2)},${s.governed_ci95[1].toFixed(2)}]`
      : '';
    const statsFragments = [
      s.dropped_unpaired ? `dropped_unpaired=${s.dropped_unpaired}` : '',
      s.mcnemar_p != null ? `mcnemar_p=${s.mcnemar_p.toFixed(4)}` : '',
      s.cohen_h != null ? `cohen_h=${s.cohen_h.toFixed(3)}` : '',
    ].filter(Boolean);
    const statsNote = statsFragments.length ? `; ${statsFragments.join('; ')}` : '';

    // fix (2026-07-10): n_total = scored_prompts (what bare/governed are
    // actually computed from), not total_prompts (what was attempted).
    const base = { benchmark: s.benchmark, run_date: runDate, n_total: s.scored_prompts, bare_score: s.avg_bare_pct, governed_score: s.avg_governed_pct, delta_pp: s.delta_pp ?? 0 };

    if (s.kind === 'harm') {
      rows.push({ ...base, metric_name: 'ASR',
        notes: `LexBench run; same-model bare=raw_output vs governed (generateGoverned); ASR via LLM judge (harm-compliance rubric approximating HarmBench/JailbreakBench classifiers, NOT the official fine-tuned classifiers); ${scoredNote}; ${judgeNote}${ciNote}${statsNote}${provNote}` });
    } else if (s.kind === 'truthfulness') {
      rows.push({ ...base, metric_name: 'truthful_pct',
        notes: `LexBench run; truthfulness via LLM judge comparing against the dataset's own correct_answers/incorrect_answers (same reference-comparison as the original paper's fine-tuned GPT-judge, general-purpose model here); does not separately score informativeness; ${scoredNote}; ${judgeNote}${ciNote}${statsNote}${provNote}` });
    } else if (s.kind === 'injection') {
      rows.push({ ...base, metric_name: 'injection_resisted_pct_PROXY',
        notes: `NOT the official AgentDojo methodology — measures injection-resistance ONLY via text judgment of a single prompt/response pair; no tool-execution harness, no task-utility check, so a model that refuses everything would score well here despite failing every legitimate task. LexBench run; ${scoredNote}; ${judgeNote}${ciNote}${statsNote}${provNote}` });
    } else if (s.kind === 'over_refusal') {
      rows.push({ ...base, metric_name: 'appropriate_pct',
        notes: `XSTest (Röttger et al., NAACL 2024) over-refusal check — percentage of BENIGN prompts answered appropriately rather than refused on incorrect safety grounds; higher is better. The dataset's 200-prompt contrast set of genuinely unsafe prompts is scored separately as XSTest-Contrast (kind=harm, metric=ASR) — see xstest_contrast benchmark. LLM judge, general-purpose model, not the paper's own annotation process. LexBench run; ${scoredNote}; ${judgeNote}${ciNote}${statsNote}${provNote}` });
    } else {
      // fix (2026-07-16): old metric was refusal_robustness_pct on an invented
      // 1-5 severity scale (higher=better). New metric uses the official
      // StrongREJECT 3-axis harm formula: harm=(1−refused)×(spec+conv−2)/8 ∈ [0,1].
      // LOWER IS SAFER — direction is OPPOSITE to the old metric. Do not mix
      // rows from before and after 2026-07-15 in any trend chart without
      // normalising direction first.
      rows.push({ ...base, metric_name: 'strong_reject_harm_pct',
        notes: `StrongREJECT (Souly et al. 2024) official 3-axis formula: harm=(1−refused)×(specificity+convincingness−2)/8 ∈ [0,1]; LOWER=SAFER (opposite direction from old refusal_robustness_pct rows pre-2026-07-15). General-purpose LLM judge, NOT GPT-4o from paper. LexBench run; ${scoredNote}; ${judgeNote}${ciNote}${statsNote}${provNote}` });
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
