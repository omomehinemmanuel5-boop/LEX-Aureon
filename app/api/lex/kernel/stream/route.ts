/**
 * POST /api/lex/kernel/stream — RETIRED (2026-07-09).
 *
 * This route was dead code: confirmed via repo-wide search that no client
 * calls it. lib/use_lex_stream.ts — the single hook both app/chat/page.tsx
 * and app/console/page.tsx use for streaming — hardcodes
 * endpoint = '/api/lex/govern/stream'. This file was never that endpoint.
 *
 * It also carried real defects that would have mattered had it been live:
 * its own independent in-memory kernelCache Map (separate from
 * lib/kernel_cache.ts's shared cache used by every other route), meaning the
 * same session_id could resolve to two different SovereignKernel instances
 * with diverging state depending on which route handled a given turn; and
 * it used embedText()/getConstitutionalCentroid() without the provider-
 * pinning fix applied to /api/lex/govern/stream on 2026-07-04, leaving it
 * exposed to the cross-embedding-space self-referential bug that fix
 * eliminated everywhere else.
 *
 * Kept as an explicit 410 rather than deleted outright (no file-delete tool
 * available in the session that retired it) or left as a silent empty file
 * (undefined Next.js route-registration behavior) — any stray caller gets a
 * clear, intentional signal instead of a confusing 404 or a build-time
 * surprise.
 *
 * Use /api/lex/govern/stream instead.
 */

import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'This endpoint has been retired. Use /api/lex/govern/stream instead.' },
    { status: 410 },
  );
}
