import { NextResponse } from 'next/server';
import { exchangeAuthorizationCode, refreshAccessToken } from '@/lib/mcp_oauth';

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  const grantType = String(form.get('grant_type') ?? '');
  const clientId = String(form.get('client_id') ?? '');
  const resource = String(form.get('resource') ?? '');
  if (!clientId || !resource) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  const result = grantType === 'authorization_code'
    ? await exchangeAuthorizationCode({
        code: String(form.get('code') ?? ''),
        clientId,
        redirectUri: String(form.get('redirect_uri') ?? ''),
        codeVerifier: String(form.get('code_verifier') ?? ''),
        resource,
      })
    : grantType === 'refresh_token'
      ? await refreshAccessToken({ refreshToken: String(form.get('refresh_token') ?? ''), clientId, resource })
      : { error: 'unsupported_grant_type' };

  if ('error' in result) return NextResponse.json(result, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
