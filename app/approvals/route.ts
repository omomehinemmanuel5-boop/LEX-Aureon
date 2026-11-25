import { getApprovalRequestForLink } from '@/lib/approval_link';
import { readCanonicalGovernanceState } from '@/lib/agents/canonical_governance_state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function redact(value: unknown, key = ''): unknown {
  if (/(secret|token|password|api[_-]?key|credential|authorization|cookie)/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, redact(child, childKey)]));
  }
  if (typeof value === 'string' && /(lex_sk_|lex_at_|lex_rt_|gh[pousr]_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{16,}|bearer\\s+|password\\s*[:=])/i.test(value)) return '[REDACTED]';
  return value;
}

function response(body: string, status = 200): Response {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#0b1020"><title>Lex · Approval request</title><style>*{box-sizing:border-box}body{font:16px system-ui;background:#0b1020;color:#edf2ff;margin:0;padding:20px}.card{max-width:720px;margin:5vh auto;background:#151d31;border:1px solid #293652;border-radius:18px;padding:clamp(18px,4vw,28px);box-shadow:0 18px 48px #0004}p,.meta{color:#adbad2;line-height:1.55}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto;background:#0b1020;border:1px solid #293652;border-radius:12px;padding:14px;color:#dbe5fa;font-size:.84rem}.buttons{display:grid;grid-template-columns:2fr 1fr;gap:10px;margin-top:18px}button{width:100%;min-height:54px;border:0;border-radius:12px;font:inherit;font-weight:800;cursor:pointer}.allow{background:#a6f0c6;color:#062618}.deny{background:#303c54;color:white}.warning{border:1px solid #72546a;border-radius:12px;padding:12px;color:#ffd5d0;font-size:.9rem}.empty{color:#adbad2}@media(max-width:520px){.buttons{grid-template-columns:1fr}}</style></head><body><main class="card">${body}</main></body></html>`, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

/** Public entry point. Without a capability ID, no tenant-wide data is listed. */
export async function GET(req: Request): Promise<Response> {
  const requestId = new URL(req.url).searchParams.get('id') ?? '';
  if (!requestId) {
    return response('<h1>Lex approval request</h1><p class="empty">Open the private approval link sent for a specific request. This page does not expose tenant-wide approval history.</p>');
  }
  if (!/^[A-Za-z0-9_-]{22}$/.test(requestId)) return response('<h1>Invalid approval link</h1><p>The request identifier is malformed.</p>', 400);

  try {
    const item = await getApprovalRequestForLink(requestId);
    if (!item) return response('<h1>Approval unavailable</h1><p>This request does not exist or is not tenant-bound.</p>', 404);
    let args: unknown;
    try { args = redact(JSON.parse(item.args_json)); } catch { args = '[unreadable arguments]'; }

    let recovery = '<p class="meta">Recovery snapshot unavailable. Execution remains governed and fail-closed.</p>';
    try {
      const canonical = await readCanonicalGovernanceState({
        sessionId: item.session_id,
        actorId: `approval-owner:${item.tenant_id}`,
        capability: 'read',
      });
      if (canonical.available) {
        recovery = `<p class="meta">Current recovery state: <strong>${escapeHtml(canonical.state.recoveryState)}</strong> · M=${escapeHtml(canonical.state.M.toFixed(3))} · n_stable=${escapeHtml(canonical.state.nStable)} · canary_passed=${escapeHtml(canonical.state.canaryPassed === true)}</p><p class="meta">Informational snapshot only. Lex rechecks governance before execution.</p>`;
      }
    } catch { /* Keep the fail-closed informational fallback. */ }

    const pending = item.status === 'pending' && Date.now() < item.expires_at;
    const actions = pending
      ? `<div class="buttons"><form method="post" action="/approvals/link/${encodeURIComponent(requestId)}/approved"><button class="allow" type="submit">Approve this exact action</button></form><form method="post" action="/approvals/link/${encodeURIComponent(requestId)}/denied"><button class="deny" type="submit">Deny</button></form></div>`
      : `<p>This request is <strong>${escapeHtml(item.status)}</strong>. No further decision can be recorded.</p>`;
    const warning = '<p class="warning">This private link is the credential for this one request. Anyone who possesses it can approve or deny this request until it expires. Do not forward it. The link is single-use for the decision and expires after 15 minutes.</p>';
    return response(`<h1>Review exact action</h1><p>Review the target and arguments before deciding. Your decision records consent only; it does not execute the action.</p><h2>${escapeHtml(item.tool_name)}</h2><p class="meta">Request ${escapeHtml(item.request_id)} · Expires ${escapeHtml(new Date(item.expires_at).toLocaleString())}</p>${recovery}<h3>Exact arguments</h3><pre>${escapeHtml(JSON.stringify(args, null, 2))}</pre>${warning}${actions}`);
  } catch {
    return response('<h1>Approval unavailable</h1><p>Approval storage could not be verified. No action was authorized.</p>', 503);
  }
}
