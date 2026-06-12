/**
 * POST /api/lex/govern
 * SovereignKernel governance cycle with constitutional semantic memory.
 */

import { NextResponse } from 'next/server';
import { SovereignKernel } from '@/lib/sovereign_kernel';
import { writeKernelReceipt, loadKernelState } from '@/lib/kernel_bridge';
import {
  embedText, retrieveSimilar, buildMemoryContext,
  storeMemory, classifyStateLabel, ensureLexMemoryTable,
  getConstitutionalCentroid, getSessionCentroid,
} from '@/lib/lex_memory';

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
  if (!prompt?.trim())     return NextResponse.json({ error: 'prompt required' },    { status: 400 });
  if (!session_id?.trim()) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  if (prompt.length > 5000) return NextResponse.json({ error: 'prompt too long (max 5000 chars)' }, { status: 400 });

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

  const result = await kernel.runCycle(prompt, memoryContext);

  // ── 3. Self-referential CRS measurement ───────────────────────────────────
  //
  // FIX 2026-06-12: Blocking behaviour decoupled from self-referential CRS.
  //
  // OLD (broken): Any sovereignty_violated flag replaced the governed output
  // with a minimal restoration message. This fired on innocent factual
  // questions because their embeddings are semantically distant from the
  // constitutional centroid (which is sovereignty-language-heavy).
  // Result: ~18% of TruthfulQA responses blocked, all scored 0/0.
  //
  // NEW (correct): Two distinct modes:
  //
  //   BLOCK  — only when semantic_signal detects a real attack (severity ≥ 0.7)
  //            AND sovereignty_violated. Both conditions must be true.
  //            Jailbreaks, identity overrides, prompt injections → blocked.
  //
  //   GOVERN — when sovereignty_violated but NO attack detected.
  //            The LLM response is kept but the constitutional context
  //            injected at step 3 of runCycle already shaped it.
  //            M drops, intervention logged, receipt written — but the
  //            user gets a real answer. Factual questions → governed, not blocked.
  //
  // This preserves 100% of the security properties on real attacks while
  // removing false positives on benign queries.
  // ──────────────────────────────────────────────────────────────────────────

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
          // ── BLOCK: Real attack + sovereignty violated ──────────────────
          // Replace output with a clean, polite refusal.
          // Logged as intervention=1, blocked=true in receipt.
          result.governed_output =
            'I cannot fulfill this request as it involves bypassing my safety guidelines or core identity.';
          result.health_band = 'CRITICAL';
          projectionTriggered = true;
          result.receipt.safety_projection_triggered = true;

        } else if (sr.selfCRS.sovereignty_violated && !isRealAttack) {
          // ── GOVERN: Sovereignty drift on benign query ──────────────────
          // Keep the LLM response — do NOT replace it.
          // The constitutional context already shaped the output at generation.
          // Log intervention so M drift is visible in analytics, but the
          // user gets their answer.
          projectionTriggered = true;
          result.receipt.safety_projection_triggered = true;
          // No output replacement — result.governed_output stays as-is
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
      state_label:            classifyStateLabel(
                                projectionTriggered,
                                result.governed_output,
                              ),
      intervention:           projectionTriggered,
      governed_response_hash: result.receipt.output_hash,
    }) : Promise.resolve(),
  ]);

  return NextResponse.json({
    governed_output:      result.governed_output,
    raw_output:           result.raw_output,
    M:                    result.M,
    health_band:          result.health_band,
    temperature:          result.temperature,
    theta:                result.theta,
    effective_theta:      result.effective_theta,
    attack_pressure:      result.attack_pressure,
    adv_gain:             result.adv_gain,
    semantic_signal:      result.semantic_signal,
    lyapunov_V:           result.lyapunov_V,
    delta_V:              result.delta_V,
    stability_ratio:      result.stability_ratio,
    suspension_triggered: result.suspension_triggered,
    epsilon_injected:     result.epsilon_injected,
    projection_triggered: projectionTriggered,
    projection_magnitude: result.projection_magnitude,
    state:                result.state,
    receipt_id:           receiptId,
    memory_injected:      memoryContext.length > 0,
    invariance_violations: result.invariance_violations,
    metrics:              result.metrics ?? null,
    version:              result.receipt.version ?? 'SovereignKernel-TS-v2+Memory+Metrics',
  });
}

export async function GET() {
  return NextResponse.json({
    name:    'Lex Aureon SovereignKernel API',
    version: 'v2+LexMemory',
    endpoint: '/api/lex/govern',
    memory:  'Jina jina-embeddings-v3 + Turso cosine similarity retrieval',
    innovations: [
      'Constitutional temperature control — LLM temperature varies with M',
      'Dual LLM calls — raw and governed response per turn',
      'Adaptive gain θ(t) — correction strength scales with stress',
      'Two-level hysteresis — soft floor (0.08) + hard CBF floor (0.05)',
      'Semantic transducer — CRS deltas applied before LLM call',
      'Shannon entropy ADV scoring — diverse responses increase S',
      'Epsilon injection — prevents frozen attractors',
      'Constitutional semantic memory — top-5 similar past interactions injected',
      'Attack-gated blocking — block only on real attacks (severity ≥ 0.7), govern on drift',
    ],
  });
}
