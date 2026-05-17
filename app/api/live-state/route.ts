import { NextResponse } from 'next/server';
import { getAggregateConstitutionalState, getTotalRuns } from '@/lib/db';

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
