import { NextResponse } from 'next/server';
import { exchangeAuthorizationCode, refreshAccessToken } from '@/lib/mcp_oauth';

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
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: corsHeaders(req) });
  const grantType = String(form.get('grant_type') ?? '');
  const clientId = String(form.get('client_id') ?? '');
  const resource = String(form.get('resource') ?? '');
  if (!clientId || !resource) return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers: corsHeaders(req) });

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

  if ('error' in result) {
    return NextResponse.json(result, { status: 400, headers: corsHeaders(req, { 'Cache-Control': 'no-store' }) });
  }
  return NextResponse.json(result, { headers: corsHeaders(req, { 'Cache-Control': 'no-store' }) });
}
