/**
 * Real Observability Metrics Endpoint
 *
 * Returns actual system health metrics from audit_log.
 * NO fallback values. Fails hard if data is missing.
 * Uses unified logging system.
 *
 * GET /api/observability/metrics
 */

import { db } from '@/lib/db';
import { createRequestLogger } from '@/lib/unified_logger';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const revalidate = 30;

interface MetricsResponse {
  timestamp: string;
  window_minutes: number;
  agents: {
    [agentName: string]: {
      calls: number;
      avg_duration_ms: number;
      error_count: number;
      error_rate: number;
      last_call: string | null;
    };
  };
  system: {
    total_calls: number;
    total_errors: number;
    global_error_rate: number;
    avg_pipeline_duration_ms: number;
  };
  health_status: 'OPTIMAL' | 'ALERT' | 'STRESSED' | 'CRITICAL';
}

interface SystemRow {
  total_calls: number;
  total_errors: number;
  avg_duration_ms: number;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = req.headers.get('x-request-id') || `req-${Date.now()}`;
  const logger = createRequestLogger(requestId);

  try {
    logger.info('METRICS', 'Observability metrics request started', {
      endpoint: '/api/observability/metrics',
    });

    const windowMinutes = 60;
    const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();

    logger.debug('METRICS', 'Querying agent metrics', { window_minutes: windowMinutes, cutoff });

    const agentMetricsResult = await db.execute(
      `
      SELECT
        agent_name,
        COUNT(*) as calls,
        AVG(CAST(duration_ms AS REAL)) as avg_duration_ms,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_count,
        MAX(created_at) as last_call
      FROM audit_log
      WHERE created_at > ?
      GROUP BY agent_name
      ORDER BY calls DESC
      `,
      [cutoff]
    );

    logger.debug('METRICS', 'Agent metrics query complete', {
      rows_returned: agentMetricsResult?.rows?.length,
    });

    const systemMetricsResult = await db.execute(
      `
      SELECT
        COUNT(*) as total_calls,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as total_errors,
        AVG(CAST(duration_ms AS REAL)) as avg_duration_ms
      FROM audit_log
      WHERE created_at > ?
      `,
      [cutoff]
    );

    logger.debug('METRICS', 'System metrics query complete');

    if (
      !agentMetricsResult?.rows ||
      !systemMetricsResult?.rows ||
      systemMetricsResult.rows.length === 0
    ) {
      logger.warn('METRICS', 'Insufficient data in audit_log', {
        agent_rows: agentMetricsResult?.rows?.length,
        system_rows: systemMetricsResult?.rows?.length,
      });

      return NextResponse.json(
        {
          error: 'Insufficient data in audit_log',
          details: 'No audit_log entries found in the specified time window',
          window: `${windowMinutes} minutes`,
          request_id: requestId,
        },
        { status: 503 }
      );
    }

    const agentsMetrics: MetricsResponse['agents'] = {};
    for (const row of agentMetricsResult.rows) {
      const calls = (row.calls as number) || 0;
      const errors = (row.error_count as number) || 0;
      agentsMetrics[row.agent_name as string] = {
        calls,
        avg_duration_ms: Math.round((row.avg_duration_ms as number) || 0),
        error_count: errors,
        error_rate: calls > 0 ? errors / calls : 0,
        last_call: (row.last_call as string) || null,
      };
    }

    const systemMetrics = systemMetricsResult.rows[0] as unknown as SystemRow;
    const totalCalls = systemMetrics.total_calls || 0;
    const totalErrors = systemMetrics.total_errors || 0;
    const avgDuration = Math.round(systemMetrics.avg_duration_ms || 0);
    const globalErrorRate = totalCalls > 0 ? totalErrors / totalCalls : 0;

    let healthStatus: MetricsResponse['health_status'] = 'OPTIMAL';
    if (globalErrorRate > 0.1 || avgDuration > 1000) {
      healthStatus = 'CRITICAL';
    } else if (globalErrorRate > 0.05 || avgDuration > 500) {
      healthStatus = 'STRESSED';
    } else if (globalErrorRate > 0.01 || avgDuration > 250) {
      healthStatus = 'ALERT';
    }

    const response: MetricsResponse = {
      timestamp: new Date().toISOString(),
      window_minutes: windowMinutes,
      agents: agentsMetrics,
      system: {
        total_calls: totalCalls,
        total_errors: totalErrors,
        global_error_rate: Math.round(globalErrorRate * 10000) / 10000,
        avg_pipeline_duration_ms: avgDuration,
      },
      health_status: healthStatus,
    };

    logger.info('METRICS', 'Metrics calculated successfully', {
      total_calls: totalCalls,
      health_status: healthStatus,
    });

    return NextResponse.json(response, {
      headers: {
        'x-request-id': requestId,
        'x-unified-logs': logger.export(),
      },
    });
  } catch (error) {
    logger.error('METRICS', 'Failed to fetch metrics', {
      error: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: 'Failed to fetch metrics',
        details: error instanceof Error ? error.message : 'Unknown error',
        request_id: requestId,
      },
      { status: 500 }
    );
  }
}
