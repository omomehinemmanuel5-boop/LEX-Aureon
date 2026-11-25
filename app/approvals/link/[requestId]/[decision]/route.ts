import { checkRateLimit, getClientIp } from '@/lib/rate_limit';
import { decideApprovalRequest } from '@/lib/approval_requests';
import { accountFromCookie } from '@/lib/auth_accounts';
import { isTrustedApprovalOrigin } from '@/lib/security/approval_origin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function page(message: string, status: number): Response {
  const successful = status < 400;
  const heading = successful ? 'Decision recorded' : 'Approval not completed';
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Lex · Approval result</title></head><body><main><h1>${heading}</h1><p>${message}</p><a href="/approvals">Open the authenticated approval inbox</a></main></body></html>`, {
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
  const limit = await checkRateLimit(`approval-owner-decision:${getClientIp(req)}`, 30, 60);
  if (limit.storageError) return page('Approval service is temporarily unavailable. No decision was recorded.', 503);
  if (!limit.allowed) return page('Too many approval attempts. Try again later.', 429);
  let account;
  try {
    account = await accountFromCookie(req.headers.get('cookie'));
  } catch {
    return page('Approver verification is temporarily unavailable. No decision was recorded.', 503);
  }
  if (!account) return page('Sign in with a verified approver account belonging to this tenant before deciding this request.', 401);
  const { requestId, decision } = await context.params;
  if (decision !== 'approved' && decision !== 'denied') return page('Invalid decision.', 400);
  if (!/^[A-Za-z0-9_-]{22}$/.test(requestId)) return page('Invalid approval link.', 400);
  try {
    const changed = await decideApprovalRequest({
      requestId,
      tenantId: account.tenantId,
      decision,
      decidedBy: `user:${account.id}`,
    });
    if (!changed) return page('No decision was recorded. The request may be expired or already decided, or your signed-in approver account may belong to a different tenant.', 409);
    return page(
      decision === 'approved'
        ? 'Approval recorded for your tenant. This does not execute the action. Lex rechecks current policy and consumes this approval only when the agent retries the exact action.'
        : 'Denial recorded for your tenant. This request cannot authorize execution of the action.',
      200,
    );
  } catch {
    return page('Approval storage is unavailable. No decision was recorded.', 503);
  }
}
