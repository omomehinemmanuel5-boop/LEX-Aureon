/**
 * POST /api/lex/run/stream — DEPRECATED
 * Unified stream is now POST /api/lex/govern/stream
 */
import { NextResponse } from 'next/server';
export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint has moved to /api/lex/govern/stream' },
    { status: 308 }
  );
}
