import { NextResponse } from 'next/server';
import { getAggregateConstitutionalState, getTotalRuns } from '@/lib/db';

// fix (2026-07-10, take two): `export const revalidate` did not produce
// verified cache HITs on Vercel's edge for this route (same finding as
// /api/stats — see that route's take-two fix note). Switched to an explicit
// Cache-Control response header, the standard verifiable mechanism.
export async function GET() {
  const [state, totalRuns] = await Promise.all([
    getAggregateConstitutionalState(),
    getTotalRuns(),
  ]);

  return NextResponse.json({
    state,
    total_runs: totalRuns,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
  });
}
