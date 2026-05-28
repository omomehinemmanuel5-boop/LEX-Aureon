/**
 * POST /api/lex/run — DEPRECATED
 * All agent logic has been unified into POST /api/lex/govern
 * This stub returns a redirect response for backwards compatibility.
 */
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // Proxy to the unified govern endpoint
  const govUrl = new URL('/api/lex/govern', process.env.NEXT_PUBLIC_SITE_URL ?? 'https://lexaureon.com');
  const res = await fetch(govUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
