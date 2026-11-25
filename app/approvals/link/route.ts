import { getApprovalRequestForLink } from '@/lib/approval_link';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The unguessable request ID is a short-lived capability for one request only. */
export async function GET(req: Request): Promise<Response> {
  const requestId = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{22}$/.test(requestId)) {
    return new Response('Invalid approval link.', { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  try {
    const item = await getApprovalRequestForLink(requestId);
    if (!item) return new Response('Approval request unavailable.', { status: 404, headers: { 'cache-control': 'no-store' } });
    return Response.redirect(new URL(`/approvals?id=${encodeURIComponent(requestId)}`, req.url), 303);
  } catch {
    return new Response('Approval service unavailable.', { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
