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

/**
 * Latest row per (benchmark, metric_name), newest first by id. MAX(id) is used
 * rather than MAX(created_at) because created_at has 1-second resolution and a
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

/** Full history for one benchmark (all metrics, all runs) — for a detail view. */
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
