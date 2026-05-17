import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrl } from '@/lib/backend';
import { logger, errorFields } from '@/lib/logger';

export async function POST(req: NextRequest) {
  let backend: string;
  try {
    backend = getBackendUrl();
  } catch (e) {
    logger.error('auth.register', 'backend URL not configured', errorFields(e));
    return NextResponse.json({ error: 'Auth service unavailable' }, { status: 503 });
  }

  try {
    const body = await req.json();
    const res = await fetch(`${backend}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return NextResponse.json(
        { error: (data.detail as string) ?? 'Registration failed' },
        { status: res.status },
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    logger.error('auth.register', 'upstream register failed', errorFields(e));
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
