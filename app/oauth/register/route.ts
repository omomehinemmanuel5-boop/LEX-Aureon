import { NextResponse } from 'next/server';
import { registerClient } from '@/lib/mcp_oauth';

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'invalid_client_metadata' }, { status: 400 }); }
  const redirects = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((v): v is string => typeof v === 'string') : [];
  const result = await registerClient({
    redirectUris: redirects,
    tokenEndpointAuthMethod: typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : undefined,
  });
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({
    client_id: result.clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
  }, { status: 201 });
}
