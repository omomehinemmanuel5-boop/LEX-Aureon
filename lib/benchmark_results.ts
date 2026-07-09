/**
 * Benchmark results — single source of truth.
 *
 * One table (benchmark_results), one writer (publishBenchmarkResult, called only
 * by the authenticated /api/benchmarks/publish route), one reader
 * (getBenchmarkResults, served by /api/benchmarks and consumed by the site +
 * README). No numbers are hardcoded anywhere else; everything that displays a
 * benchmark figure reads it from here.
 *
 * Row shape mirrors the existing benchmark_results schema created in
 * lib/db.ts initSchema():
 *   benchmark | run_date | n_total | metric_name | bare_score | governed_score
 *   | delta_pp | notes | created_at
 *
 * Scores are stored as percentages (0–100) in bare_score / governed_score;
 * delta_pp is governed − bare in percentage points (negative = governed safer).
 *
 * fix (2026-07-06) — RETIRED-METRIC ORPHANING: the site was still showing
 * stale n=5 results for benchmarks that had genuinely been re-run at full
 * scale. Root cause: getBenchmarkResults()'s "latest per (benchmark,
 * metric_name)" query is correct as written, but this project has renamed its
 * scoring metrics THREE times as methodology improved (bag-of-words
 * toxicity/truth_score → grounded ASR/truthful_pct/injection_resisted_pct_
 * PROXY, then AgentDojo's own ASR → injection_resisted_pct_PROXY specifically).
 * Each rename left the OLD metric_name's row permanently stuck as "the latest"
 * for that now-dead name, since nothing will ever publish under that name
 * again to supersede it — the row isn't stale by id, it's orphaned by name.
 * Rather than delete history (this project's append-only philosophy is
 * deliberate — see the header note on publishBenchmarkResult), the reader now
 * explicitly excludes known-retired (benchmark, metric_name) combinations.
 * The rows themselves remain in the table permanently for audit/history.
 *
 * fix (2026-07-08) — RETIRED_METRICS IS EXACT-MATCH, NOT A SUFFIX FILTER:
 * isRetired() below checks literal (benchmark, metric_name) pairs against this
 * array. Renaming a bad row's metric_name to something like
 * 'ASR_RETIRED_...' does NOT retire it by itself — it creates a brand-new
 * (benchmark, metric_name) group that MAX(id)-wins its own row and is *not*
 * excluded unless that exact new metric_name is also added to
 * RETIRED_METRICS. Every future single-row retirement (e.g. a contaminated
 * benchmark run) needs BOTH steps: rename the row's metric_name via SQL, AND
 * add the new (benchmark, metric_name) pair here.
 */

import { getClient } from './db';

export interface BenchmarkRow {
  benchmark:      string;   // 'advbench' | 'harmbench' | 'jailbreakbench' | ...
  run_date:       string;   // ISO date of the run (YYYY-MM-DD)
  n_total:        number;   // prompts scored for this metric
  metric_name:    string;   // 'ASR' | 'over_refusal' | ...
  bare_score:     number;   // percentage 0–100
  governed_score: number;   // percentage 0–100
  delta_pp:       number;   // governed − bare, percentage points
  notes?:         string;   // judge, model, commit, dataset provenance
}

export interface BenchmarkResultOut extends BenchmarkRow {
  id:         number;
  notes:      string;
  created_at: string;
}

let _ensured = false;

/**
 * Lightweight idempotent guard. The table is also created in initSchema(), but
 * this lets the benchmark routes work without paying for the full schema/seed
 * pass on every call. Runs at most once per warm lambda.
 */
async function ensureTable(): Promise<void> {
  if (_ensured) return;
  await getClient().execute(`CREATE TABLE IF NOT EXISTS benchmark_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benchmark TEXT NOT NULL,
    run_date TEXT NOT NULL,
    n_total INTEGER,
    metric_name TEXT NOT NULL,
    bare_score REAL,
    governed_score REAL,
    delta_pp REAL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  _ensured = true;
}

/**
 * Insert one scored metric row. Append-only: each run adds rows; the reader
 * surfaces the latest per (benchmark, metric_name), so history is preserved and
 * re-running a suite updates what the site shows without deleting anything.
 */
export async function publishBenchmarkResult(row: BenchmarkRow): Promise<number> {
  await ensureTable();
  const r = await getClient().execute({
    sql: `INSERT INTO benchmark_results
            (benchmark, run_date, n_total, metric_name, bare_score, governed_score, delta_pp, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id`,
    args: [
      row.benchmark,
      row.run_date,
      row.n_total,
      row.metric_name,
      row.bare_score,
      row.governed_score,
      row.delta_pp,
      row.notes ?? '',
    ],
  });
  return Number(r.rows[0]?.id ?? 0);
}

// Metric names retired as scoring methodology improved, individual runs were
// found contaminated, or rows were published in error. Rows under these names
// are kept in the table permanently (append-only audit history) but are
// excluded from the live "current results" view, since nothing will ever
// publish under these names again to naturally supersede them.
//   - toxicity / truth_score: the original bag-of-words prompt↔output cosine
//     similarity (lib/aureonics_math.ts computeCCP/computeIEC) — despite the
//     names, neither measured toxicity or truthfulness; both measured
//     vocabulary overlap with the question. Retired 2026-07 for grounded,
//     benchmark-specific judges.
//   - AgentDojo's own "ASR": AgentDojo originally shared the harm-benchmark
//     "ASR" metric name before being split out into its own
//     "injection_resisted_pct_PROXY" naming (which also carries the explicit
//     proxy-not-official-methodology caveat AgentDojo needs).
//   - AdvBench ASR_RETIRED_JUDGE_EXHAUSTION_2026-07-08: id=74 was published
//     with a catastrophic LLM-judge failure — the 8B judge fell back to
//     keyword-heuristic scoring and inflated both bare (31.54) and governed
//     (30.58) arms symmetrically, collapsing the delta to noise. Retired by
//     migration scripts/migrations/2026-07-08-retire-advbench-judge-
//     exhaustion.ts, which renames id=74's metric_name to this value.
//   - AdvBench ASR_RETIRED_KEYWORD_FALLBACK_2026-07-08: id=68, same-day,
//     same root cause at lower severity — judge_methods tags
//     keyword-fallback present, governed_score=3.27 is a ~17x outlier
//     against every other governed measurement in this benchmark's history
//     (all cluster 0–0.19), delta compressed to 0.58pp against a
//     1.15–1.35pp trend in neighboring runs. Same symmetric-inflation
//     signature as id=74, smaller dose. Retired by migration
//     scripts/migrations/2026-07-08-retire-advbench-id68.ts.
//   - *_RETIRED_QUICKTEST_2026-07-09 (TruthfulQA/truthful_pct,
//     AgentDojo/injection_resisted_pct_PROXY, JailbreakBench/ASR,
//     AdvBench/ASR, HarmBench/ASR — ids 76-80): a quick-test workflow_dispatch
//     (limit=10, meant only to validate pipeline fixes before a full run)
//     published its tiny n=10 results to the live leaderboard, because the
//     publish step's guard didn't exclude quick-test mode. Not a
//     methodology issue — operator error, since fixed in
//     .github/workflows/lexbench-prod.yml and lexbench-extended.yml.
//     Retired by scripts/migrations/2026-07-09-retire-quicktest-noise.ts.
//   - With id=74, id=68, and the id=79 quick-test row all retired,
//     AdvBench/ASR falls back to id=62 (bare 1.54, gov 0.19, delta 1.35pp,
//     clean 520/520 coverage, no keyword-fallback tag) — the last AdvBench
//     run scored entirely by real judge verdicts.
const RETIRED_METRICS: Array<{ benchmark?: string; metric_name: string }> = [
  { metric_name: 'toxicity' },
  { metric_name: 'truth_score' },
  { benchmark: 'AgentDojo', metric_name: 'ASR' },
  { benchmark: 'AdvBench', metric_name: 'ASR_RETIRED_JUDGE_EXHAUSTION_2026-07-08' },
  { benchmark: 'AdvBench', metric_name: 'ASR_RETIRED_KEYWORD_FALLBACK_2026-07-08' },
  { benchmark: 'TruthfulQA', metric_name: 'truthful_pct_RETIRED_QUICKTEST_2026-07-09' },
  { benchmark: 'AgentDojo', metric_name: 'injection_resisted_pct_PROXY_RETIRED_QUICKTEST_2026-07-09' },
  { benchmark: 'JailbreakBench', metric_name: 'ASR_RETIRED_QUICKTEST_2026-07-09' },
  { benchmark: 'AdvBench', metric_name: 'ASR_RETIRED_QUICKTEST_2026-07-09' },
  { benchmark: 'HarmBench', metric_name: 'ASR_RETIRED_QUICKTEST_2026-07-09' },
];

function isRetired(benchmark: string, metricName: string): boolean {
  return RETIRED_METRICS.some(r =>
    r.metric_name === metricName && (r.benchmark === undefined || r.benchmark === benchmark)
  );
}

/**
 * Latest row per (benchmark, metric_name), newest first by id, excluding
 * retired metric names (see RETIRED_METRICS above). MAX(id) is used rather
 * than MAX(created_at) because created_at has 1-second resolution and a
 * single run can write several rows within the same second.
 */
export async function getBenchmarkResults(): Promise<BenchmarkResultOut[]> {
  await ensureTable();
  const r = await getClient().execute(`
    SELECT b.id, b.benchmark, b.run_date, b.n_total, b.metric_name,
           b.bare_score, b.governed_score, b.delta_pp, b.notes, b.created_at
    FROM benchmark_results b
    JOIN (
      SELECT benchmark, metric_name, MAX(id) AS mx
      FROM benchmark_results
      GROUP BY benchmark, metric_name
    ) latest ON b.id = latest.mx
    ORDER BY b.benchmark ASC, b.metric_name ASC
  `);
  return r.rows
    .map(row => ({
      id:             Number(row.id),
      benchmark:      String(row.benchmark),
      run_date:       String(row.run_date),
      n_total:        Number(row.n_total ?? 0),
      metric_name:    String(row.metric_name),
      bare_score:     Number(row.bare_score ?? 0),
      governed_score: Number(row.governed_score ?? 0),
      delta_pp:       Number(row.delta_pp ?? 0),
      notes:          String(row.notes ?? ''),
      created_at:     String(row.created_at ?? ''),
    }))
    .filter(row => !isRetired(row.benchmark, row.metric_name));
}

/** Full history for one benchmark (all metrics, all runs, including retired
 * metric names) — for a detail/audit view where seeing the full history,
 * retired names included, is the point. */
export async function getBenchmarkHistory(benchmark: string): Promise<BenchmarkResultOut[]> {
  await ensureTable();
  const r = await getClient().execute({
    sql: `SELECT id, benchmark, run_date, n_total, metric_name,
                 bare_score, governed_score, delta_pp, notes, created_at
          FROM benchmark_results WHERE benchmark = ? ORDER BY id DESC`,
    args: [benchmark],
  });
  return r.rows.map(row => ({
    id:             Number(row.id),
    benchmark:      String(row.benchmark),
    run_date:       String(row.run_date),
    n_total:        Number(row.n_total ?? 0),
    metric_name:    String(row.metric_name),
    bare_score:     Number(row.bare_score ?? 0),
    governed_score: Number(row.governed_score ?? 0),
    delta_pp:       Number(row.delta_pp ?? 0),
    notes:          String(row.notes ?? ''),
    created_at:     String(row.created_at ?? ''),
  }));
}
