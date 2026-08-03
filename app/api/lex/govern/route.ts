/**
 * POST /api/lex/govern
 * Canonical non-streamed governance endpoint.
 *
 * Thin HTTP layer — delegates all business logic to lib/governance_service.ts.
 *
 * Kept executable route comments concise; place long historical rationale in
 * docs/architecture/govern-route-history.md.
 *
 * refactor (2026-08-03): previously 399 lines of inline pipeline logic.
 * Extracted to lib/governance_service.ts — the route now handles only HTTP
 * parsing, validation, and response formatting. Behavior is byte-identical.
 */

import { publicError } from '@/lib/safe_error';
import { NextResponse } from 'next/server';
import { ensureLexMemoryTable } from '@/lib/lex_memory';
import { MAX_PROMPT_CHARS } from '@/lib/schemas';
import { executeGovern, isEvalSession, type GovernRequest, type GovernResponse } from '@/lib/governance_service';
import type { IdentityMode } from '@/lib/sovereign_kernel';

let _dbReady = false;
async function ensureDB() {
  if (_dbReady) return;
  await ensureLexMemoryTable();
  _dbReady = true;
}

const VALID_IDENTITY_MODES: IdentityMode[] = ['full', 'minimal', 'dynamic', 'none'];
function resolveIdentityMode(raw: unknown): IdentityMode {
  return typeof raw === 'string' && (VALID_IDENTITY_MODES as string[]).includes(raw)
    ? raw as IdentityMode
    : 'full';
}

export async function POST(req: Request) {
  let body: { prompt?: string; session_id?: string; turn?: number; identity_mode?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { prompt, session_id, turn = 1 } = body;
  if (!prompt?.trim())     return NextResponse.json({ error: 'prompt required' },     { status: 400 });
  if (!session_id?.trim()) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  if (prompt.length > MAX_PROMPT_CHARS) return NextResponse.json({ error: `prompt too long (max ${MAX_PROMPT_CHARS} chars)` }, { status: 400 });

  const identityMode = resolveIdentityMode(body.identity_mode);
  await ensureDB();

  try {
    const response: GovernResponse = await executeGovern({
      prompt,
      session_id,
      turn,
      identity_mode: identityMode,
    });
    return NextResponse.json(response);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: publicError('govern.kernel', msg) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    name:     'Lex Aureon SovereignKernel API',
    version:  'v2+AsyncGovernor+SingleEngine+UnifiedRefusal+CalibrationDB+ThreatSignal+IdentityMode',
    endpoint: '/api/lex/govern',
    governor: 'G(x,z) async sensing + self-referential sovereignty detection (paper §4.3/§6.2) + input-side threat signal (2026-07-12, held-out harm reference centroid, contrastive recalibration 2026-07-18) + capitulation judge (measurement-only, DB-persisted for Move B accumulate-then-decide). Single-engine constitutional measurement (Move C, 2026-07-07); refusal decision unified in lib/refusal_decision.ts (Move A); healthBand single-sourced in lib/health_band.ts (Move D); calibration accumulation in lib/capitulation_calibration.ts (Move B); optional identity_mode override (2026-07-18: full/minimal/dynamic/none) for governed-arm self-knowledge A/B/C/D testing.',
  });
}
