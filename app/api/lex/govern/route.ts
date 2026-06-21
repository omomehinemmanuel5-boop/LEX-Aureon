/**
 * POST /api/lex/govern
 * SovereignKernel governance cycle — F(x,z) sync + G(x,z) async governor.
 *
 * perf: loadKernelState(session_id) has no dependency on the prompt
 * embedding, so it now runs concurrently with embedText()+retrieveSimilar()
 * instead of waiting behind them. Self-referential CRS measurement
 * (embedText on the output + centroid fetch + sovereignty-violation check)
 * stays here — it's the single place this now runs (see sovereign_kernel.ts
 * for why the old in-kernel copy was removed as dead weight).
 *
 * NOTE: per-IP rate limit (10 req/hour) removed on request. This endpoint
 * is now fully unauthenticated and unthrottled — anyone with the URL can
 * trigger unlimited dual-LLM governance cycles (2 generation calls + embed
 * calls per request) against the production Anthropic/Jina keys. If this
 * is meant to stay public, worth adding auth or a much higher sane ceiling
 * back before traffic picks up.
 *
 * fix: prompt-length cap now imported from lib/schemas.ts (MAX_PROMPT_CHARS)
 * instead of a separate hardcoded 5000 here. lib/schemas.ts previously
 * defined an unused 8000-char limit via RunRequestSchema — nothing actually
 * called parseRunRequest() in production, so the two numbers had drifted
 * with no live conflict, just dead inconsistency. 5000 stays canonical
 * (it's what every receipt to date was written under); schemas.ts now
 * re-exports the same constant instead of its own copy.
 *
 * fix: console.error → structured logger (matches app/api/health/route.ts
 * pattern). Only error message + truncated stack are logged, never prompt
 * or response content.
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
import { MAX_PROMPT_CHARS } from '@/lib/schemas';
import { logger, errorFields } from '@/lib/logger';

const kernelCache = new Map<string, SovereignKernel>();

function getKernel(sessionId: string, savedState?: { C: number; R: number; S: number } | null): SovereignKernel {
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
  if (prompt.length > MAX_PROMPT_CHARS) return NextResponse.json({ error: `prompt too long (max ${MAX_PROMPT_CHARS} chars)` }, { status: 400 });

  await ensureDB();

  // ── Embed + retrieve memory, and load kernel state — run concurrently ────
  // perf: loadKernelState doesn't depend on the prompt embedding, so it no
  // longer waits behind embedText()+retrieveSimilar() on the critical path.
  let promptEmbedding: number[] = [];
  let memoryContext = '';
  const memoryPromise = (async () => {
    try {
      promptEmbedding = await embedText(prompt);
      const memories  = await retrieveSimilar(promptEmbedding, 5);
      memoryContext   = buildMemoryContext(memories);
    } catch (e) {
      logger.warn('govern.memory', 'embed/retrieve failed, continuing without memory context', errorFields(e));
    }
  })();

  const [savedState] = await Promise.all([
    loadKernelState(session_id),
    memoryPromise,
  ]);

  // ── Load kernel + run cycle (F(x,z) sync, G(x,z) async) ─────────────────
  const kernel = getKernel(session_id, savedState);
  const result = await kernel.runCycle(prompt, memoryContext, session_id);

  // ── Self-referential CRS ──────────────────────────────────────────────────
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
          result.health_band     = 'CRITICAL';
          projectionTriggered    = true;
          result.receipt.safety_projection_triggered = true;
        }
        result.M     = Math.min(kernel.state.C, kernel.state.R, kernel.state.S);
        result.state = { ...kernel.state };
      }
    } catch (e) {
      logger.error('govern.self_referential', 'self-referential CRS measurement failed', errorFields(e));
    }
  }

  if (result.status === 'Error') {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // ── Persist receipt + memory ──────────────────────────────────────────────
  const [receiptId] = await Promise.all([
    writeKernelReceipt(session_id, turn, result),
    incrementRuns(),
    promptEmbedding.length ? storeMemory({
      session_id, prompt,
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
    // ── Async governor G(x,z) report ──────────────────────────────────────
    governor_sensing: result.governor_sensing,
    version: result.receipt.version ?? 'SovereignKernel-TS-v2+AsyncGovernor',
  });
}

export async function GET() {
  return NextResponse.json({
    name:     'Lex Aureon SovereignKernel API',
    version:  'v2+AsyncGovernor',
    endpoint: '/api/lex/govern',
    governor: 'G(x,z) async sensing active — IEC filter + CBF guarantee',
  });
}
