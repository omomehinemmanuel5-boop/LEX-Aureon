import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateAccount, checkAccountRateLimit, clientRateLimitKey, createAccountSessionCookie } from '@/lib/auth_accounts';
import { getClientIp } from '@/lib/rate_limit';
import { isTrustedApprovalOrigin } from '@/lib/security/approval_origin';

export const runtime = 'nodejs';
const Schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) });

export async function POST(req: Request) {
  if (!isTrustedApprovalOrigin(req)) return NextResponse.json({ error: 'Request origin was not accepted.' }, { status: 403 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Email or password was not accepted.' }, { status: 400 });
  try {
    const ip = getClientIp(req);
    if (!await checkAccountRateLimit(clientRateLimitKey(ip, 'login'), 12, 15 * 60)
      || !await checkAccountRateLimit(clientRateLimitKey(ip, `login:${parsed.data.email.trim().toLowerCase()}`), 6, 15 * 60)) {
      return NextResponse.json({ error: 'Too many sign-in attempts. Try again later.' }, { status: 429 });
    }
    const result = await authenticateAccount(parsed.data.email, parsed.data.password);
    if (!result) return NextResponse.json({ error: 'Email or password was not accepted.' }, { status: 401 });
    if (!result.verified) return NextResponse.json({ error: 'Verify your email address before signing in. Use Register again to request a fresh verification link.' }, { status: 403 });
    const response = NextResponse.json({ user: result.user });
    response.headers.set('Set-Cookie', createAccountSessionCookie(result.user));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return NextResponse.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503 });
  }
}
