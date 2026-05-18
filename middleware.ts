import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';

export function middleware(req: NextRequest) {
  // env.ADMIN_PASSWORD throws on missing — startup-validated requirement.
  let adminPassword: string;
  try {
    adminPassword = env.ADMIN_PASSWORD;
  } catch {
    return new NextResponse('Admin access is not configured', { status: 503 });
  }

  const auth = req.headers.get('authorization');
  if (auth) {
    const spaceIdx = auth.indexOf(' ');
    const scheme = auth.slice(0, spaceIdx);
    const encoded = auth.slice(spaceIdx + 1);
    if (scheme === 'Basic' && encoded) {
      const decoded = atob(encoded);
      const colonIdx = decoded.indexOf(':');
      const password = decoded.slice(colonIdx + 1);
      if (password === adminPassword) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Lex Aureon Admin"' },
  });
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
