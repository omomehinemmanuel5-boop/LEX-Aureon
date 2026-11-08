import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    await initSchema();
    const db = getClient();
    const [textResult, toolResult, sessionResult, latestResult] = await Promise.all([
      db.execute('SELECT COUNT(*) AS count FROM praxis_receipts'),
      db.execute('SELECT COUNT(*) AS count FROM tool_receipts'),
      db.execute(`SELECT COUNT(DISTINCT session_id) AS count FROM (
        SELECT session_id FROM praxis_receipts
        UNION
        SELECT session_id FROM tool_receipts
      )`),
      db.execute(`SELECT created_at FROM (
        SELECT created_at FROM praxis_receipts
        UNION ALL
        SELECT created_at FROM tool_receipts
      ) ORDER BY created_at DESC LIMIT 1`),
    ]);
    const textCount = Number(textResult.rows[0]?.count ?? 0);
    const toolCount = Number(toolResult.rows[0]?.count ?? 0);
    const sessionCount = Number(sessionResult.rows[0]?.count ?? 0);
    const total = textCount + toolCount;
    const latest = latestResult.rows[0]?.created_at ? String(latestResult.rows[0].created_at) : null;
    const parsedLatest = latest ? new Date(latest).getTime() : NaN;
    const freshnessSeconds = Number.isFinite(parsedLatest)
      ? Math.max(0, Math.round((Date.now() - parsedLatest) / 1000))
      : null;
    const storeStatus = total > 0 ? 'HEALTHY' : 'EMPTY';
    return NextResponse.json({
      checked_at: checkedAt,
      sources: {
        receipt_store: { status: storeStatus, count: total },
        praxis_receipts: { status: textCount > 0 ? 'HEALTHY' : 'EMPTY', count: textCount },
        tool_receipt_store: { status: toolCount > 0 ? 'HEALTHY' : 'EMPTY', count: toolCount },
        session_persistence: { status: sessionCount > 0 ? 'HEALTHY' : 'EMPTY', count: sessionCount },
        verification_api: { status: 'NOT_CHECKED', endpoint: '/api/audits/verify' },
        live_state: { status: 'NOT_CHECKED', endpoint: '/api/live-state' },
        telemetry_freshness: { status: freshnessSeconds == null ? 'UNKNOWN' : 'HEALTHY', seconds: freshnessSeconds },
      },
    }, { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch {
    return NextResponse.json({
      checked_at: checkedAt,
      sources: {
        receipt_store: { status: 'UNAVAILABLE' },
        praxis_receipts: { status: 'UNKNOWN' },
        tool_receipt_store: { status: 'UNKNOWN' },
        session_persistence: { status: 'UNKNOWN' },
        verification_api: { status: 'NOT_CHECKED', endpoint: '/api/audits/verify' },
        live_state: { status: 'NOT_CHECKED', endpoint: '/api/live-state' },
        telemetry_freshness: { status: 'UNKNOWN', seconds: null },
      },
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
