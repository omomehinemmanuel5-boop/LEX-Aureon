export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Approval URLs are navigation hints, never bearer credentials. The inbox
 * requires a verified approver session and filters requests by that session's
 * tenant before rendering any action details.
 */
export async function GET(req: Request): Promise<Response> {
  const requestId = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[A-Za-z0-9_-]{22}$/.test(requestId)) {
    return new Response('Invalid approval link.', { status: 400 });
  }
  return Response.redirect(new URL(`/approvals#${encodeURIComponent(requestId)}`, req.url), 303);
}
