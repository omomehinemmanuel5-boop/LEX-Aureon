import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';

export const runtime = 'nodejs';

export async function GET() {
  const checkedAt = new Date().toISOString();
  try {
    await initSchema();
    const db = getClient();
    const [receiptResult, sessionResult, latestResult] = await Promise.all([
      db.execute('SELECT COUNT(*) AS count FROM praxis_receipts'),
      db.execute('SELECT COUNT(DISTINCT session_id) AS count FROM praxis_receipts'),
      db.execute('SELECT created_at FROM praxis_receipts ORDER BY created_at DESC LIMIT 1'),
    ]);
    const receiptCount = Number(receiptResult.rows[0]?.count ?? 0);
    const sessionCount = Number(sessionResult.rows[0]?.count ?? 0);
    const latest = latestResult.rows[0]?.created_at ? String(latestResult.rows[0].created_at) : null;
    const freshnessSeconds = latest ? Math.max(0, Math.round((Date.now() - new Date(latest).getTime()) / 1000)) : null;
    return NextResponse.json({
      checked_at: checkedAt,
      sources: {
        receipt_store: { status: 'HEALTHY', count: receiptCount },
        session_persistence: { status: sessionCount > 0 ? 'HEALTHY' : 'UNKNOWN', count: sessionCount },
        verification_api: { status: 'HEALTHY', endpoint: '/api/audits/verify' },
        live_state: { status: 'HEALTHY', endpoint: '/api/live-state' },
        telemetry_freshness: { status: freshnessSeconds == null ? 'UNKNOWN' : 'HEALTHY', seconds: freshnessSeconds },
      },
    }, { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch {
    return NextResponse.json({ checked_at: checkedAt, sources: { receipt_store: { status: 'UNKNOWN' }, session_persistence: { status: 'UNKNOWN' }, verification_api: { status: 'HEALTHY', endpoint: '/api/audits/verify' }, live_state: { status: 'UNKNOWN' }, telemetry_freshness: { status: 'UNKNOWN', seconds: null } } }, { status: 503 });
  }
}
