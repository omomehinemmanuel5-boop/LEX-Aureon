import { NextResponse } from 'next/server';
import { getAggregateConstitutionalState, getTotalRuns } from '@/lib/db';

// fix (2026-07-10): added caching alongside the /api/stats and
// /api/benchmarks fixes (see those routes' 2026-07-10 fix notes) -- this
// endpoint is polled every 10s by components/LiveStatsBar.tsx on the
// homepage, for every visitor, and had no caching at all. Turso reported
// ~80% of its row-read quota consumed; this and /api/stats together are the
// two endpoints LiveStatsBar hits on every poll cycle.
export const revalidate = 60;

// Returns aggregate constitutional state (average across recent sessions).
// Individual session IDs are never exposed here — this endpoint is public.
export async function GET() {
  const [state, totalRuns] = await Promise.all([
    getAggregateConstitutionalState(),
    getTotalRuns(),
  ]);

  return NextResponse.json({
    state,
    total_runs: totalRuns,
  });
}
