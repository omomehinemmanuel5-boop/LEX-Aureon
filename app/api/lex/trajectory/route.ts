/**
 * GET /api/lex/trajectory
 * 
 * Stream historical trajectory data for visualization.
 * Returns the last N audit log entries with CRS state changes.
 * 
 * Query params:
 * - session_id: Filter by session (optional)
 * - limit: Number of entries to return (default: 100, max: 1000)
 * - format: 'json' or 'csv' (default: 'json')
 */

import { NextResponse } from 'next/server';
import { getClient } from '@/lib/db';

interface TrajectoryPoint {
  timestamp: number;
  C: number;
  R: number;
  S: number;
  M: number;
  health_band: string;
  intervention: boolean;
  reason?: string;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('session_id');
    const limitStr = url.searchParams.get('limit') || '100';
    const format = url.searchParams.get('format') || 'json';

    const limit = Math.min(parseInt(limitStr, 10) || 100, 1000);

    const db = getClient();

    // Query audit log for trajectory points
    let sql = `
      SELECT
        created_at as timestamp,
        c_before as C,
        r_before as R,
        s_before as S,
        COALESCE(m_before, LEAST(c_before, r_before, s_before)) as M,
        health_band,
        intervention,
        reason
      FROM audit_log
    `;

    const args: (string | number)[] = [];

    if (sessionId) {
      sql += ` WHERE session_id = ?`;
      args.push(sessionId);
    }

    sql += ` ORDER BY created_at DESC LIMIT ?`;
    args.push(limit);

    const result = await db.execute({ sql, args });

    const points: TrajectoryPoint[] = result.rows
      .reverse()
      .map(row => ({
        timestamp: Number(row.created_at) || Date.now(),
        C: Number(row.C) || 0.333,
        R: Number(row.R) || 0.333,
        S: Number(row.S) || 0.334,
        M: Number(row.M) || 0.333,
        health_band: String(row.health_band || 'UNKNOWN'),
        intervention: Number(row.intervention) === 1,
        reason: row.reason ? String(row.reason) : undefined,
      }));

    if (format === 'csv') {
      const csv = [
        'timestamp,C,R,S,M,health_band,intervention,reason',
        ...points.map(p =>
          `${p.timestamp},${p.C.toFixed(4)},${p.R.toFixed(4)},${p.S.toFixed(4)},${p.M.toFixed(4)},${p.health_band},${p.intervention ? 1 : 0},"${p.reason || ''}"`,
        ),
      ].join('\n');

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="trajectory.csv"',
        },
      });
    }

    return NextResponse.json({
      points,
      count: points.length,
      session_id: sessionId || 'all',
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('trajectory endpoint error:', e);
    return NextResponse.json(
      { error: 'Failed to fetch trajectory data' },
      { status: 500 },
    );
  }
}
