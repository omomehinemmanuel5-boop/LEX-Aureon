import { checkRateLimit, getClientIp } from '@/lib/rate_limit';
import { decideApprovalRequestByLink } from '@/lib/approval_link';
import { isTrustedApprovalOrigin } from '@/lib/security/approval_origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(message: string, status: number): Response {
  const successful = status < 400;
  const heading = successful ? 'Decision recorded' : 'Approval not completed';
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Lex · Approval result</title><style>*{box-sizing:border-box}body{font:16px system-ui;background:#0b1020;color:#edf2ff;margin:0;padding:20px;min-height:100vh;display:grid;place-items:center}.card{width:100%;max-width:560px;background:#151d31;border:1px solid #293652;border-radius:20px;padding:clamp(20px,5vw,32px)}p{color:#c2cde1;line-height:1.65}a{color:#d7e1ff}</style></head><body><main class="card"><h1>${heading}</h1><p>${message}</p><a href="/approvals">Open the authenticated approval inbox</a></main></body></html>`, {
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

export async function POST(
  req: Request,
  context: { params: Promise<{ requestId: string; decision: string }> },
): Promise<Response> {
  if (!isTrustedApprovalOrigin(req)) return page('Request origin was not accepted.', 403);
  const limit = await checkRateLimit(`approval-link-decision:${getClientIp(req)}`, 30, 60);
  if (limit.storageError) return page('Approval service is temporarily unavailable. No decision was recorded.', 503);
  if (!limit.allowed) return page('Too many approval attempts. Try again later.', 429);
  const { requestId, decision } = await context.params;
  if (decision !== 'approved' && decision !== 'denied') return page('Invalid decision.', 400);
  if (!/^[A-Za-z0-9_-]{22}$/.test(requestId)) return page('Invalid approval link.', 400);
  try {
    const changed = await decideApprovalRequestByLink({ requestId, decision });
    if (!changed) return page('This request is expired, already decided, not tenant-bound, or does not exist. No change was made.', 409);
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
