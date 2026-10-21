import { NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api_keys';
import { issueMcpSession, refreshMcpSession } from '@/lib/mcp_sessions';

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const refreshToken = typeof body === 'object' && body !== null && 'refresh_token' in body
    ? (body as { refresh_token?: unknown }).refresh_token : undefined;
  if (typeof refreshToken === 'string') {
    const session = await refreshMcpSession(refreshToken);
    if (!session) return NextResponse.json({ error: 'Invalid or expired refresh credential' }, { status: 401 });
    return NextResponse.json({ ok: true, session_token: session.token, expires_at: session.expiresAt,
      refresh_token: session.refreshToken, refresh_expires_at: session.refreshExpiresAt }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  const raw = typeof body === 'object' && body !== null && 'api_key' in body
    ? (body as { api_key?: unknown }).api_key : undefined;
  if (typeof raw !== 'string' || raw.length < 16 || raw.length > 256) {
    return NextResponse.json({ error: 'api_key is required in the request body' }, { status: 400 });
  }
  const checked = await validateApiKey(raw);
  if (!checked.valid || !checked.key) return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  const session = await issueMcpSession(checked.key);
  if (!session) return NextResponse.json({ error: 'Session authentication unavailable' }, { status: 503 });
  return NextResponse.json({ ok: true, session_token: session.token, expires_at: session.expiresAt,
    refresh_token: session.refreshToken, refresh_expires_at: session.refreshExpiresAt }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
