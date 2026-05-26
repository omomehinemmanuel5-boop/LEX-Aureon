/**
 * POST /api/lex/kernel
 * SovereignKernel governance cycle with constitutional semantic memory.
 */

import { NextResponse } from 'next/server';
import { SovereignKernel } from '@/lib/sovereign_kernel';
import { writeKernelReceipt, loadKernelState } from '@/lib/kernel_bridge';
import {
  embedText, retrieveSimilar, buildMemoryContext,
  storeMemory, classifyStateLabel, ensureLexMemoryTable,
} from '@/lib/lex_memory';

// Session-scoped kernel cache
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
  if (!prompt?.trim())    return NextResponse.json({ error: 'prompt required' }, { status: 400 });
  if (!session_id?.trim()) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

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

  if (result.status === 'Error') {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // ── 3. Persist receipt + store memory ─────────────────────────────────────
  const [receiptId] = await Promise.all([
    writeKernelReceipt(session_id, turn, result),
    promptEmbedding.length ? storeMemory({
      session_id,
      prompt,
      prompt_hash:           result.receipt.input_hash,
      embedding:             promptEmbedding,
      M:                     result.M,
      C:                     result.state.C,
      R:                     result.state.R,
      S:                     result.state.S,
      health_band:           result.health_band,
      state_label:           classifyStateLabel(
                               result.receipt.safety_projection_triggered,
                               result.governed_output,
                             ),
      intervention:          result.receipt.safety_projection_triggered,
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
    projection_triggered: result.receipt.safety_projection_triggered,
    projection_magnitude: result.projection_magnitude,
    state:                result.state,
    receipt_id:           receiptId,
    memory_injected:      memoryContext.length > 0,
    invariance_violations: result.invariance_violations,
    version:              'SovereignKernel-TS-v2+LexMemory',
  });
}

export async function GET() {
  return NextResponse.json({
    name:    'Lex Aureon SovereignKernel API',
    version: 'v2+LexMemory',
    endpoint: '/api/lex/kernel',
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
    ],
  });
}
