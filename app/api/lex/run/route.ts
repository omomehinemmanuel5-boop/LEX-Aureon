/**
 * POST /api/lex/run — DEPRECATED
 * All agent logic has been unified into POST /api/lex/govern
 * This stub returns a redirect response for backwards compatibility.
 *
 * fix: was reading process.env.NEXT_PUBLIC_SITE_URL directly, bypassing
 * the centralized env contract in lib/env.ts (which already declares this
 * var as required and handles aliasing/fallback consistently).
 */
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // Proxy to the unified govern endpoint
  const govUrl = new URL('/api/lex/govern', env.NEXT_PUBLIC_SITE_URL);
  const res = await fetch(govUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
