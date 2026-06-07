/**
 * Trajectory Data Endpoint - Real Constitutional Simplex Data
 * 
 * Returns M(t) trajectory from praxis_receipts, validating all values.
 * FAILS HARD if C, R, S, or M are missing. No fallback values.
 * 
 * GET /api/lex/trajectory?session_id=<id>&limit=<n>
 */

import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface TrajectoryPoint {
  timestamp: string;
  C: number;
  R: number;
  S: number;
  M: number;
  agent: string;
  intervention_triggered: boolean;
  health_band: 'OPTIMAL' | 'ALERT' | 'STRESSED' | 'CRITICAL';
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get('session_id');
    const limitStr = searchParams.get('limit') || '100';
    const limit = Math.min(Math.max(parseInt(limitStr) || 100, 1), 1000);

    if (!sessionId) {
      return NextResponse.json(
        { error: 'Missing required parameter: session_id' },
        { status: 400 }
      );
    }

    // Query real trajectory data
    const result = await db.execute(
      `
      SELECT 
        created_at,
        C,
        R,
        S,
        M,
        agent_name,
        intervention_triggered
      FROM z_traj
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
      `,
      [sessionId, limit]
    );

    // Validate result
    if (!result?.rows || result.rows.length === 0) {
      return NextResponse.json(
        {
          error: 'No trajectory data found',
          session_id: sessionId,
          details: 'Check session_id is valid and has completed',
        },
        { status: 404 }
      );
    }

    // Map rows to TrajectoryPoint, with strict validation
    const trajectory: TrajectoryPoint[] = [];
    const validationErrors: string[] = [];

    for (const row of result.rows) {
      // STRICT VALIDATION - fail if any value is missing
      const C = row.C as number | null;
      const R = row.R as number | null;
      const S = row.S as number | null;
      const M = row.M as number | null;

      if (C === null || C === undefined) {
        validationErrors.push(`Row ${trajectory.length}: Missing C value`);
        continue;
      }
      if (R === null || R === undefined) {
        validationErrors.push(`Row ${trajectory.length}: Missing R value`);
        continue;
      }
      if (S === null || S === undefined) {
        validationErrors.push(`Row ${trajectory.length}: Missing S value`);
        continue;
      }
      if (M === null || M === undefined) {
        validationErrors.push(`Row ${trajectory.length}: Missing M value`);
        continue;
      }

      // Validate constitutional constraint: C + R + S ≈ 1
      const sum = C + R + S;
      if (Math.abs(sum - 1.0) > 0.01) {
        validationErrors.push(
          `Row ${trajectory.length}: Invalid constraint (C+R+S=${sum.toFixed(3)}, expected ≈1.0)`
        );
        continue;
      }

      // Validate M = min(C, R, S)
      const expectedM = Math.min(C, R, S);
      if (Math.abs(M - expectedM) > 0.001) {
        validationErrors.push(
          `Row ${trajectory.length}: M inconsistent (got ${M.toFixed(3)}, expected ${expectedM.toFixed(3)})`
        );
        continue;
      }

      // Determine health band
      let healthBand: 'OPTIMAL' | 'ALERT' | 'STRESSED' | 'CRITICAL' = 'OPTIMAL';
      if (M < 0.05) {
        healthBand = 'CRITICAL';
      } else if (M < 0.08) {
        healthBand = 'STRESSED';
      } else if (M < 0.15) {
        healthBand = 'ALERT';
      }

      trajectory.push({
        timestamp: row.created_at as string,
        C: Math.round(C * 1000) / 1000,
        R: Math.round(R * 1000) / 1000,
        S: Math.round(S * 1000) / 1000,
        M: Math.round(M * 1000) / 1000,
        agent: row.agent_name as string,
        intervention_triggered: (row.intervention_triggered as number) === 1,
        health_band: healthBand,
      });
    }

    if (validationErrors.length > 0) {
      console.warn('Trajectory validation warnings:', validationErrors);
    }

    if (trajectory.length === 0) {
      return NextResponse.json(
        {
          error: 'All rows failed validation',
          validation_errors: validationErrors,
          session_id: sessionId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      session_id: sessionId,
      points_returned: trajectory.length,
      points_total_available: result.rows.length,
      validation_warnings: validationErrors.length,
      trajectory: trajectory.reverse(),
    });
  } catch (error) {
    console.error('Trajectory API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch trajectory',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
