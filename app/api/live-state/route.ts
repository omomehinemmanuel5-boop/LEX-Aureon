import { NextResponse } from 'next/server';
import { getAggregateConstitutionalState, getTotalRuns } from '@/lib/db';

// fix (2026-07-10, take two): `export const revalidate` did not produce
// verified cache HITs on Vercel's edge for this route (same finding as
// /api/stats — see that route's take-two fix note). Switched to an explicit
// Cache-Control response header, the standard verifiable mechanism.
export async function GET() {
  const [aggregate, totalRuns] = await Promise.all([
    getAggregateConstitutionalState(),
    getTotalRuns(),
  ]);

  let state: { C: number | null; R: number | null; S: number | null; M: number | null } = {
    C: null, R: null, S: null, M: null,
  };

  try {
    const result = await getClient().execute({
      sql: 'SELECT last_c, last_r, last_s FROM z_traj ORDER BY updated_at DESC LIMIT 1',
      args: [],
    });
    const row = result.rows[0];
    if (row && row.last_c != null && row.last_r != null && row.last_s != null) {
      const C = Number(row.last_c);
      const R = Number(row.last_r);
      const S = Number(row.last_s);
      state = { C, R, S, M: Math.min(C, R, S) };
    }
  } catch {
    // Preserve the nullable response contract if live trajectory data is unavailable.
  }

  return NextResponse.json({
    state,
    aggregate,
    total_runs: totalRuns,
  }, {
    headers: { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=15' },
  });
}
