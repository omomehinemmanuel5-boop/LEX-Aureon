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
 * visitor, on both the homepage and the /benchmarks page, hit the database
 * fresh. Turso reported ~80% of its row-read quota consumed.
 *
 * fix (2026-07-10, take two): the route-segment `export const revalidate`
 * approach did NOT produce verified cache HITs on Vercel's edge — five rapid
 * requests all showed x-vercel-cache: MISS, and the response carried
 * Cache-Control: max-age=0, must-revalidate regardless of the revalidate
 * export. Switched to an explicit Cache-Control response header (s-maxage),
 * the standard, verifiable mechanism for edge caching a Vercel Route Handler.
 */

import { NextResponse } from 'next/server';
import { getBenchmarkResults } from '@/lib/benchmark_results';

export async function GET() {
  try {
    const results = await getBenchmarkResults();
    return NextResponse.json({
      ok: true,
      count: results.length,
      published: results.length > 0,
      results,
      fetched_at: new Date().toISOString(),
    }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, count: 0, published: false, results: [], error: String(e).slice(0, 200) },
      { status: 500, headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' } },
    );
  }
}
