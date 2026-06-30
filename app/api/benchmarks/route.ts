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
 */

import { NextResponse } from 'next/server';
import { getBenchmarkResults } from '@/lib/benchmark_results';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const results = await getBenchmarkResults();
    return NextResponse.json(
      {
        ok: true,
        count: results.length,
        published: results.length > 0,
        results,
        fetched_at: new Date().toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, count: 0, published: false, results: [], error: String(e).slice(0, 200) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
