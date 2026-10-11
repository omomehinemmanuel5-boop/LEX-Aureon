import crypto from 'crypto';
import { headers as requestHeaders } from 'next/headers';
import { env } from '@/lib/env';
import { checkRateLimit, getClientIp } from '@/lib/rate_limit';
import { listPendingApprovalRequests } from '@/lib/approval_requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const OPERATOR_COOKIE = 'lex_approval_session';
export const OPERATOR_SESSION_TTL_SECONDS = 8 * 60 * 60;

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function safeEqual(left: string, right: string): boolean {
  const a = crypto.createHash('sha256').update(left).digest();
  const b = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(a, b);
}

function cookieSignature(expires: number, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`lex-approval-session:${expires}`).digest('base64url');
}

export function createOperatorSessionCookie(secret: string, nowMs = Date.now()): string {
  const expires = nowMs + OPERATOR_SESSION_TTL_SECONDS * 1000;
  const value = `${expires}.${cookieSignature(expires, secret)}`;
  return `${OPERATOR_COOKIE}=${value}; Path=/approvals; Max-Age=${OPERATOR_SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function hasOperatorSession(cookieHeader: string | null, secret: string, nowMs = Date.now()): boolean {
  const entry = cookieHeader?.split(';').map(part => part.trim()).find(part => part.startsWith(`${OPERATOR_COOKIE}=`));
  if (!entry) return false;
  const value = entry.slice(OPERATOR_COOKIE.length + 1);
  const separator = value.indexOf('.');
  if (separator < 1) return false;
  const expires = Number(value.slice(0, separator));
  const signature = value.slice(separator + 1);
  if (!Number.isSafeInteger(expires) || expires <= nowMs || !signature) return false;
  return safeEqual(signature, cookieSignature(expires, secret));
}

function response(body: string, status = 200, headers: HeadersInit = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      ...headers,
    },
  });
}

function signInPage(message = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Operator approval sign-in</title></head><body style="font:16px system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem;color:#18202b"><h1>Operator approval sign-in</h1><p>Enter the operator secret to review pending exact-action requests.</p>${message ? `<p role="alert">${escapeHtml(message)}</p>` : ''}<form method="post" action="/approvals"><label for="secret">Operator secret</label><br><input id="secret" name="secret" type="password" autocomplete="current-password" required style="width:100%;padding:.7rem;margin:.5rem 0 1rem"><button type="submit">Sign in</button></form></body></html>`;
}

function redact(value: unknown, key = ''): unknown {
  if (/(secret|token|password|api[_-]?key|credential|authorization|cookie)/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  }
  if (typeof value === 'string' && /(lex_sk_|lex_at_|lex_rt_|gh[pousr]_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{16,}|bearer\s+|password\s*[:=])/i.test(value)) return '[REDACTED]';
  return value;
}

async function approvalsPage(): Promise<Response> {
  const secret = env.MCP_OPERATOR_SECRET;
  if (!secret) return response('<!doctype html><title>Approvals unavailable</title><p>The operator approval page is disabled.</p>', 404);
  try {
    const pending = await listPendingApprovalRequests();
    const cards = pending.map(item => {
      let args: unknown;
      try { args = redact(JSON.parse(item.args_json)); } catch { args = '[unreadable arguments]'; }
      return `<article style="border:1px solid #ccd3dc;border-radius:8px;padding:1rem;margin:1rem 0"><h2>${escapeHtml(item.tool_name)}</h2><dl><dt>Owner</dt><dd>${escapeHtml(item.owner_id)}</dd><dt>Session</dt><dd>${escapeHtml(item.session_id)}</dd><dt>Created</dt><dd>${escapeHtml(new Date(item.created_at).toISOString())}</dd><dt>Expires</dt><dd>${escapeHtml(new Date(item.expires_at).toISOString())}</dd></dl><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(JSON.stringify(args, null, 2))}</pre><form method="post" action="/approvals/${encodeURIComponent(item.request_id)}/approved" style="display:inline"><button type="submit">Allow exact action</button></form> <form method="post" action="/approvals/${encodeURIComponent(item.request_id)}/denied" style="display:inline"><button type="submit">Deny</button></form></article>`;
    }).join('');
    return response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Pending approvals</title></head><body style="font:16px system-ui;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#18202b"><h1>Pending approvals</h1><p>Allow applies only to the displayed tool and exact arguments, owner, and session. It is single-use and expires automatically.</p>${cards || '<p>No pending, unexpired approval requests.</p>'}</body></html>`);
  } catch {
    return response('<!doctype html><title>Approvals unavailable</title><p>Approval requests could not be loaded. No action was authorized.</p>', 503);
  }
}

export async function GET(): Promise<Response> {
  const secret = env.MCP_OPERATOR_SECRET;
  if (!secret) return response('<!doctype html><title>Approvals unavailable</title><p>The operator approval page is disabled.</p>', 404);
  const incoming = await requestHeaders();
  if (hasOperatorSession(incoming.get('cookie'), secret)) return approvalsPage();
  return response(signInPage());
}

function isOwnOrigin(req: Request): boolean {
  try { return req.headers.get('origin') === new URL(env.NEXT_PUBLIC_SITE_URL).origin; } catch { return false; }
}

export async function POST(req: Request): Promise<Response> {
  const secret = env.MCP_OPERATOR_SECRET;
  if (!secret) return response('<!doctype html><p>The operator approval page is disabled.</p>', 404);
  if (!isOwnOrigin(req)) return response(signInPage('Request origin was not accepted.'), 403);
  let form: FormData;
  try { form = await req.formData(); } catch { return response(signInPage('Invalid sign-in request.'), 400); }
  const submitted = String(form.get('secret') ?? '');
  if (!safeEqual(submitted, secret)) {
    const limit = await checkRateLimit(`approval-login:${getClientIp(req)}`, 5, 60 * 60);
    if (limit.storageError) return response(signInPage('Sign-in is temporarily unavailable.'), 503);
    if (!limit.allowed) return response(signInPage('Too many failed sign-in attempts. Try again later.'), 429);
    return response(signInPage('The operator secret was not accepted.'), 401);
  }
  const headers = new Headers({ location: '/approvals', 'cache-control': 'no-store' });
  headers.append('set-cookie', createOperatorSessionCookie(secret));
  return new Response(null, { status: 303, headers });
}
