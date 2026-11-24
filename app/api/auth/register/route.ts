import { NextResponse } from 'next/server';
import { z } from 'zod';
import { registerAccount, checkAccountRateLimit, clientRateLimitKey } from '@/lib/auth_accounts';
import { getClientIp } from '@/lib/rate_limit';
import { isTrustedApprovalOrigin } from '@/lib/security/approval_origin';

export const runtime = 'nodejs';

const Schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(10).max(256),
  company_name: z.string().trim().min(2).max(120),
});

export async function POST(req: Request) {
  if (!isTrustedApprovalOrigin(req)) return NextResponse.json({ error: 'Request origin was not accepted.' }, { status: 403 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid registration.' }, { status: 400 });
  try {
    const ipKey = clientRateLimitKey(getClientIp(req), 'register');
    if (!await checkAccountRateLimit(ipKey, 5, 60 * 60)) return NextResponse.json({ error: 'Too many registration attempts. Try again later.' }, { status: 429 });
    const result = await registerAccount({ email: parsed.data.email, password: parsed.data.password, companyName: parsed.data.company_name });
    if (result === 'unavailable') return NextResponse.json({ error: 'Email verification is temporarily unavailable. Please try again later.' }, { status: 503 });
    return NextResponse.json({ message: 'If this address can be registered, a verification link has been sent. Check your inbox and spam folder.' }, { status: 202 });
  } catch {
    return NextResponse.json({ error: 'Registration is temporarily unavailable.' }, { status: 503 });
  }
}
