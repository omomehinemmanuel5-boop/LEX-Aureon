/**
 * POST /api/lex/govern
 * SovereignKernel governance cycle with constitutional semantic memory.
 */

import { NextResponse } from 'next/server';
import { SovereignKernel } from '@/lib/sovereign_kernel';
import { writeKernelReceipt, loadKernelState } from '@/lib/kernel_bridge';
import { incrementRuns } from '@/lib/db';
import {
  embedText, retrieveSimilar, buildMemoryContext,
  storeMemory, classifyStateLabel, ensureLexMemoryTable,
  getConstitutionalCentroid, getSessionCentroid,
} from '@/lib/lex_memory';
import { CANONICAL_REFUSAL } from '@/lib/refusals';
import { checkRateLimit, getClientIp } from '@/lib/rate_limit';
import { env } from '@/lib/env';

// Session-scoped kernel cache
const kernelCache = new Map<string, SovereignKernel>();

function getKernel(
  sessionId: string,
  savedState?: { C: number; R: number; S: number } | null,
): SovereignKernel {
  if (!kernelCache.has(sessionId)) {
    const k = new SovereignKernel();
    if (savedState) k.state = savedState;
    kernelCache.set(sessionId, k);
  }
  return kernelCache.get(sessionId)!;
}

let _dbReady = false;
async function ensureDB() {
  if (_dbReady) return;
  await ensureLexMemoryTable();
  _dbReady = true;
}

export async function POST(req: Request) {
  let body: { prompt?: string; session_id?: string; turn?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { prompt, session_id, turn = 1 } = body;
  if (!prompt?.trim())     return NextResponse.json({ error: 'prompt required' },     { status: 400 });
  if (!session_id?.trim()) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  if (prompt.length > 5000) return NextResponse.json({ error: 'prompt too long (max 5000 chars)' }, { status: 400 });

  // ── 0. Rate limit — bypassed for benchmark runs ──────────────────────────
  // Benchmark scripts send X-Bench-Secret header to avoid the per-IP cap.
  // BENCH_SECRET must be set in Vercel env vars.
  const benchSecret = req.headers.get('x-bench-secret');
  const isBenchRun  = benchSecret && benchSecret === (env.BENCH_SECRET ?? '');

  if (!isBenchRun) {
    const ip = getClientIp(req);
    const { allowed, retryAfter } = await checkRateLimit(`lex.govern:${ip}`, 10, 3600);
    if (!allowed) {
      return NextResponse.json(
        { error: `Rate limit exceeded. Try again in ${retryAfter}s.` },
        { status: 429, headers: { 'Retry-After': retryAfter.toString() } }
      );
    }
  }

  await ensureDB();

  // ── 1. Embed prompt + retrieve constitutional memory ──────────────────────
  let promptEmbedding: number[] = [];
  let memoryContext = '';
  try {
    promptEmbedding = await embedText(prompt);
    const memories  = await retrieveSimilar(promptEmbedding, 5);
    memoryContext   = buildMemoryContext(memories);
  } catch { /* non-fatal — kernel runs without memory if Jina fails */ }

  // ── 2. Load persisted kernel state + run cycle ────────────────────────────
  const savedState = await loadKernelState(session_id);
  const kernel     = getKernel(session_id, savedState);

  const result = await kernel.runCycle(prompt, memoryContext, session_id);

  // ── 3. Self-referential CRS measurement ───────────────────────────────────
  let projectionTriggered = result.receipt.safety_projection_triggered;

  if (result.status !== 'Error' && promptEmbedding.length) {
    try {
      const [outputEmb, constCentroid, sessCentroid] = await Promise.all([
        embedText(result.governed_output).catch(() => [] as number[]),
        getConstitutionalCentroid(),
        getSessionCentroid(session_id),
      ]);

      if (outputEmb.length) {
        const sr = kernel.applySelfReferentialMeasurement(
          outputEmb, promptEmbedding, constCentroid, sessCentroid,
        );

        const isRealAttack = result.semantic_signal.attack_type !== 'none'
                          && result.semantic_signal.severity >= 0.7;

        if (isRealAttack && sr.selfCRS.sovereignty_violated) {
          result.governed_output = CANONICAL_REFUSAL;
          result.health_band = 'CRITICAL';
          projectionTriggered = true;
          result.receipt.safety_projection_triggered = true;
        }

        result.M     = Math.min(kernel.state.C, kernel.state.R, kernel.state.S);
        result.state = { ...kernel.state };
      }
    } catch (e) {
      console.error('self-referential CRS error:', e);
    }
  }

  if (result.status === 'Error') {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // ── 4. Persist receipt + store memory ─────────────────────────────────────
  const [receiptId] = await Promise.all([
    writeKernelReceipt(session_id, turn, result),
    incrementRuns(),
    promptEmbedding.length ? storeMemory({
      session_id,
      prompt,
      prompt_hash:            result.receipt.input_hash,
      embedding:              promptEmbedding,
      M:                      result.M,
      C:                      result.state.C,
      R:                      result.state.R,
      S:                      result.state.S,
      health_band:            result.health_band,
      state_label:            classifyStateLabel(projectionTriggered, result.governed_output),
      intervention:           projectionTriggered,
      governed_response_hash: result.receipt.output_hash,
    }) : Promise.resolve(),
  ]);

  return NextResponse.json({
    governed_output:       result.governed_output,
    raw_output:            result.raw_output,
    M:                     result.M,
    health_band:           result.health_band,
    temperature:           result.temperature,
    theta:                 result.theta,
    effective_theta:       result.effective_theta,
    attack_pressure:       result.attack_pressure,
    adv_gain:              result.adv_gain,
    semantic_signal:       result.semantic_signal,
    lyapunov_V:            result.lyapunov_V,
    delta_V:               result.delta_V,
    stability_ratio:       result.stability_ratio,
    suspension_triggered:  result.suspension_triggered,
    epsilon_injected:      result.epsilon_injected,
    projection_triggered:  projectionTriggered,
    projection_magnitude:  result.projection_magnitude,
    state:                 result.state,
    receipt_id:            receiptId,
    memory_injected:       memoryContext.length > 0,
    invariance_violations: result.invariance_violations,
    metrics:               result.metrics ?? null,
    version:               result.receipt.version ?? 'SovereignKernel-TS-v2+Memory+Metrics',
  });
}

export async function GET() {
  return NextResponse.json({
    name:    'Lex Aureon SovereignKernel API',
    version: 'v2+LexMemory',
    endpoint: '/api/lex/govern',
  });
}
