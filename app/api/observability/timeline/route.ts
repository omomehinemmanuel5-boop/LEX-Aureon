import { NextResponse } from 'next/server';
import { getClient, initSchema } from '@/lib/db';
import { applyRequestContext, createRequestContext } from '@/lib/request-context';

const MAX_LIMIT = 100;
const MAX_SESSION_ID = 200;

export async function GET(req: Request) {
  const context = createRequestContext(req.headers);
  const json = (body: unknown, status = 200) => applyRequestContext(NextResponse.json(body, { status, headers: { 'Cache-Control': status === 200 ? 'private, max-age=5' : 'no-store' } }), context);
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('session_id')?.trim() ?? '';
  const requestedLimit = Number(searchParams.get('limit') ?? '50');
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(MAX_LIMIT, Math.floor(requestedLimit))) : 50;
  if (!sessionId || sessionId.length > MAX_SESSION_ID) return json({ error: 'A valid session_id is required.' }, 400);

  try {
    await initSchema();
    const result = await getClient().execute({
      sql: 'SELECT receipt_id, session_id, turn, pre_eval_label, m_before, m_after, governor_mode, intervention, slow_drip, governor_effort, sigma_viol, created_at FROM praxis_receipts WHERE session_id = ? ORDER BY turn ASC, created_at ASC LIMIT ?',
      args: [sessionId, limit],
    });
    const events = result.rows.map(row => ({
      id: String(row.receipt_id), session_id: String(row.session_id), turn: Number(row.turn),
      pre_eval_label: String(row.pre_eval_label ?? 'CLEAR'), m_before: Number(row.m_before), m_after: Number(row.m_after),
      governor_mode: String(row.governor_mode), intervention: Number(row.intervention) === 1, slow_drip: Number(row.slow_drip) === 1,
      governor_effort: Number(row.governor_effort), sigma_viol: Number(row.sigma_viol), created_at: String(row.created_at),
    }));
    return json({ session_id: sessionId, events });
  } catch {
    return json({ error: 'Timeline data is temporarily unavailable.', request_id: context.requestId }, 503);
  }
}
