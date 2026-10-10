import { NextResponse } from 'next/server';
import { registerClient } from '@/lib/mcp_oauth';

const ALLOWED_ORIGINS = new Set([
  'https://chatgpt.com',
  'https://chat.openai.com',
  'https://platform.openai.com',
  'https://claude.ai',
  'https://claude.com',
]);

function corsHeaders(req: Request, extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  const origin = req.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '600');
    headers.append('Vary', 'Origin');
  }
  return headers;
}

export function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400, headers: corsHeaders(req) }); }
  const redirects = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((v): v is string => typeof v === 'string') : [];
  const result = await registerClient({
    redirectUris: redirects,
    tokenEndpointAuthMethod: typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : undefined,
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400, headers: corsHeaders(req) });
  return NextResponse.json({
    client_id: result.clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  }, { status: 201, headers: corsHeaders(req) });
}
