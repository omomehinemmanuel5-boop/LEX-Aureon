import { NextResponse } from 'next/server';
import { extractApiKey, canonicalMcpSessionId, defaultMcpSessionId } from '@/lib/mcp_http';
import { validateApiKey } from '@/lib/api_keys';
import { resetQuarantinedSession } from '@/lib/agents/quarantine_reset';

export const runtime = 'nodejs';

/**
 * Owner self-reset. Resets only the caller's own session, and only when that
 * session is below the quarantine floor. The session is derived from the API
 * key; an optional session_id is accepted only if it belongs to the same owner.
 */
export async function POST(req: Request) {
  const rawKey = extractApiKey(req);
  if (!rawKey) {
    return NextResponse.json({ ok: false, code: 'unauthenticated', message: 'API key required.' }, { status: 401 });
  }

  const validation = await validateApiKey(rawKey);
  if (!validation.valid || !validation.key) {
    return NextResponse.json({ ok: false, code: 'unauthenticated', message: 'API key is invalid.' }, { status: 401 });
  }

  const ownerId = validation.key.id;
  let requested: string | undefined;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.session_id === 'string' && body.session_id.length > 0) requested = body.session_id;
  } catch {
    requested = undefined;
  }

  const sessionId = requested
    ?? canonicalMcpSessionId(ownerId, defaultMcpSessionId(`api_key:${ownerId}`), false);

  const result = await resetQuarantinedSession({ sessionId, ownerId });
  if (result.ok) {
    return NextResponse.json({
      ok: true,
      session_id: sessionId,
      reset_id: result.resetId,
      prior_m: result.priorM,
      prior_sigma: result.priorSigma,
      prior_n_stable: result.priorNStable,
      next_step: 'Retry your request. A fresh uniform trajectory is created on the next governed call; consequential actions still need recovery and per-action approval.',
    });
  }

  const status =
    result.code === 'not_owner' ? 403
    : result.code === 'paused' ? 429
    : result.code === 'not_quarantined' || result.code === 'no_trajectory' || result.code === 'conflict' ? 409
    : 500;
  return NextResponse.json({ ok: false, code: result.code, message: result.message }, { status });
}
