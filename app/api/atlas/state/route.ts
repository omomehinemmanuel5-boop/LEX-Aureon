import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const revalidate = 15;

export async function GET() {
  try {
    const [stateResult, receiptResult] = await Promise.all([
      db.execute({
        sql: `SELECT session_id, last_c, last_r, last_s, last_m, velocity, drift_dir, sigma_viol, updated_at
              FROM z_traj ORDER BY updated_at DESC LIMIT 1`,
        args: [],
      }),
      db.execute({
        sql: `SELECT receipt_id, session_id, turn, m_before, m_after, governor_mode, intervention, created_at
              FROM praxis_receipts ORDER BY created_at DESC LIMIT 6`,
        args: [],
      }),
    ]);

    const state = stateResult.rows[0];
    const latest = state
      ? {
          session_id: String(state.session_id),
          C: Number(state.last_c ?? 0),
          R: Number(state.last_r ?? 0),
          S: Number(state.last_s ?? 0),
          M: Number(state.last_m ?? 0),
          velocity: Number(state.velocity ?? 0),
          drift_dir: String(state.drift_dir ?? 'stable'),
          sigma_viol: Number(state.sigma_viol ?? 0),
          updated_at: String(state.updated_at),
        }
      : null;

    const receipts = receiptResult.rows.map(row => ({
      receipt_id: String(row.receipt_id),
      session_id: String(row.session_id),
      turn: Number(row.turn ?? 0),
      m_before: Number(row.m_before ?? 0),
      m_after: Number(row.m_after ?? 0),
      governor_mode: String(row.governor_mode ?? 'unknown'),
      intervention: Boolean(Number(row.intervention ?? 0)),
      created_at: String(row.created_at),
    }));

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      state: latest,
      receipts,
    }, { headers: { 'Cache-Control': 'private, max-age=10' } });
  } catch {
    return NextResponse.json({ error: 'Atlas runtime state is temporarily unavailable.' }, { status: 503 });
  }
}
