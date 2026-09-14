import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { applyRequestContext, createRequestContext, type RequestContext } from '@/lib/request-context';

function unauthorized(context: RequestContext): NextResponse {
  return applyRequestContext(new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Lex Aureon Admin"' },
  }), context);
}

function isAuthorized(req: NextRequest, adminPassword: string): boolean {
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const spaceIdx = auth.indexOf(' ');
  if (spaceIdx < 0 || auth.slice(0, spaceIdx).toLowerCase() !== 'basic') return false;
  try {
    const decoded = atob(auth.slice(spaceIdx + 1));
    const colonIdx = decoded.indexOf(':');
    return colonIdx >= 0 && decoded.slice(colonIdx + 1) === adminPassword;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const context = createRequestContext(req.headers);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-request-id', context.requestId);
  requestHeaders.set('x-trace-id', context.traceId);

  let adminPassword: string;
  try {
    adminPassword = env.ADMIN_PASSWORD;
  } catch {
    return applyRequestContext(new NextResponse('Admin access is not configured', { status: 503 }), context);
  }

  if (!isAuthorized(req, adminPassword)) return unauthorized(context);
  return applyRequestContext(NextResponse.next({ request: { headers: requestHeaders } }), context);
}

export const config = {
  matcher: [
    '/admin',
    '/admin/:path*',
    '/observability',
    '/observability/:path*',
    '/api/observability/:path*',
  ],
};
