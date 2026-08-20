/**
 * POST /api/lex/govern
 * Canonical non-streamed governance endpoint.
 *
 * Thin HTTP layer — delegates business logic to lib/governance_service.ts.
 * Anonymous callers receive a small IP-based budget. Developers can send a
 * Lex Aureon API key for a higher authenticated budget and usage accounting.
 */

import { publicError } from '@/lib/safe_error';
import { NextResponse } from 'next/server';
import { ensureLexMemoryTable } from '@/lib/lex_memory';
import { MAX_PROMPT_CHARS } from '@/lib/schemas';
import { executeGovern, type GovernRequest, type GovernResponse } from '@/lib/governance_service';
import type { IdentityMode } from '@/lib/sovereign_kernel';
import { checkRateLimit, getClientIp } from '@/lib/rate_limit';
import { validateAndConsumeKey } from '@/lib/api_keys';

let _dbReady = false;
async function ensureDB() {
  if (_dbReady) return;
  await ensureLexMemoryTable();
  _dbReady = true;
}

const VALID_IDENTITY_MODES: IdentityMode[] = ['full', 'minimal', 'dynamic', 'none'];
const MAX_BODY_BYTES = 70_000;
const ANONYMOUS_LIMIT = 20;
const AUTHENTICATED_LIMIT = 120;
const WINDOW_SECONDS = 60;

function resolveIdentityMode(raw: unknown): IdentityMode {
  return typeof raw === 'string' && (VALID_IDENTITY_MODES as string[]).includes(raw)
    ? raw as IdentityMode
    : 'full';
}

function getProvidedApiKey(req: Request): string | null {
  const explicit = req.headers.get('x-lex-api-key')?.trim();
  if (explicit) return explicit;
  const authorization = req.headers.get('authorization') ?? '';
  if (!/^bearer\s+/i.test(authorization)) return null;
  const bearer = authorization.replace(/^bearer\s+/i, '').trim();
  return bearer || null;
}

function limitedResponse(retryAfter: number, limit: number) {
  return NextResponse.json(
    { error: 'Rate limit exceeded. Please retry later or use a Lex Aureon API key.' },
    { status: 429, headers: {
      'Retry-After': String(retryAfter),
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': '0',
    } },
  );
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }

  const providedApiKey = getProvidedApiKey(req);
  let authenticated = false;
  if (providedApiKey) {
    const keyResult = await validateAndConsumeKey(providedApiKey);
    if (!keyResult.valid) {
      return NextResponse.json({ error: 'Invalid or exhausted API key' }, { status: 401 });
    }
    authenticated = true;
  }

  const ip = getClientIp(req);
  const rate = await checkRateLimit(
    `lex.govern:ip:${ip}`,
    authenticated ? AUTHENTICATED_LIMIT : ANONYMOUS_LIMIT,
    WINDOW_SECONDS,
  );
  if (!rate.allowed) return limitedResponse(rate.retryAfter, authenticated ? AUTHENTICATED_LIMIT : ANONYMOUS_LIMIT);

  let body: GovernRequest & { identity_mode?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { prompt, session_id, turn = 1 } = body;
  if (!prompt?.trim()) return NextResponse.json({ error: 'prompt required' }, { status: 400 });
  if (!session_id?.trim()) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  if (prompt.length > MAX_PROMPT_CHARS) return NextResponse.json({ error: `prompt too long (max ${MAX_PROMPT_CHARS} chars)` }, { status: 400 });
  if (session_id.length > 128) return NextResponse.json({ error: 'session_id too long (max 128 chars)' }, { status: 400 });
  if (!Number.isInteger(turn) || turn < 1 || turn > 100_000) return NextResponse.json({ error: 'turn must be an integer between 1 and 100000' }, { status: 400 });

  const identityMode = resolveIdentityMode(body.identity_mode);
  await ensureDB();

  try {
    const response: GovernResponse = await executeGovern({ prompt, session_id, turn, identity_mode: identityMode });
    return NextResponse.json(response, { headers: {
      'Cache-Control': 'no-store',
      'X-RateLimit-Limit': String(authenticated ? AUTHENTICATED_LIMIT : ANONYMOUS_LIMIT),
      'X-RateLimit-Remaining': String(rate.remaining),
    } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: publicError('govern.kernel', msg) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    name: 'Lex Aureon SovereignKernel API',
    version: 'v2+AsyncGovernor+SingleEngine+UnifiedRefusal+CalibrationDB+ThreatSignal+IdentityMode',
    endpoint: '/api/lex/govern',
    authentication: 'Optional Lex Aureon API key via x-lex-api-key or Authorization: Bearer; anonymous callers are IP-rate-limited.',
    documentation: '/api-docs',
    governor: 'G(x,z) async sensing + constitutional measurement + refusal decision + health-band calibration.',
  });
}