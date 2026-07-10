import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';
import { logger, errorFields } from '@/lib/logger';

// fix (2026-07-10, take two): `export const revalidate` did not produce
// verified cache HITs on Vercel's edge (same finding as /api/stats — see
// that route's take-two fix note). Switched to an explicit Cache-Control
// response header, the standard verifiable mechanism.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get('limit') ?? '8');
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, Math.floor(limitParam))) : 8;

  try {
    await initSchema();
    const r = await getClient().execute({
      sql: `SELECT receipt_id, session_id, turn, pre_eval_label,
                   m_before, m_after, governor_mode, intervention,
                   slow_drip, governor_effort, sigma_viol, created_at
            FROM praxis_receipts
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [limit],
    });

    const receipts = r.rows.map(row => ({
      id: row.receipt_id as string,
      session_id: row.session_id as string,
      turn: row.turn as number,
      pre_eval_label: (row.pre_eval_label as string) || 'CLEAR',
      m_before: row.m_before as number,
      m_after: row.m_after as number,
      governor_mode: row.governor_mode as string,
      intervention: (row.intervention as number) === 1,
      slow_drip: (row.slow_drip as number) === 1,
      governor_effort: row.governor_effort as number,
      sigma_viol: row.sigma_viol as number,
      timestamp: new Date(row.created_at as string).getTime(),
    }));

    return NextResponse.json({ receipts }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=15' },
    });
  } catch (e) {
    logger.warn('audits.recent', 'query failed', errorFields(e));
    return NextResponse.json({ receipts: [] }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=15' },
    });
  }
}
