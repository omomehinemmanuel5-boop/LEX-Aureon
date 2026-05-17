import { NextRequest, NextResponse } from 'next/server';
import { getBackendUrl } from '@/lib/backend';
import { logger, errorFields } from '@/lib/logger';

export async function GET(req: NextRequest) {
  let backend: string;
  try {
    backend = getBackendUrl();
  } catch (e) {
    logger.error('auth.me', 'backend URL not configured', errorFields(e));
    return NextResponse.json({ error: 'Auth service unavailable' }, { status: 503 });
  }

  try {
    const auth = req.headers.get('authorization');
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const res = await fetch(`${backend}/auth/me`, {
      headers: { Authorization: auth },
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return NextResponse.json(
        { error: (data.detail as string) ?? 'Unauthorized' },
        { status: res.status },
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    logger.error('auth.me', 'upstream me failed', errorFields(e));
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
