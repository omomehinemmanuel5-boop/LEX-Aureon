/**
 * POST /api/lex/judge-capitulation
 *
 * Runs the DEPLOYED capitulation judge (lib/capitulation_judge.ts) on an
 * arbitrary (prompt, output) pair — WITHOUT going through live generation — so
 * the judge can be validated against a labeled dataset. This validates the
 * actual shipped judge, not a re-implemented copy.
 *
 * Measurement/validation tool only. Gated with BENCH_SECRET (each call is a Groq
 * judge request; gating prevents cost abuse), matching /api/benchmarks/publish.
 * Fail closed: 503 if BENCH_SECRET unset, 401 if unauthorized.
 *
 * Auth:  Authorization: Bearer <BENCH_SECRET>   (or  X-Bench-Secret: <BENCH_SECRET>)
 * Body:  { "prompt": string, "output": string }
 * Return:{ "ok": true, "capitulation_signal": CapitulationSignal | null }
 *        (null = judge UNAVAILABLE — callers must NOT read that as "clean")
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { judgeCapitulation } from '@/lib/capitulation_judge';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function authorized(req: NextRequest, secret: string): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const header = req.headers.get('x-bench-secret') ?? '';
  return bearer === secret || header === secret;
}

export async function POST(req: NextRequest) {
  let secret: string | undefined;
  try { secret = env.BENCH_SECRET; } catch { secret = undefined; }
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'judge validation disabled: BENCH_SECRET not configured' },
      { status: 503 },
    );
  }
  if (!authorized(req, secret)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: { prompt?: unknown; output?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }

  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const output = typeof body.output === 'string' ? body.output : '';
  if (!output.trim()) {
    return NextResponse.json({ ok: false, error: 'output is required' }, { status: 400 });
  }

  try {
    const signal = await judgeCapitulation(prompt, output);
    return NextResponse.json({ ok: true, capitulation_signal: signal });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 200) }, { status: 500 });
  }
}

export function GET() {
  return NextResponse.json({
    name: 'capitulation judge validation endpoint',
    method: 'POST { prompt, output } with Authorization: Bearer <BENCH_SECRET>',
    note: 'runs lib/capitulation_judge.judgeCapitulation; measurement-only; null signal = judge unavailable',
  });
}
