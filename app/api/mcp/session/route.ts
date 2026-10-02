import { NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api_keys';
import { issueMcpSession } from '@/lib/mcp_sessions';

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const raw = typeof body === 'object' && body !== null && 'api_key' in body
    ? (body as { api_key?: unknown }).api_key : undefined;
  if (typeof raw !== 'string' || raw.length < 16 || raw.length > 256) {
    return NextResponse.json({ error: 'api_key is required in the request body' }, { status: 400 });
  }
  const checked = await validateApiKey(raw);
  if (!checked.valid || !checked.key) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  const session = issueMcpSession(checked.key);
  if (!session) return NextResponse.json({ error: 'Session authentication unavailable' }, { status: 503 });
  return NextResponse.json({ ok: true, session_token: session.token, expires_at: session.expiresAt }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
