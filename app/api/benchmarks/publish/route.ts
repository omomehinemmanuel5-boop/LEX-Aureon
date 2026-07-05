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
 * Auth logic lives in lib/bench_auth.ts (checkBenchAuth) — extracted so it can
 * be unit-tested directly (see __tests__/bench_auth.test.ts).
 *
 * GET — AUTH-ONLY PRECHECK (2026-07-05): runs the EXACT same auth check as
 * POST but never touches the database. Added so the GitHub Actions workflow
 * can verify BENCH_SECRET matches BEFORE running an expensive multi-hour
 * benchmark suite — previously a secret mismatch was only discovered at the
 * very end, after burning hours of runtime and provider quota, then requiring
 * a screenshot round-trip to diagnose. Now: GET with the same header returns
 * 200 {ok:true} or 401/503 with the same safe diagnostic reason, in under a
 * second, so a bad secret fails the workflow immediately instead of silently
 * wasting a full run. This reuses checkBenchAuth directly, so the precheck can
 * never drift from what the real publish path actually enforces.
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
import { checkBenchAuth } from '@/lib/bench_auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function getSecret(): string | undefined {
  try {
    return env.BENCH_SECRET;
  } catch {
    return undefined;
  }
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

// Auth-only precheck — never touches the database. See header note above.
export async function GET(req: NextRequest) {
  const secret = getSecret();
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'publishing disabled: BENCH_SECRET not configured' },
      { status: 503 },
    );
  }
  const auth = checkBenchAuth(req.headers.get('authorization'), req.headers.get('x-bench-secret'), secret);
  if (!auth.ok) {
    logger.warn('benchmarks.publish.precheck', 'unauthorized precheck', { reason: auth.reason });
    return NextResponse.json({ ok: false, error: 'unauthorized', reason: auth.reason }, { status: 401 });
  }
  return NextResponse.json({ ok: true, message: 'BENCH_SECRET is valid — publish auth will succeed' });
}

export async function POST(req: NextRequest) {
  const secret = getSecret();
  if (!secret) {
    logger.warn('benchmarks.publish', 'publish attempted with BENCH_SECRET unset', {});
    return NextResponse.json(
      { ok: false, error: 'publishing disabled: BENCH_SECRET not configured' },
      { status: 503 },
    );
  }

  const auth = checkBenchAuth(req.headers.get('authorization'), req.headers.get('x-bench-secret'), secret);
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
