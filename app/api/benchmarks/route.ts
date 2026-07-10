/**
 * GET /api/benchmarks
 *
 * Public read endpoint — the single source of truth for benchmark numbers.
 * Returns the latest scored row per (benchmark, metric_name) from the
 * benchmark_results table. The landing page and dashboard poll this; the README
 * points here rather than carrying its own copy of the figures.
 *
 * Empty array is a valid, honest response: it means no run has been scored and
 * published yet. Consumers render that as "evaluation in progress" — never as
 * a zero score.
 *
 * fix (2026-07-10) — TURSO ROW-READ QUOTA: this route was force-dynamic with
 * revalidate=0 and Cache-Control: no-store — every single poll, from every
 * visitor, on both the homepage (components/BenchmarkResults compact, 20s
 * default) and the /benchmarks page (10s), hit the database fresh via
 * getBenchmarkResults()'s full-table JOIN. Turso reported ~80% of its row-read
 * quota consumed. Benchmark results only change in discrete jumps when a full
 * run is scored and published (at most a few times a day) — there was no
 * reason to re-query on every 10-20s poll from every open tab. Now cached for
 * 60s via Next.js's route-segment revalidation: every poll within a 60s
 * window across ALL visitors is served from ONE shared cached response, not
 * one DB query per visitor per poll. Consumers still refresh automatically;
 * they just don't each force a fresh row read to do it.
 */

import { NextResponse } from 'next/server';
import { getBenchmarkResults } from '@/lib/benchmark_results';

export const revalidate = 60;

export async function GET() {
  try {
    const results = await getBenchmarkResults();
    return NextResponse.json({
      ok: true,
      count: results.length,
      published: results.length > 0,
      results,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, count: 0, published: false, results: [], error: String(e).slice(0, 200) },
      { status: 500 },
    );
  }
}
