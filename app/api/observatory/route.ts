import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';

export const runtime = 'nodejs';

function count(rows: Array<Record<string, unknown>>): number {
  return Number(rows[0]?.value ?? 0);
}

export async function GET() {
  try {
    await initSchema();
    const db = getClient();
    const [
      textTotal, textToday, textReal,
      toolTotal, toolToday, toolReal,
      sessions, latestText, latestTool,
    ] = await Promise.all([
      db.execute("SELECT COUNT(*) AS value FROM praxis_receipts"),
      db.execute("SELECT COUNT(*) AS value FROM praxis_receipts WHERE DATE(created_at)=DATE('now')"),
      db.execute("SELECT COUNT(*) AS value FROM praxis_receipts WHERE created_at>=datetime('now','-30 day') AND session_id NOT LIKE 'synthetic_%'"),
      db.execute("SELECT COUNT(*) AS value FROM tool_receipts"),
      db.execute("SELECT COUNT(*) AS value FROM tool_receipts WHERE DATE(created_at)=DATE('now')"),
      db.execute("SELECT COUNT(*) AS value FROM tool_receipts WHERE created_at>=datetime('now','-30 day') AND session_id NOT LIKE 'synthetic_%'"),
      db.execute(`SELECT COUNT(DISTINCT session_id) AS value FROM (
        SELECT session_id FROM praxis_receipts WHERE created_at>=datetime('now','-30 day')
        UNION
        SELECT session_id FROM tool_receipts WHERE created_at>=datetime('now','-30 day')
      )`),
      db.execute("SELECT receipt_id, health_band, created_at FROM praxis_receipts ORDER BY created_at DESC LIMIT 5"),
      db.execute("SELECT receipt_id, tool_name, decision, risk_level, created_at FROM tool_receipts ORDER BY created_at DESC LIMIT 5"),
    ]);
    const textCount = count(textTotal.rows as Array<Record<string, unknown>>);
    const toolCount = count(toolTotal.rows as Array<Record<string, unknown>>);
    const today = count(textToday.rows as Array<Record<string, unknown>>) + count(toolToday.rows as Array<Record<string, unknown>>);
    const real = count(textReal.rows as Array<Record<string, unknown>>) + count(toolReal.rows as Array<Record<string, unknown>>);
    const total = textCount + toolCount;
    return NextResponse.json({
      ok: true,
      status: total > 0 ? 'AVAILABLE' : 'EMPTY',
      total,
      today,
      sessions: count(sessions.rows as Array<Record<string, unknown>>),
      real,
      sources: {
        praxis_receipts: { total: textCount, today: count(textToday.rows as Array<Record<string, unknown>>) },
        tool_receipts: { total: toolCount, today: count(toolToday.rows as Array<Record<string, unknown>>) },
      },
      latest: latestText.rows,
      latest_tool: latestTool.rows,
    }, { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch {
    return NextResponse.json({
      ok: false,
      status: 'UNAVAILABLE',
      error: 'observatory_aggregate_unavailable',
      sources: {
        praxis_receipts: { status: 'UNKNOWN' },
        tool_receipts: { status: 'UNKNOWN' },
      },
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
