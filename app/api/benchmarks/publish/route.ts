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

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function authorized(req: NextRequest, secret: string): boolean {
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const header = req.headers.get('x-bench-secret') ?? '';
  return bearer === secret || header === secret;
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
    return NextResponse.json(
      { ok: false, error: 'publishing disabled: BENCH_SECRET not configured' },
      { status: 503 },
    );
  }
  if (!authorized(req, secret)) {
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
    return NextResponse.json({ ok: true, inserted: ids.length, ids });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 200) }, { status: 500 });
  }
}
