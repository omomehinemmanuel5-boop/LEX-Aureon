import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';
import { logger, errorFields } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get('limit') ?? '8');
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(50, Math.floor(limitParam))) : 8;
  try {
    await initSchema();
    const result = await getClient().execute({
      sql: `SELECT receipt_id, session_id, tool_name, decision, m_score,
                   risk_level, reason, policy_version, created_at
            FROM tool_receipts
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [limit],
    });
    const receipts = result.rows.map(row => ({
      id: String(row.receipt_id),
      session_id: String(row.session_id),
      tool_name: String(row.tool_name),
      decision: String(row.decision),
      m_score: Number(row.m_score ?? 0),
      risk_level: String(row.risk_level ?? 'UNKNOWN'),
      reason: String(row.reason ?? ''),
      policy_version: String(row.policy_version ?? 'unknown'),
      timestamp: new Date(String(row.created_at)).getTime(),
    }));
    return NextResponse.json({
      ok: true,
      status: receipts.length ? 'AVAILABLE' : 'EMPTY',
      receipts,
    }, { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch (error) {
    logger.warn('observatory.tool-receipts', 'query failed', errorFields(error));
    return NextResponse.json({
      ok: false,
      status: 'UNAVAILABLE',
      error: 'tool_receipt_store_unavailable',
      receipts: [],
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
