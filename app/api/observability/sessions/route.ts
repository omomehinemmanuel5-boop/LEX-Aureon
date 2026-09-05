import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';
import { applyRequestContext, createRequestContext } from '@/lib/request-context';

const MAX_LIMIT = 25;

export async function GET(req: Request) {
  const context = createRequestContext(req.headers);
  const json = (body: unknown, status = 200) => applyRequestContext(NextResponse.json(body, { status, headers: { 'Cache-Control': status === 200 ? 'private, max-age=15' : 'no-store' } }), context);
  const { searchParams } = new URL(req.url);
  const requestedLimit = Number(searchParams.get('limit') ?? '10');
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(requestedLimit))) : 10;
  try {
    await initSchema();
    const result = await getClient().execute({
      sql: 'SELECT session_id, MAX(created_at) AS last_seen, COUNT(*) AS turns FROM praxis_receipts GROUP BY session_id ORDER BY last_seen DESC LIMIT ?',
      args: [limit],
    });
    const sessions = result.rows.map(row => ({ session_id: String(row.session_id), last_seen: String(row.last_seen), turns: Number(row.turns) }));
    return json({ sessions });
  } catch {
    return json({ error: 'Session list is temporarily unavailable.', request_id: context.requestId }, 503);
  }
}
