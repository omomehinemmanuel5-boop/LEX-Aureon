/**
 * POST /api/benchmarks/publish
 *
 * The ONLY writer to benchmark_results. Authenticated with BENCH_SECRET so that
 * only a trusted scoring run can publish numbers — the table is the single
 * source of truth the site and README display, so write access is gated.
 *
 * Auth: Authorization: Bearer <BENCH_SECRET>  (or X-Bench-Secret: <BENCH_SECRET>)
 * If BENCH_SECRET is unset in the environment, publishing is disabled (503) —
 * fail closed, never accept unauthenticated writes.
 *
 * FIX (2026-07-04): authorized() trimmed the CLIENT-provided header value but
 * compared it against env.BENCH_SECRET completely untrimmed (lib/env.ts's
 * optional() is a raw process.env passthrough with no trimming at all). If the
 * secret stored in Vercel picked up so much as a trailing newline or space —
 * easy to happen copy-pasting on mobile, and invisible since Vercel's UI masks
 * the value — every publish attempt would 401 with "unauthorized" REGARDLESS
 * of how carefully the GitHub Actions secret was re-entered, because the
 * mismatch was on this server's side, not the caller's. Both sides are now
 * trimmed symmetrically. Also logs a SAFE diagnostic on auth failure — lengths
 * and whether trimming would have mattered, never the actual secret value —
 * so a future mismatch is visible in Vercel logs instead of a bare 401 with no
 * way to tell "wrong value" from "right value, whitespace bug" apart.
 *
 * Body (one metric per call, or an array of metrics):
 *   {
 *     "benchmark": "advbench",
 *     "run_date": "2026-06-30",
 *     "n_total": 520,
 *     "metric_name": "ASR",
 *     "bare_score": 0,            // percentage 0–100
 *     "governed_score": 0,        // percentage 0–100
 *     "delta_pp": 0,              // governed − bare (pp); computed if omitted
 *     "notes": "llm-judge llama-3.1-8b; bare=llama-3.3-70b; kernel <commit>"
 *   }
 *
 * Returns the inserted row id(s). Append-only — re-publishing updates what the
 * site shows (reader takes MAX(id)) without deleting history.
 */

import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { publishBenchmarkResult, type BenchmarkRow } from '@/lib/benchmark_results';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface AuthResult {
  ok: boolean;
  // Diagnostic only — never includes the actual secret value.
  reason?: string;
}

function checkAuth(req: NextRequest, rawSecret: string): AuthResult {
  const secret = rawSecret.trim();
  const authHeader = req.headers.get('authorization') ?? '';
  const rawBearer  = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7) : '';
  const bearer     = rawBearer.trim();
  const rawHeader  = req.headers.get('x-bench-secret') ?? '';
  const header     = rawHeader.trim();

  if (bearer === secret && bearer.length > 0) return { ok: true };
  if (header === secret && header.length > 0) return { ok: true };

  if (!bearer && !header) return { ok: false, reason: 'no credential provided' };

  // Whitespace-only mismatch is the most common real-world cause (e.g. a
  // trailing newline picked up when copying a secret on mobile) — flag it
  // specifically so it's obvious in logs without ever revealing the secret.
  const providedRaw = rawBearer || rawHeader;
  const providedTrimmed = bearer || header;
  const wouldMatchIfBothTrimmed = providedTrimmed === secret;
  const rawLengthDiffersFromTrimmed = providedRaw.length !== providedTrimmed.length;

  return {
    ok: false,
    reason: wouldMatchIfBothTrimmed
      ? 'whitespace-only mismatch (values match after trim — should not happen post-fix)'
      : rawLengthDiffersFromTrimmed
        ? `credential has leading/trailing whitespace; trimmed length ${providedTrimmed.length} vs expected ${secret.length}`
        : `credential mismatch; provided length ${providedTrimmed.length} vs expected ${secret.length}`,
  };
}

function coerceRow(raw: Record<string, unknown>): BenchmarkRow | { error: string } {
  const benchmark   = String(raw.benchmark ?? '').trim();
  const metric_name = String(raw.metric_name ?? '').trim();
  if (!benchmark)   return { error: 'benchmark is required' };
  if (!metric_name) return { error: 'metric_name is required' };

  const n_total        = Number(raw.n_total ?? 0);
  const bare_score     = Number(raw.bare_score ?? 0);
  const governed_score = Number(raw.governed_score ?? 0);
  const delta_pp       = raw.delta_pp !== undefined && raw.delta_pp !== null
    ? Number(raw.delta_pp)
    : governed_score - bare_score;

  if (!Number.isFinite(bare_score) || !Number.isFinite(governed_score)) {
    return { error: 'bare_score and governed_score must be numbers (percentage 0–100)' };
  }

  const run_date = String(raw.run_date ?? new Date().toISOString().slice(0, 10));
  const notes    = String(raw.notes ?? '');

  return { benchmark, run_date, n_total, metric_name, bare_score, governed_score, delta_pp, notes };
}

export async function POST(req: NextRequest) {
  let secret: string | undefined;
  try {
    secret = env.BENCH_SECRET;
  } catch {
    secret = undefined;
  }
  if (!secret) {
    logger.warn('benchmarks.publish', 'publish attempted with BENCH_SECRET unset', {});
    return NextResponse.json(
      { ok: false, error: 'publishing disabled: BENCH_SECRET not configured' },
      { status: 503 },
    );
  }

  const auth = checkAuth(req, secret);
  if (!auth.ok) {
    // Safe diagnostic — lengths and whitespace shape only, never the secret.
    logger.warn('benchmarks.publish', 'unauthorized publish attempt', { reason: auth.reason });
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }

  const rawRows = Array.isArray(body) ? body : [body];
  const rows: BenchmarkRow[] = [];
  for (const r of rawRows) {
    const coerced = coerceRow((r ?? {}) as Record<string, unknown>);
    if ('error' in coerced) {
      return NextResponse.json({ ok: false, error: coerced.error }, { status: 400 });
    }
    rows.push(coerced);
  }

  try {
    const ids: number[] = [];
    for (const row of rows) {
      ids.push(await publishBenchmarkResult(row));
    }
    logger.info('benchmarks.publish', 'published results', { count: ids.length, benchmarks: rows.map(r => `${r.benchmark}/${r.metric_name}`) });
    return NextResponse.json({ ok: true, inserted: ids.length, ids });
  } catch (e) {
    logger.error('benchmarks.publish', 'publish insert failed', { error: String(e).slice(0, 200) });
    return NextResponse.json({ ok: false, error: String(e).slice(0, 200) }, { status: 500 });
  }
}
