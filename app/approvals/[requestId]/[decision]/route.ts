import { env } from '@/lib/env';
import { decideApprovalRequest } from '@/lib/approval_requests';
import { hasOperatorSession } from '@/app/approvals/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isOwnOrigin(req: Request): boolean {
  try { return req.headers.get('origin') === new URL(env.NEXT_PUBLIC_SITE_URL).origin; } catch { return false; }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function page(message: string, status: number): Response {
  const successful = status < 400;
  const heading = successful ? 'Decision recorded' : 'Approval not completed';
  const role = successful ? 'status' : 'alert';
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1020"><title>Lex · Approval result</title><style>*{box-sizing:border-box}body{font:16px system-ui;background:#0b1020;color:#edf2ff;margin:0;padding:20px;min-height:100vh;display:grid;place-items:center}.card{width:100%;max-width:560px;background:#151d31;border:1px solid #293652;border-radius:20px;padding:clamp(20px,5vw,32px);box-shadow:0 24px 70px #0006}.eyebrow{font-size:.75rem;font-weight:800;letter-spacing:.12em;color:${successful ? '#a6f0c6' : '#ffb4aa'}}h1{font-size:clamp(1.6rem,6vw,2.2rem);margin:.6rem 0 1rem}p{color:#c2cde1;line-height:1.65}.button{display:inline-flex;justify-content:center;align-items:center;min-height:50px;padding:12px 18px;margin-top:12px;border-radius:12px;background:#d7e1ff;color:#10182b;font-weight:800;text-decoration:none}.button:focus-visible{outline:3px solid #e8c96d;outline-offset:3px}</style></head><body><main class="card" role="${role}"><div class="eyebrow">LEX AUREON · HUMAN OVERSIGHT</div><h1>${heading}</h1><p>${escapeHtml(message)}</p><a class="button" href="/approvals">Return to approvals</a></main></body></html>`, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ requestId: string; decision: string }> },
): Promise<Response> {
  const secret = env.MCP_OPERATOR_SECRET;
  if (!secret) return page('The operator approval page is disabled.', 404);
  if (!isOwnOrigin(req)) return page('Request origin was not accepted.', 403);
  if (!hasOperatorSession(req.headers.get('cookie'), secret)) return page('Operator sign-in is required.', 401);
  const { requestId, decision } = await context.params;
  if (decision !== 'approved' && decision !== 'denied') return page('Invalid decision.', 400);
  if (!/^[A-Za-z0-9_-]{22}$/.test(requestId)) return page('Invalid request identifier.', 400);
  try {
    const changed = await decideApprovalRequest({ requestId, decision, decidedBy: 'operator' });
    if (!changed) return page('This request is expired, no longer pending, or does not exist. No change was made.', 409);
    return page(
      decision === 'approved'
        ? 'Approval recorded. This does not execute the action. Lex rechecks current policy and consumes this approval only when the agent retries the exact action.'
        : 'Denial recorded. This request cannot authorize execution of the action.',
      200,
    );
  } catch {
    return page('Approval storage is unavailable. No decision was recorded.', 503);
  }
}
