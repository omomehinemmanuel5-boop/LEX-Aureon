/**
 * Real Observability Metrics Endpoint
 * Queries praxis_receipts — the canonical governance log.
 * GET /api/observability/metrics
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { NextRequest, NextResponse } from 'next/server';
import { MetricsResponseSchema } from '@/lib/observability_contract';

export const runtime  = 'nodejs';
export const revalidate = 30;

import type { MetricsResponse } from '@/lib/observability_contract';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = req.headers.get('x-request-id') ?? `req-${Date.now()}`;
  try {
    const windowMinutes = 60;
    const sessionId = new URL(req.url).searchParams.get('session_id')?.trim() ?? '';
    if (sessionId.length > 128) return NextResponse.json({ error: 'session_id is too long', request_id: requestId }, { status: 400 });
    const scope = sessionId ? ' AND session_id = ?' : '';
    const scopeArgs = sessionId ? [sessionId] : [];
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    const [systemResult, modeResult] = await Promise.all([
      db.execute({
        sql: `SELECT
                COUNT(*)                                                            AS total_calls,
                SUM(intervention)                                                   AS total_interventions,
                AVG(CAST(m_before        AS REAL))                                  AS avg_m_before,
                AVG(CAST(m_after         AS REAL))                                  AS avg_m_after,
                AVG(CAST(governor_effort AS REAL))                                  AS avg_governor_effort,
                SUM(CASE WHEN m_after >= 0.25                          THEN 1 ELSE 0 END) AS optimal_count,
                SUM(CASE WHEN m_after >= 0.15 AND m_after < 0.25       THEN 1 ELSE 0 END) AS alert_count,
                SUM(CASE WHEN m_after >= 0.08 AND m_after < 0.15       THEN 1 ELSE 0 END) AS stressed_count,
                SUM(CASE WHEN m_after  < 0.08                          THEN 1 ELSE 0 END) AS critical_count
              FROM praxis_receipts WHERE created_at > ?${scope}`,
        args: [cutoff, ...scopeArgs],
      }),
      db.execute({
        sql: `SELECT COALESCE(governor_mode,'unknown') AS mode,
                     COUNT(*)                          AS calls,
                     AVG(CAST(governor_effort AS REAL)) AS avg_effort,
                     SUM(intervention)                 AS interventions
              FROM praxis_receipts WHERE created_at > ?${scope}
              GROUP BY governor_mode ORDER BY calls DESC`,
        args: [cutoff, ...scopeArgs],
      }),
    ]);

    if (!systemResult.rows.length || systemResult.rows[0].total_calls === null) {
      return NextResponse.json(
        { error: 'No governance data in window', window_minutes: windowMinutes, request_id: requestId },
        { status: 503 },
      );
    }

    const s                  = systemResult.rows[0];
    const totalCalls         = Number(s.total_calls          ?? 0);
    const totalInterventions = Number(s.total_interventions  ?? 0);
    const avgMBefore         = Number(s.avg_m_before         ?? 0);
    const avgMAfter          = Number(s.avg_m_after          ?? 0);
    const avgEffort          = Number(s.avg_governor_effort  ?? 0);
    const interventionRate   = totalCalls > 0 ? totalInterventions / totalCalls : 0;

    let healthStatus: MetricsResponse['health_status'] = 'OPTIMAL';
    if      (interventionRate > 0.1  || avgMAfter < 0.08) healthStatus = 'CRITICAL';
    else if (interventionRate > 0.05 || avgMAfter < 0.15) healthStatus = 'STRESSED';
    else if (interventionRate > 0.01 || avgMAfter < 0.25) healthStatus = 'ALERT';

    const agents: Record<string, AgentStat> = {};
    for (const row of modeResult.rows) {
      const calls         = Number(row.calls        ?? 0);
      const interventions = Number(row.interventions ?? 0);
      agents[String(row.mode)] = {
        calls,
        avg_duration_ms: Math.round(Number(row.avg_effort ?? 0) * 1000),
        error_count:     interventions,
        error_rate:      calls > 0 ? interventions / calls : 0,
        last_call:       null,
      };
    }

    const response: MetricsResponse = {
      timestamp:      new Date().toISOString(),
      window_minutes: windowMinutes,
      total_governed: totalCalls,
      session_id: sessionId || null,
      agents,
      system: {
        total_calls:         totalCalls,
        total_interventions: totalInterventions,
        intervention_rate:   Math.round(interventionRate   * 10000) / 10000,
        avg_m_before:        Math.round(avgMBefore         * 1000)  / 1000,
        avg_m_after:         Math.round(avgMAfter          * 1000)  / 1000,
        avg_governor_effort: Math.round(avgEffort          * 1000)  / 1000,
      },
      health_distribution: {
        OPTIMAL:  Number(s.optimal_count  ?? 0),
        ALERT:    Number(s.alert_count    ?? 0),
        STRESSED: Number(s.stressed_count ?? 0),
        CRITICAL: Number(s.critical_count ?? 0),
      },
      health_status: healthStatus,
    };

    logger.info('observability.metrics', 'metrics served', { total_calls: totalCalls, health: healthStatus });
    const validated = MetricsResponseSchema.parse(response);
    return NextResponse.json(validated, { headers: { 'x-request-id': requestId, 'Cache-Control': 'private, max-age=15, stale-while-revalidate=15' } });

  } catch (error) {
    logger.error('observability.metrics', 'failed', { error: String(error) });
    return NextResponse.json(
      { error: 'Failed to fetch metrics', details: String(error), request_id: requestId },
      { status: 500 },
    );
  }
}
