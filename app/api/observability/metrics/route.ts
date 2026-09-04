/** Governance observability metrics endpoint. */
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { applyRequestContext, createRequestContext } from '@/lib/request-context';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const revalidate = 30;

const DEFAULT_WINDOW_MINUTES = 60;
const MIN_WINDOW_MINUTES = 5;
const MAX_WINDOW_MINUTES = 24 * 60;

interface AgentStat {
  calls: number;
  avg_duration_ms: number;
  error_count: number;
  error_rate: number;
  last_call: string | null;
}

interface MetricsResponse {
  timestamp: string;
  window_minutes: number;
  total_governed: number;
  agents: Record<string, AgentStat>;
  system: {
    total_calls: number;
    total_interventions: number;
    intervention_rate: number;
    avg_m_before: number;
    avg_m_after: number;
    avg_governor_effort: number;
  };
  health_distribution: { OPTIMAL: number; ALERT: number; STRESSED: number; CRITICAL: number };
  health_status: 'OPTIMAL' | 'ALERT' | 'STRESSED' | 'CRITICAL';
}

export function parseWindowMinutes(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return DEFAULT_WINDOW_MINUTES;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_WINDOW_MINUTES || value > MAX_WINDOW_MINUTES) return null;
  return value;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const context = createRequestContext(req.headers);
  const json = (body: unknown, status = 200, cache = 'no-store') => applyRequestContext(NextResponse.json(body, { status, headers: { 'Cache-Control': cache } }), context);
  const windowMinutes = parseWindowMinutes(req.nextUrl.searchParams.get('window_minutes'));
  if (windowMinutes === null) return json({ error: 'window_minutes must be an integer between 5 and 1440.', request_id: context.requestId }, 400);

  try {
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
    const [systemResult, modeResult] = await Promise.all([
      db.execute({
        sql: 'SELECT COUNT(*) AS total_calls, SUM(intervention) AS total_interventions, ' +
          'AVG(CAST(m_before AS REAL)) AS avg_m_before, AVG(CAST(m_after AS REAL)) AS avg_m_after, ' +
          'AVG(CAST(governor_effort AS REAL)) AS avg_governor_effort, ' +
          'SUM(CASE WHEN m_after >= 0.25 THEN 1 ELSE 0 END) AS optimal_count, ' +
          'SUM(CASE WHEN m_after >= 0.15 AND m_after < 0.25 THEN 1 ELSE 0 END) AS alert_count, ' +
          'SUM(CASE WHEN m_after >= 0.08 AND m_after < 0.15 THEN 1 ELSE 0 END) AS stressed_count, ' +
          'SUM(CASE WHEN m_after < 0.08 THEN 1 ELSE 0 END) AS critical_count ' +
          'FROM praxis_receipts WHERE created_at > ?',
        args: [cutoff],
      }),
      db.execute({
        sql: 'SELECT COALESCE(governor_mode,\'unknown\') AS mode, COUNT(*) AS calls, ' +
          'AVG(CAST(governor_effort AS REAL)) AS avg_effort, SUM(intervention) AS interventions ' +
          'FROM praxis_receipts WHERE created_at > ? GROUP BY governor_mode ORDER BY calls DESC',
        args: [cutoff],
      }),
    ]);

    if (!systemResult.rows.length || systemResult.rows[0].total_calls === null) return json({ error: 'No governance data in window', window_minutes: windowMinutes, request_id: context.requestId }, 503);
    const s = systemResult.rows[0];
    const totalCalls = Number(s.total_calls ?? 0);
    const totalInterventions = Number(s.total_interventions ?? 0);
    const avgMBefore = Number(s.avg_m_before ?? 0);
    const avgMAfter = Number(s.avg_m_after ?? 0);
    const avgEffort = Number(s.avg_governor_effort ?? 0);
    const interventionRate = totalCalls > 0 ? totalInterventions / totalCalls : 0;
    let healthStatus: MetricsResponse['health_status'] = 'OPTIMAL';
    if (interventionRate > 0.1 || avgMAfter < 0.08) healthStatus = 'CRITICAL';
    else if (interventionRate > 0.05 || avgMAfter < 0.15) healthStatus = 'STRESSED';
    else if (interventionRate > 0.01 || avgMAfter < 0.25) healthStatus = 'ALERT';

    const agents: Record<string, AgentStat> = {};
    for (const row of modeResult.rows) {
      const calls = Number(row.calls ?? 0);
      const interventions = Number(row.interventions ?? 0);
      agents[String(row.mode)] = {
        calls,
        avg_duration_ms: Math.round(Number(row.avg_effort ?? 0) * 1000),
        error_count: interventions,
        error_rate: calls > 0 ? interventions / calls : 0,
        last_call: null,
      };
    }

    const response: MetricsResponse = {
      timestamp: new Date().toISOString(),
      window_minutes: windowMinutes,
      total_governed: totalCalls,
      agents,
      system: {
        total_calls: totalCalls,
        total_interventions: totalInterventions,
        intervention_rate: Math.round(interventionRate * 10000) / 10000,
        avg_m_before: Math.round(avgMBefore * 1000) / 1000,
        avg_m_after: Math.round(avgMAfter * 1000) / 1000,
        avg_governor_effort: Math.round(avgEffort * 1000) / 1000,
      },
      health_distribution: {
        OPTIMAL: Number(s.optimal_count ?? 0),
        ALERT: Number(s.alert_count ?? 0),
        STRESSED: Number(s.stressed_count ?? 0),
        CRITICAL: Number(s.critical_count ?? 0),
      },
      health_status: healthStatus,
    };
    logger.info('observability.metrics', 'metrics served', { total_calls: totalCalls, health: healthStatus, window_minutes: windowMinutes, request_id: context.requestId, trace_id: context.traceId });
    return json(response, 200, 'private, max-age=30');
  } catch (error) {
    logger.error('observability.metrics', 'failed', { error: String(error), request_id: context.requestId, trace_id: context.traceId });
    return json({ error: 'Failed to fetch metrics', request_id: context.requestId }, 500);
  }
}
