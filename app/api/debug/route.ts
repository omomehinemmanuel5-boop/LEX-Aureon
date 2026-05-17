import { NextResponse } from 'next/server';

function unauthorized(): NextResponse {
  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Lex Aureon Admin"' },
  });
}

export async function GET(req: Request) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const auth = req.headers.get('authorization');

  let presented: string | null = null;
  if (auth?.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6));
      const colonIdx = decoded.indexOf(':');
      presented = decoded.slice(colonIdx + 1);
    } catch { /* malformed base64 */ }
  }

  if (!adminPassword || !presented || presented !== adminPassword) {
    return unauthorized();
  }

  const host = req.headers.get('host') ?? '';
  const isVercel = req.headers.get('x-vercel-id') !== null;

  return NextResponse.json({
    ok: true,
    groq:  !!process.env.GROQ_API_KEY,
    turso: !!process.env.TURSO_DATABASE_URL,
    jina:  !!process.env.JINA_API_KEY,
    host,
    isVercel,
  });
}
