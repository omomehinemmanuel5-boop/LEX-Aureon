import { NextResponse } from 'next/server';
import { createAuthorizationCode, isMcpResource, MCP_ISSUER, MCP_SCOPE } from '@/lib/mcp_oauth';

function html(body: string) {
  return new NextResponse(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Lex Aureon</title><style>body{font-family:system-ui;max-width:520px;margin:10vh auto;padding:24px}input{width:100%;padding:12px;margin:8px 0 16px;box-sizing:border-box}button{padding:12px 18px;border:0;border-radius:8px;cursor:pointer}small{color:#666}</style></head><body>${body}</body></html>`, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

function redirectError(redirectUri: string, state: string, error: string, description: string) {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  u.searchParams.set('iss', MCP_ISSUER);
  // The authorization form is submitted with POST. A 307 would preserve
  // that method when following the redirect, but OAuth callbacks must be
  // reached with GET so ChatGPT can receive the authorization response.
  return NextResponse.redirect(u, 302);
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const p = u.searchParams;
  const clientId = p.get('client_id') ?? '';
  const redirectUri = p.get('redirect_uri') ?? '';
  const responseType = p.get('response_type') ?? '';
  const scope = p.get('scope') ?? MCP_SCOPE;
  const state = p.get('state') ?? '';
  const resource = p.get('resource') ?? '';
  const codeChallenge = p.get('code_challenge') ?? '';
  const codeChallengeMethod = p.get('code_challenge_method') ?? '';

  if (responseType !== 'code' || !clientId || !redirectUri || !state || !isMcpResource(resource) || codeChallengeMethod !== 'S256') {
    return new NextResponse('Invalid OAuth authorization request', { status: 400 });
  }

  return html(`<h1>Connect Lex Aureon</h1>
    <p>Your MCP client is requesting access to Lex Aureon. Enter your Lex API key to authorize this connection.</p>
    <form method="post">
      <input type="hidden" name="client_id" value="${encodeURIComponent(clientId)}">
      <input type="hidden" name="redirect_uri" value="${encodeURIComponent(redirectUri)}">
      <input type="hidden" name="scope" value="${encodeURIComponent(scope)}">
      <input type="hidden" name="state" value="${encodeURIComponent(state)}">
      <input type="hidden" name="resource" value="${encodeURIComponent(resource)}">
      <input type="hidden" name="code_challenge" value="${encodeURIComponent(codeChallenge)}">
      <input type="hidden" name="code_challenge_method" value="S256">
      <label>Lex API key</label>
      <input name="api_key" type="password" autocomplete="off" required placeholder="lex_sk_…">
      <button type="submit">Authorize ChatGPT</button>
    </form>
    <small>Your API key is validated by Lex and is not returned to ChatGPT. OAuth tokens are stored as hashes.</small>`);
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return new NextResponse('Invalid request', { status: 400 });

  const decode = (name: string) => {
    const raw = String(form.get(name) ?? '');
    try { return decodeURIComponent(raw); } catch { return raw; }
  };
  const clientId = decode('client_id');
  const redirectUri = decode('redirect_uri');
  const scope = decode('scope') || MCP_SCOPE;
  const state = decode('state');
  const resource = decode('resource');
  const codeChallenge = decode('code_challenge');
  const apiKey = String(form.get('api_key') ?? '');

  if (!clientId || !redirectUri || !state || resource !== MCP_RESOURCE || !apiKey) {
    return new NextResponse('Invalid authorization request', { status: 400 });
  }

  const result = await createAuthorizationCode({ clientId, redirectUri, apiKey, scope, resource, codeChallenge });
  if ('error' in result) {
    const description = result.error === 'invalid_api_key' ? 'The Lex API key was invalid, expired, or exhausted.' : 'The OAuth authorization request was rejected.';
    return redirectError(redirectUri, state, 'access_denied', description);
  }

  const callback = new URL(redirectUri);
  callback.searchParams.set('code', result.code);
  callback.searchParams.set('state', state);
  callback.searchParams.set('iss', MCP_ISSUER);
  // Use the conventional OAuth 302 after the POSTed consent form; the default
  // 307 preserves POST at ChatGPT's callback and prevents code exchange.
  return NextResponse.redirect(callback, 302);
}
