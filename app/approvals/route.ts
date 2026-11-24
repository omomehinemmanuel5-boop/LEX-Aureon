import crypto from 'crypto';
import { headers as requestHeaders } from 'next/headers';
import { checkRateLimit, getClientIp } from '@/lib/rate_limit';
import { listApprovalRequests } from '@/lib/approval_requests';
import { isTrustedApprovalOrigin } from '@/lib/security/approval_origin';
import { readCanonicalGovernanceState } from '@/lib/agents/canonical_governance_state';
import { CONSTITUTION } from '@/lib/constitution';
import {
  approvalOwnerFromCookie,
  authenticateApprovalOwner,
  createApprovalOwnerCookie,
} from '@/lib/approval_owner_auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
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

const APPROVAL_NEXT_PATTERN = /^\/approvals(#[A-Za-z0-9_-]{1,64})?$/;
function validApprovalNext(value: string): boolean {
  return APPROVAL_NEXT_PATTERN.test(value);
}

function signInPage(message = '', next = '/approvals', nonce?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lex · Approvals</title><style>*{box-sizing:border-box}body{font:16px system-ui;background:#0b1020;color:#edf2ff;margin:0;padding:24px}.card{max-width:520px;margin:8vh auto;background:#151d31;border:1px solid #293652;border-radius:20px;padding:24px;box-shadow:0 24px 70px #0006}p{color:#adbad2;line-height:1.55}label{font-weight:650}input,button{font:inherit;width:100%;padding:15px;border-radius:12px;margin-top:10px}input{background:#0b1020;color:white;border:1px solid #40506e}button{border:0;background:#6c8cff;color:#081020;font-weight:750;cursor:pointer}.error{color:#ffb4aa}</style></head><body><main class="card"><h1>Lex approvals</h1><p>Sign in with the API key that owns this request. Your key is checked without consuming its usage quota. Your approval inbox shows only requests created by this key.</p>${message ? `<p class="error" role="alert">${escapeHtml(message)}</p>` : ''}<form method="post" action="/approvals"><input type="hidden" name="next" value="${escapeHtml(next)}"><label for="api_key">Owner API key</label><input id="api_key" name="api_key" type="password" autocomplete="off" required><button type="submit">Sign in to review requests</button></form></main>${nonce ? `<script nonce="${escapeHtml(nonce)}">(()=>{const n=document.querySelector('input[name="next"]');const h=window.location.hash;if(n&&/^#[A-Za-z0-9_-]{1,64}$/.test(h))n.value="/approvals"+h;})();</script>` : ''} </body></html>`;
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

async function approvalsPage(ownerId: string): Promise<Response> {
  try {
    const requests = await listApprovalRequests(ownerId);
    const cards = (await Promise.all(requests.map(async item => {
      let args: unknown;
      try { args = redact(JSON.parse(item.args_json)); } catch { args = '[unreadable arguments]'; }
      let recoverySnapshot = '';
      try {
        const canonical = await readCanonicalGovernanceState({
          sessionId: item.session_id,
          actorId: `approval-owner:${ownerId}`,
          capability: 'read',
        });
        recoverySnapshot = canonical.available
          ? `<section class="recovery"><h3>Current recovery gate snapshot</h3><dl><div><dt>Recovery state</dt><dd>${escapeHtml(canonical.state.recoveryState)}</dd></div><div><dt>M</dt><dd>${escapeHtml(canonical.state.M.toFixed(3))}</dd></div><div><dt>n_stable</dt><dd>${escapeHtml(canonical.state.nStable)}</dd></div><div><dt>Required N_MIN</dt><dd>${escapeHtml(CONSTITUTION.N_MIN)}</dd></div><div><dt>canary_passed</dt><dd>${escapeHtml(canonical.state.canaryPassed === true ? 'true' : 'false')}</dd></div></dl><p class="note">This is the current read-only snapshot, not an execution permit. Lex rechecks the gate and consumes approval only when the agent retries the unchanged action.</p></section>`
          : '<p class="note">Recovery gate snapshot unavailable. Execution remains governed and fail-closed.</p>';
      } catch {
        recoverySnapshot = '<p class="note">Recovery gate snapshot unavailable. Execution remains governed and fail-closed.</p>';
      }
      const pending = item.status === 'pending';
      const actions = pending
        ? `<div class="buttons"><form method="post" action="/approvals/${encodeURIComponent(item.request_id)}/approved"><button class="allow" type="submit">Approve this exact action</button></form><form method="post" action="/approvals/${encodeURIComponent(item.request_id)}/denied"><button class="deny" type="submit">Deny</button></form></div><p class="note">Approval is single-use and only applies to these unchanged arguments. Resume with <code>approval_request_id</code>; Lex rechecks policy before execution.</p>`
        : `<p class="note">This request is ${escapeHtml(item.status)}. Approval records consent only; the agent must retry the unchanged action with <code>approval_request_id</code>, and Lex rechecks governance before execution.</p>`;
      const patchArgs = item.tool_name === 'patch_file' && args && typeof args === 'object' && !Array.isArray(args)
        ? args as Record<string, unknown>
        : null;
      const actionDetails = patchArgs
        ? `<h3>Patch preview</h3><h4>Old text</h4><pre class="patch-block">${escapeHtml(String(patchArgs.old_str ?? ''))}</pre><h4>New text</h4><pre class="patch-block">${escapeHtml(String(patchArgs.new_str ?? ''))}</pre><details><summary>Raw JSON</summary><pre>${escapeHtml(JSON.stringify(args, null, 2))}</pre></details>`
        : `<h3>Exact action details</h3><pre>${escapeHtml(JSON.stringify(args, null, 2))}</pre>`;
      return `<article id="${escapeHtml(item.request_id)}" class="request ${escapeHtml(item.status)}"><div class="eyebrow">${escapeHtml(item.status.toUpperCase())}</div><h2>${escapeHtml(item.tool_name)}</h2><dl><div><dt>Approval request ID</dt><dd>${escapeHtml(item.request_id)}</dd></div><div><dt>Requested by</dt><dd>${escapeHtml(item.owner_id)}</dd></div><div><dt>Session</dt><dd>${escapeHtml(item.session_id)}</dd></div><div><dt>Created</dt><dd>${escapeHtml(new Date(item.created_at).toLocaleString())}</dd></div><div><dt>Expires</dt><dd>${escapeHtml(new Date(item.expires_at).toLocaleString())}</dd></div></dl>${recoverySnapshot}${actionDetails}${actions}</article>`;
    }))).join('');
    return response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1020"><title>Lex · Approval history</title><style>*{box-sizing:border-box}body{font:16px system-ui;background:#0b1020;color:#edf2ff;margin:0;padding:20px}.wrap{max-width:780px;margin:0 auto}h1{font-size:clamp(1.8rem,6vw,2.5rem);margin:.35rem 0}.lead,.note{color:#adbad2;line-height:1.55}.request{background:#151d31;border:1px solid #293652;border-radius:18px;padding:20px;margin:18px 0;box-shadow:0 18px 48px #0004}.request{scroll-margin-top:1rem}.request:target{outline:2px solid #6c8cff;outline-offset:4px}.patch-block{white-space:pre-wrap;overflow-wrap:anywhere;max-height:30vh;overflow:auto;background:#0b1020;border:1px solid #293652;border-radius:12px;padding:14px;color:#dbe5fa;font-size:.84rem}details{margin-top:12px}summary{cursor:pointer;color:#adbad2}.request.approved{border-color:#4a8d68}.request.used{border-color:#5876b6}.request.denied,.request.expired{border-color:#72546a}.eyebrow{font-size:.72rem;font-weight:800;letter-spacing:.12em;color:#ffcb77}.approved .eyebrow{color:#a6f0c6}.used .eyebrow{color:#a9c7ff}.denied .eyebrow,.expired .eyebrow{color:#ffb4aa}.request h2{overflow-wrap:anywhere}.request h3{font-size:1rem;margin-bottom:8px}.request dl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.request dt{font-size:.78rem;color:#9caecb}.request dd{margin:4px 0 0;overflow-wrap:anywhere}.recovery{border:1px solid #40506e;border-radius:12px;padding:12px;margin:14px 0}.recovery h3{margin-top:0}.recovery dl{margin:8px 0}.request pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:38vh;overflow:auto;background:#0b1020;border:1px solid #293652;border-radius:12px;padding:14px;color:#dbe5fa;font-size:.84rem}.buttons{display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-top:16px}.buttons form{margin:0}.buttons button{width:100%;min-height:54px;border-radius:12px;border:0;font:inherit;font-weight:800;cursor:pointer}.allow{background:#a6f0c6;color:#062618}.deny{background:#303c54;color:#fff}.note{font-size:.82rem;margin-bottom:0}.empty{background:#151d31;border-radius:16px;padding:22px;color:#adbad2}@media(max-width:520px){body{padding:14px}.request{padding:16px}.request dl{grid-template-columns:1fr}.buttons{grid-template-columns:1fr}.buttons button{min-height:58px}}</style></head><body><main class="wrap"><h1>Approval history</h1><p class="lead">This inbox contains only requests created by your authenticated API key. Pending requests are actionable. Approval records consent only; Lex rechecks governance and consumes it once when the agent retries the unchanged action.</p>${cards || '<p class="empty">No approval requests have been recorded for this API key.</p>'}</main></body></html>`);
  } catch {
    return response('<!doctype html><title>Approvals unavailable</title><p>Approval requests could not be loaded. No action was authorized.</p>', 503);
  }
}

export async function GET(req?: Request): Promise<Response> {
  const requestedNext = req ? new URL(req.url).searchParams.get('next') : null;
  if (requestedNext !== null && !validApprovalNext(requestedNext)) return response('<!doctype html><title>Invalid return target</title><p>The sign-in return target was rejected.</p>', 400);
  const next = requestedNext ?? '/approvals';
  const cookieHeader = req ? req.headers.get('cookie') : (await requestHeaders()).get('cookie');
  try {
    const ownerId = await approvalOwnerFromCookie(cookieHeader);
    if (ownerId) return approvalsPage(ownerId);
  } catch {
    return response('<!doctype html><title>Approvals unavailable</title><p>Owner authentication is temporarily unavailable.</p>', 503);
  }
  const nonce = crypto.randomBytes(16).toString('base64');
  return response(signInPage('', next, nonce), 200, {
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  });
}

export async function POST(req: Request): Promise<Response> {
  if (!isTrustedApprovalOrigin(req)) return response(signInPage('Request origin was not accepted.'), 403);
  let form: FormData;
  try { form = await req.formData(); } catch { return response(signInPage('Invalid sign-in request.'), 400); }
  const next = String(form.get('next') ?? '/approvals');
  if (!validApprovalNext(next)) return response(signInPage('The sign-in return target was rejected.'), 400);
  const limit = await checkRateLimit(`approval-owner-login:${getClientIp(req)}`, 10, 60 * 60);
  if (limit.storageError) return response(signInPage('Sign-in is temporarily unavailable.', next), 503);
  if (!limit.allowed) return response(signInPage('Too many sign-in attempts. Try again later.', next), 429);
  const submitted = String(form.get('api_key') ?? '');
  try {
    const owner = await authenticateApprovalOwner(submitted);
    if (!owner) return response(signInPage('The API key was not accepted.', next), 401);
    const headers = new Headers({ location: next, 'cache-control': 'no-store' });
    headers.append('set-cookie', createApprovalOwnerCookie(owner));
    return new Response(null, { status: 303, headers });
  } catch {
    return response(signInPage('Owner verification is temporarily unavailable.', next), 503);
  }
}
