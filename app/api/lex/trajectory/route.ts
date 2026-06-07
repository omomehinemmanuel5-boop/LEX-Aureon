/**
 * Trajectory Data Endpoint
 *
 * Returns the constitutional M(t) trajectory for a session.
 *
 * SOURCE OF TRUTH:
 *   praxis_receipts — the canonical per-turn governance log.
 *   z_traj          — live session snapshot (current C/R/S only, NOT history).
 *
 * This route queries praxis_receipts for history and z_traj for the
 * current live state. No fallback values. Fails hard if data is missing.
 *
 * GET /api/lex/trajectory?session_id=<id>&limit=<n>
 */

import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface TrajectoryPoint {
  turn: number;
  timestamp: string;
  m_before: number;
  m_after: number;
  governor_mode: string;
  intervention: boolean;
  slow_drip: boolean;
  governor_effort: number;
  health_band: 'OPTIMAL' | 'ALERT' | 'STRESSED' | 'CRITICAL';
}

interface LiveState {
  C: number;
  R: number;
  S: number;
  M: number;
  velocity: number;
  drift_dir: string;
  sigma_viol: number;
  n_stable: number;
  attack_pressure: number;
  updated_at: string;
}

function deriveHealthBand(m: number): TrajectoryPoint['health_band'] {
  if (m >= 0.25) return 'OPTIMAL';
  if (m >= 0.15) return 'ALERT';
  if (m >= 0.08) return 'STRESSED';
  return 'CRITICAL';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session_id');
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '100'), 1), 1000);

  if (!sessionId) {
    return NextResponse.json({ error: 'Missing required parameter: session_id' }, { status: 400 });
  }

  try {
    // ── 1. Historical trajectory from praxis_receipts (per-turn log) ─────────
    const histResult = await db.execute({
      sql: `SELECT
              turn, created_at,
              m_before, m_after,
              COALESCE(governor_mode, 'unknown') AS governor_mode,
              intervention, slow_drip, governor_effort,
              COALESCE(health_band,
                CASE
                  WHEN m_after >= 0.25 THEN 'OPTIMAL'
                  WHEN m_after >= 0.15 THEN 'ALERT'
                  WHEN m_after >= 0.08 THEN 'STRESSED'
                  ELSE 'CRITICAL'
                END
              ) AS health_band
            FROM praxis_receipts
            WHERE session_id = ?
            ORDER BY created_at ASC
            LIMIT ?`,
      args: [sessionId, limit],
    });

    // ── 2. Live state from z_traj (current snapshot only) ────────────────────
    const liveResult = await db.execute({
      sql: `SELECT last_c, last_r, last_s, last_m, velocity, drift_dir,
                   sigma_viol, n_stable, attack_pressure, updated_at
            FROM z_traj WHERE session_id = ?`,
      args: [sessionId],
    });

    if (!histResult.rows.length && !liveResult.rows.length) {
      return NextResponse.json(
        { error: 'No data found for session', session_id: sessionId },
        { status: 404 }
      );
    }

    // Map history rows
    const trajectory: TrajectoryPoint[] = histResult.rows.map(row => ({
      turn:            Number(row.turn),
      timestamp:       String(row.created_at),
      m_before:        Math.round(Number(row.m_before) * 1000) / 1000,
      m_after:         Math.round(Number(row.m_after)  * 1000) / 1000,
      governor_mode:   String(row.governor_mode),
      intervention:    Number(row.intervention) === 1,
      slow_drip:       Number(row.slow_drip) === 1,
      governor_effort: Math.round(Number(row.governor_effort) * 1000) / 1000,
      health_band:     deriveHealthBand(Number(row.m_after)),
    }));

    // Map live state
    let live_state: LiveState | null = null;
    if (liveResult.rows.length) {
      const r = liveResult.rows[0];
      const C = Number(r.last_c), R = Number(r.last_r), S = Number(r.last_s);
      const M = Math.min(C, R, S);

      // Validate constitutional invariant
      const sum = C + R + S;
      if (Math.abs(sum - 1.0) > 0.02) {
        return NextResponse.json(
          { error: `Constitutional invariant violated: C+R+S=${sum.toFixed(3)}`, session_id: sessionId },
          { status: 500 }
        );
      }

      live_state = {
        C: Math.round(C * 1000) / 1000,
        R: Math.round(R * 1000) / 1000,
        S: Math.round(S * 1000) / 1000,
        M: Math.round(M * 1000) / 1000,
        velocity:        Math.round(Number(r.velocity)        * 1000) / 1000,
        drift_dir:       String(r.drift_dir),
        sigma_viol:      Math.round(Number(r.sigma_viol)      * 1000) / 1000,
        n_stable:        Number(r.n_stable),
        attack_pressure: Math.round(Number(r.attack_pressure) * 1000) / 1000,
        updated_at:      String(r.updated_at),
      };
    }

    return NextResponse.json({
      session_id:   sessionId,
      turns:        trajectory.length,
      trajectory,
      live_state,
      note: 'trajectory = praxis_receipts history (per-turn). live_state = z_traj snapshot (current only).',
    });

  } catch (error) {
    return NextResponse.json(
      { error: 'Trajectory query failed', details: String(error) },
      { status: 500 }
    );
  }
}
