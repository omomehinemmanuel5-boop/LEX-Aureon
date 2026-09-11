import { db, getDatabaseMetrics, initSchema } from '@/lib/db';
import { applyRequestContext, createRequestContext } from '@/lib/request-context';

export const runtime = 'nodejs';
export const revalidate = 30;
const MAX_WINDOW_MINUTES = 24 * 60;

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}
function formatLabels(values: Record<string, string>): string {
  return '{' + Object.entries(values).map(([key, value]) => key + '="' + escapeLabel(value) + '"').join(',') + '}';
}
function parseWindow(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return 60;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 5 && value <= MAX_WINDOW_MINUTES ? value : null;
}

export async function GET(req: Request): Promise<Response> {
  const context = createRequestContext(req.headers);
  const windowMinutes = parseWindow(new URL(req.url).searchParams.get('window_minutes'));
  if (windowMinutes === null) return applyRequestContext(new Response('# window_minutes must be an integer between 5 and 1440.\n', { status: 400, headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-store' } }), context);

  try {
    await initSchema();
    const result = await db.execute({
      sql: 'SELECT COUNT(*) AS total_calls, COALESCE(SUM(intervention), 0) AS total_interventions, ' +
        'COALESCE(AVG(CAST(m_after AS REAL)), 0) AS avg_m_after FROM praxis_receipts WHERE created_at > ?',
      args: [new Date(Date.now() - windowMinutes * 60 * 1000).toISOString()],
    });
    const row = result.rows[0] ?? {};
    const totalCalls = Number(row.total_calls ?? 0);
    const totalInterventions = Number(row.total_interventions ?? 0);
    const labels = { window_minutes: String(windowMinutes) };
    const database = getDatabaseMetrics();
    const lines = [
      '# HELP lex_governance_calls_in_window Governance receipts in the selected time window.',
      '# TYPE lex_governance_calls_in_window gauge',
      'lex_governance_calls_in_window' + formatLabels(labels) + ' ' + totalCalls,
      '# HELP lex_governance_interventions_in_window Governance interventions in the selected time window.',
      '# TYPE lex_governance_interventions_in_window gauge',
      'lex_governance_interventions_in_window' + formatLabels(labels) + ' ' + totalInterventions,
      '# HELP lex_governance_intervention_rate Ratio of interventions to governance calls in the selected window.',
      '# TYPE lex_governance_intervention_rate gauge',
      'lex_governance_intervention_rate' + formatLabels(labels) + ' ' + (totalCalls > 0 ? totalInterventions / totalCalls : 0),
      '# HELP lex_governance_avg_m_after Average post-governance constitutional state in the selected window.',
      '# TYPE lex_governance_avg_m_after gauge',
      'lex_governance_avg_m_after' + formatLabels(labels) + ' ' + Number(row.avg_m_after ?? 0),
      '# HELP lex_observability_up Whether the observability query completed successfully.',
      '# TYPE lex_observability_up gauge',
      'lex_observability_up 1',
      '# HELP lex_database_queries_total Total database execute and batch operations.',
      '# TYPE lex_database_queries_total counter',
      'lex_database_queries_total ' + database.queries_total,
      '# HELP lex_database_query_errors_total Database operations that failed.',
      '# TYPE lex_database_query_errors_total counter',
      'lex_database_query_errors_total ' + database.query_errors_total,
      '# HELP lex_database_query_duration_ms_total Total observed database operation duration in milliseconds.',
      '# TYPE lex_database_query_duration_ms_total counter',
      'lex_database_query_duration_ms_total ' + database.query_duration_ms_total,
      '# HELP lex_database_query_duration_ms_count Number of observed database operations.',
      '# TYPE lex_database_query_duration_ms_count counter',
      'lex_database_query_duration_ms_count ' + database.query_duration_ms_count,
      '# HELP lex_database_inflight_queries Current database operations in flight.',
      '# TYPE lex_database_inflight_queries gauge',
      'lex_database_inflight_queries ' + database.inflight_queries,
      '# HELP lex_database_client_initialized Whether the database client has been initialized.',
      '# TYPE lex_database_client_initialized gauge',
      'lex_database_client_initialized ' + (database.client_initialized ? 1 : 0),
    ];
    return applyRequestContext(new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'private, max-age=30' } }), context);
  } catch {
    return applyRequestContext(new Response('lex_observability_up 0\n', { status: 503, headers: { 'Content-Type': 'text/plain; version=0.0.4', 'Cache-Control': 'no-store' } }), context);
  }
}
