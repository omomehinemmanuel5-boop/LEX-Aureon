import { NextResponse } from 'next/server';
import { accountFromCookie } from '@/lib/auth_accounts';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const user = await accountFromCookie(req.headers.get('cookie'));
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json(user, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Account session is temporarily unavailable.' }, { status: 503 });
  }
}
