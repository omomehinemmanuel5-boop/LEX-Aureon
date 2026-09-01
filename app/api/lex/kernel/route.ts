/**
 * POST /api/lex/kernel — kept for backwards compatibility
 * Canonical endpoint is POST /api/lex/govern
 *
 * wire: loadKernelZ() added alongside loadKernelState() so sessionZ
 * flows into runCycle(). lyapunov_V now certifies V_z(x, z_session).
 */

import { publicError } from '@/lib/safe_error';
import { NextResponse } from 'next/server';
import { SovereignKernel } from '@/lib/sovereign_kernel';
import { writeKernelReceipt, loadKernelState, loadKernelZ } from '@/lib/kernel_bridge';
import {
  embedText, embedTextResolved, embedTextWithProvider, retrieveSimilar, buildMemoryContext,
  storeMemory, classifyStateLabel, ensureLexMemoryTable,
  getConstitutionalCentroid, getSessionCentroid,
  type EmbedProvider,
} from '@/lib/lex_memory';
import { CANONICAL_REFUSAL } from '@/lib/refusals';

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
  // fix (2026-09-01): capture the RESOLVED provider alongside the vector, not
  // just the vector — needed below to pin the output/centroid embeddings in
  // the self-referential CRS block to this SAME provider. Mirrors the
  // established pattern in lib/governance_service.ts (the canonical
  // /api/lex/govern endpoint), which this backwards-compat endpoint never
  // received when that fix (2026-07-04, per lib/lex_memory.ts's file header)
  // was originally applied.
  let promptEmbedding: number[] = [];
  let promptEmbedProvider: EmbedProvider | null = null;
  let memoryContext = '';
  try {
    const resolved       = await embedTextResolved(prompt);
    promptEmbedding      = resolved.vector;
    promptEmbedProvider  = resolved.provider;
    const memories  = await retrieveSimilar(promptEmbedding, 5);
    memoryContext   = buildMemoryContext(memories);
  } catch { /* non-fatal */ }

  // ── 2. Load kernel state + session z concurrently ─────────────────────────
  const [savedState, sessionZ] = await Promise.all([
    loadKernelState(session_id),
    loadKernelZ(session_id),
  ]);
  const kernel = getKernel(session_id, savedState);

  const result = await kernel.runCycle(prompt, memoryContext, session_id, sessionZ);

  // ── Self-referential CRS ──────────────────────────────────────────────────
  // fix (2026-09-01) — CROSS-PROVIDER EMBEDDING MISMATCH: outputEmb and
  // constCentroid were each resolved independently (bare embedText() /
  // getConstitutionalCentroid() with no forced provider), while
  // promptEmbedding above was ALSO independently resolved — three vectors
  // compared against each other with no guarantee any two shared an
  // embedding space. Same root cause fixed in lib/agents/tool_crs.ts earlier
  // this session (commits 5acda12673, 80bcc311c5..3826ab6338), and already
  // correctly handled in the canonical /api/lex/govern endpoint (see
  // lib/governance_service.ts) — this endpoint just never received that
  // fix. Now pins outputEmb and constCentroid to promptEmbedProvider,
  // exactly mirroring governance_service.ts's pattern. sessCentroid is left
  // unforced, matching that same reference implementation — getSessionCentroid
  // self-selects its own most-recently-used provider internally rather than
  // accepting a forced one.
  if (result.status !== 'Error' && promptEmbedding.length && promptEmbedProvider) {
    try {
      const [outputEmb, constCentroid, sessCentroid] = await Promise.all([
        embedTextWithProvider(result.governed_output, promptEmbedProvider).catch(() => [] as number[]),
        getConstitutionalCentroid(promptEmbedProvider),
        getSessionCentroid(session_id),
      ]);
      if (outputEmb.length && constCentroid) {
        const sr = kernel.applySelfReferentialMeasurement(
          outputEmb, promptEmbedding, constCentroid, sessCentroid,
        );
        const isRealAttack = result.semantic_signal.attack_type !== 'none'
                          && result.semantic_signal.severity >= 0.7;
        if (isRealAttack && sr.selfCRS.sovereignty_violated) {
          result.governed_output = CANONICAL_REFUSAL;
          result.health_band = 'CRITICAL';
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
    return NextResponse.json({ error: publicError('kernel.route', result.error) }, { status: 500 });
  }

  // ── 3. Persist receipt + store memory ─────────────────────────────────────
  const [receiptId] = await Promise.all([
    writeKernelReceipt(session_id, turn, result),
    promptEmbedding.length ? storeMemory({
      session_id, prompt,
      prompt_hash:           result.receipt.input_hash,
      embedding:             promptEmbedding,
      M:                     result.M,
      C:                     result.state.C,
      R:                     result.state.R,
      S:                     result.state.S,
      health_band:           result.health_band,
      state_label:           classifyStateLabel(result.receipt.safety_projection_triggered, result.governed_output),
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
    z_weights:            result.receipt.z_weights,
    receipt_id:           receiptId || null,
    receipt_persisted:    !!receiptId,
    memory_injected:      memoryContext.length > 0,
    invariance_violations: result.invariance_violations,
    metrics:              result.metrics ?? null,
    version:              result.receipt.version ?? 'SovereignKernel-TS-v2+AsyncGovernor',
  });
}

export async function GET() {
  return NextResponse.json({
    name:     'Lex Aureon SovereignKernel API',
    version:  'v2+AsyncGovernor',
    endpoint: '/api/lex/kernel',
    governor: 'G(x,z) async sensing — IEC filter + CBF guarantee',
  });
}
