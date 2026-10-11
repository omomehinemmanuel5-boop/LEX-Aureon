import { env } from '@/lib/env';
import { decideApprovalRequest } from '@/lib/approval_requests';
import { hasOperatorSession } from '@/app/approvals/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isOwnOrigin(req: Request): boolean {
  try { return req.headers.get('origin') === new URL(env.NEXT_PUBLIC_SITE_URL).origin; } catch { return false; }
}

function page(message: string, status: number): Response {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><title>Approval result</title></head><body><p>${message}</p><p><a href="/approvals">Return to approvals</a></p></body></html>`, {
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
    return new Response(null, {
      status: 303,
      headers: { location: '/approvals', 'cache-control': 'no-store' },
    });
  } catch {
    return page('Approval storage is unavailable. No decision was recorded.', 503);
  }
}
