import { NextResponse } from 'next/server';
import { clearAccountSessionCookie } from '@/lib/auth_accounts';
import { isTrustedApprovalOrigin } from '@/lib/security/approval_origin';

export async function POST(req: Request) {
  if (!isTrustedApprovalOrigin(req)) return NextResponse.json({ error: 'Request origin was not accepted.' }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.headers.set('Set-Cookie', clearAccountSessionCookie());
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
