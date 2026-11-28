import { NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyAccountEmail, createAccountSessionCookie } from '@/lib/auth_accounts';
import { isTrustedApprovalOrigin } from '@/lib/security/approval_origin';

export const runtime = 'nodejs';
const Schema = z.object({ token: z.string().min(40).max(60), continuation: z.string().max(4096).optional(), continuation_sig: z.string().max(128).optional() });

export async function POST(req: Request) {
  if (!isTrustedApprovalOrigin(req)) return NextResponse.json({ error: 'Request origin was not accepted.' }, { status: 403 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid verification request.' }, { status: 400 }); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Verification link is invalid or expired.' }, { status: 400 });
  try {
    const verified = await verifyAccountEmail(parsed.data.token, parsed.data.continuation, parsed.data.continuation_sig);
    if (!verified) return NextResponse.json({ error: 'Verification link is invalid, expired, or already used.' }, { status: 400 });
    const response = NextResponse.json({ ok: true, user: verified.user, continuationUrl: verified.continuationUrl });
    response.headers.set('Set-Cookie', createAccountSessionCookie(verified.user));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json({ error: 'Verification is temporarily unavailable.' }, { status: 503 });
  }
}
