import { NextResponse } from 'next/server';
import {
  createAuthorizationCodeForAccount, normalizeMcpResource, MCP_ISSUER, MCP_SCOPE,
} from '@/lib/mcp_oauth';
import {
  accountFromCookie, authenticateAccount, checkAccountRateLimit,
  clientRateLimitKey, createAccountSessionCookie,
} from '@/lib/auth_accounts';
import { getClientIp } from '@/lib/rate_limit';
import { isTrustedApprovalOrigin } from '@/lib/security/approval_origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

function html(body: string, status = 200) {
  return new NextResponse(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Connect Lex Aureon</title><style>
    body{font-family:system-ui;max-width:520px;margin:8vh auto;padding:24px;color:#171717}
    input{width:100%;padding:12px;margin:8px 0 16px;box-sizing:border-box;border:1px solid #bbb;border-radius:8px}
    button{padding:12px 18px;border:0;border-radius:8px;background:#171717;color:white;cursor:pointer}
    a{color:#2457c5}small{color:#666}.error{color:#a21b1b}
  </style></head><body>${body}</body></html>`, {
    status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' },
  });
}

function redirectError(redirectUri: string, state: string, error: string, description: string) {
  const u = new URL(redirectUri);
  u.searchParams.set('error', error);
  u.searchParams.set('error_description', description);
  if (state) u.searchParams.set('state', state);
  u.searchParams.set('iss', MCP_ISSUER);
  return NextResponse.redirect(u, 302);
}

function readAuthorizationFields(form: FormData) {
  const clientId = String(form.get('client_id') ?? '');
  const redirectUri = String(form.get('redirect_uri') ?? '');
  const scope = String(form.get('scope') ?? MCP_SCOPE);
  const state = String(form.get('state') ?? '');
  const resource = normalizeMcpResource(String(form.get('resource') ?? '')) ?? '';
  const codeChallenge = String(form.get('code_challenge') ?? '');
  return { clientId, redirectUri, scope, state, resource, codeChallenge };
}

function authorizationUrl(fields: ReturnType<typeof readAuthorizationFields>): URL {
  const url = new URL('/oauth/authorize', MCP_ISSUER);
  url.searchParams.set('client_id', fields.clientId);
  url.searchParams.set('redirect_uri', fields.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', fields.scope);
  url.searchParams.set('state', fields.state);
  url.searchParams.set('resource', fields.resource);
  url.searchParams.set('code_challenge', fields.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url;
}

function hiddenFields(fields: ReturnType<typeof readAuthorizationFields>): string {
  return Object.entries(fields).map(([name, value]) =>
    `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`,
  ).join('');
}

function validAuthorizationRequest(fields: ReturnType<typeof readAuthorizationFields>, codeChallengeMethod: string): boolean {
  return Boolean(fields.clientId && fields.redirectUri && fields.state && fields.resource
    && codeChallengeMethod === 'S256'
    && /^[A-Za-z0-9_-]{43,128}$/.test(fields.codeChallenge));
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const p = u.searchParams;
  const fields = {
    clientId: p.get('client_id') ?? '',
    redirectUri: p.get('redirect_uri') ?? '',
    scope: p.get('scope') ?? MCP_SCOPE,
    state: p.get('state') ?? '',
    resource: normalizeMcpResource(p.get('resource')) ?? '',
    codeChallenge: p.get('code_challenge') ?? '',
  };
  const codeChallengeMethod = p.get('code_challenge_method') ?? '';
  if (p.get('response_type') !== 'code' || !validAuthorizationRequest(fields, codeChallengeMethod)) {
    return new NextResponse('Invalid OAuth authorization request', { status: 400 });
  }

  const user = await accountFromCookie(req.headers.get('cookie')).catch(() => null);
  const formFields = hiddenFields(fields);
  if (!user) {
    return html(`<h1>Sign in to connect Lex</h1>
      <p>Use your verified Lex Aureon account to authorize this connection. You do not need to copy or disclose an API key.</p>
      <form method="post">
        <input type="hidden" name="action" value="login">${formFields}
        <label>Email</label><input name="email" type="email" autocomplete="username" maxlength="254" required>
        <label>Password</label><input name="password" type="password" autocomplete="current-password" maxlength="256" required>
        <button type="submit">Sign in and continue</button>
      </form>
      <p><a href="/keys">Create a Lex account</a> if you do not have one yet.</p>
      <small>New accounts must verify their email before connecting.</small>`);
  }

  return html(`<h1>Connect Lex Aureon</h1>
    <p>Signed in as <strong>${escapeHtml(user.email)}</strong>.</p>
    <p>ChatGPT is requesting access to Lex Aureon governance tools under your account's free-tier permissions.</p>
    <form method="post">
      <input type="hidden" name="action" value="authorize">${formFields}
      <button type="submit">Authorize connection</button>
    </form>
    <p><a href="/api/auth/logout">Sign out</a></p>
    <small>Lex will not grant operator, private-test, or sovereign privileges through this public connection.</small>`);
}

export async function POST(req: Request) {
  if (!isTrustedApprovalOrigin(req)) return html('<h1>Request not accepted</h1><p>The request origin was not accepted.</p>', 403);
  const form = await req.formData().catch(() => null);
  if (!form) return html('<h1>Invalid request</h1>', 400);
  const fields = readAuthorizationFields(form);
  const action = String(form.get('action') ?? '');
  if (!validAuthorizationRequest(fields, 'S256')) return html('<h1>Invalid authorization request</h1>', 400);

  if (action === 'login') {
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    try {
      const ip = getClientIp(req);
      if (!await checkAccountRateLimit(clientRateLimitKey(ip, 'oauth-login'), 12, 15 * 60)
        || !await checkAccountRateLimit(clientRateLimitKey(ip, `oauth-login:${email.trim().toLowerCase()}`), 6, 15 * 60)) {
        return html('<h1>Too many sign-in attempts</h1><p>Please try again later.</p>', 429);
      }
      const result = await authenticateAccount(email, password);
      if (!result) return html(`<h1>Sign-in failed</h1><p class="error">Email or password was not accepted.</p><p><a href="${escapeHtml(authorizationUrl(fields).toString())}">Return to connection</a></p>`, 401);
      if (!result.verified) return html('<h1>Email verification required</h1><p>Verify your email address before connecting. You can request a fresh verification email from the account registration page.</p><p><a href="/keys">Open account settings</a></p>', 403);
      const response = NextResponse.redirect(authorizationUrl(fields), 302);
      response.headers.set('Set-Cookie', createAccountSessionCookie(result.user));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch {
      return html('<h1>Sign-in unavailable</h1><p>Please try again later.</p>', 503);
    }
  }

  if (action !== 'authorize') return html('<h1>Invalid request</h1>', 400);
  const result = await createAuthorizationCodeForAccount({
    clientId: fields.clientId, redirectUri: fields.redirectUri,
    cookieHeader: req.headers.get('cookie'), scope: fields.scope,
    resource: fields.resource, codeChallenge: fields.codeChallenge,
  });
  if ('error' in result) {
    if (result.error === 'invalid_client') return html('<h1>OAuth client rejected</h1><p>The registered client or redirect URI was not accepted.</p>', 400);
    if (result.error === 'account_required') return NextResponse.redirect(authorizationUrl(fields), 302);
    if (result.error === 'account_key_limit') return html('<h1>Connection limit reached</h1><p>Your tenant has reached the free-tier API key limit. Revoke an unused key from account settings and try again.</p><p><a href="/keys">Manage account keys</a></p>', 429);
    if (result.error === 'account_key_unavailable') return html('<h1>Connection unavailable</h1><p>Lex could not provision a tenant-scoped connection. No authorization was issued.</p>', 503);
    return redirectError(fields.redirectUri, fields.state, 'access_denied', 'The OAuth authorization request was rejected.');
  }

  const callback = new URL(fields.redirectUri);
  callback.searchParams.set('code', result.code);
  callback.searchParams.set('state', fields.state);
  callback.searchParams.set('iss', MCP_ISSUER);
  return NextResponse.redirect(callback, 302);
}
