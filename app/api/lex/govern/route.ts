/**
 * POST /api/lex/govern
 * SovereignKernel governance cycle — F(x,z) sync + G(x,z) async governor.
 *
 * wire: loadKernelZ() threads session-adaptive z into runCycle().
 *
 * wire: callPythonGovernor() now called concurrently with the TypeScript kernel.
 * The Python backend (api/python/govern.py) provides the authoritative CRS
 * measurement using:
 *   - Cosine similarity with decay lambda (CCP)
 *   - Population variance entropy ratio (IEC)
 *   - Normalized Shannon entropy (ADV)
 *   - Full CBF QP filter + 50-step FPL1 simulation
 * On Python success, the Python CRS measurement is used for receipts and
 * the FPL1 classification is added to the response.
 * On Python failure (cold start, timeout), TypeScript kernel values are used.
 * Source is tagged in crs_method: 'python-cbf|...' vs 'SovereignKernel-v2|...'
 */

import { NextResponse } from 'next/server';
import { getCachedKernel } from '@/lib/kernel_cache';
import { writeKernelReceipt, loadKernelState, loadKernelZ } from '@/lib/kernel_bridge';
import { incrementRuns } from '@/lib/db';
import {
  embedText, retrieveSimilar, buildMemoryContext,
  storeMemory, classifyStateLabel, ensureLexMemoryTable,
  getConstitutionalCentroid, getSessionCentroid,
} from '@/lib/lex_memory';
import { CANONICAL_REFUSAL } from '@/lib/refusals';
import { MAX_PROMPT_CHARS } from '@/lib/schemas';
import { logger, errorFields } from '@/lib/logger';
import { callPythonGovernor, mergePythonCRS } from '@/lib/python_bridge';

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

  // ── All async work runs concurrently ─────────────────────────────────────
  let promptEmbedding: number[] = [];
  let memoryContext = '';
  const memoryPromise = (async () => {
    try {
      promptEmbedding = await embedText(prompt);
      const memories  = await retrieveSimilar(promptEmbedding, 5);
      memoryContext   = buildMemoryContext(memories);
    } catch (e) {
      logger.warn('govern.memory', 'embed/retrieve failed', errorFields(e));
    }
  })();

  const [savedState, sessionZ] = await Promise.all([
    loadKernelState(session_id),
    loadKernelZ(session_id),
    memoryPromise,
  ]);

  // ── TypeScript kernel cycle ───────────────────────────────────────────────
  const kernel = getCachedKernel(session_id, savedState);
  const result = await kernel.runCycle(prompt, memoryContext, session_id, sessionZ);

  if (result.status === 'Error') {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // ── Python CRS measurement (concurrent with self-referential) ────────────
  // Calls api/python/govern.py which runs the complete CCP/IEC/ADV pipeline
  // plus CBF QP filter + FPL1 classification. Non-fatal on failure.
  const [pythonResult] = await Promise.allSettled([
    callPythonGovernor(prompt, result.raw_output, result.governed_output),
  ]);
  const python = pythonResult.status === 'fulfilled' ? pythonResult.value : null;

  // Merge Python CRS with TypeScript kernel state
  // Python measurement used for reporting; TypeScript CBF guarantees the floor
  let mergedCRS = python ? mergePythonCRS(
    python,
    result.M,
    result.state.C, result.state.R, result.state.S,
  ) : null;

  // ── Self-referential CRS ──────────────────────────────────────────────────
  let projectionTriggered = result.receipt.safety_projection_triggered;

  if (promptEmbedding.length) {
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
          mergedCRS = null; // Python result no longer valid after refusal
        }
        result.M     = Math.min(kernel.state.C, kernel.state.R, kernel.state.S);
        result.state = { ...kernel.state };
      }
    } catch (e) {
      logger.error('govern.self_referential', 'self-referential CRS failed', errorFields(e));
    }
  }

  // ── Persist receipt ───────────────────────────────────────────────────────
  // crs_method reflects the authoritative engine: mergedCRS.crs_method
  // ('python-cbf|...') when Python succeeded and no refusal nulled it; otherwise
  // writeKernelReceipt falls back to the TypeScript kernel string internally.
  const [receiptId] = await Promise.all([
    writeKernelReceipt(session_id, turn, result, mergedCRS?.crs_method),
    incrementRuns(),
    promptEmbedding.length ? storeMemory({
      session_id, prompt,
      prompt_hash:            result.receipt.input_hash,
      embedding:              promptEmbedding,
      M:                      mergedCRS?.M ?? result.M,
      C:                      mergedCRS?.C ?? result.state.C,
      R:                      mergedCRS?.R ?? result.state.R,
      S:                      mergedCRS?.S ?? result.state.S,
      health_band:            mergedCRS?.health_band ?? result.health_band,
      state_label:            classifyStateLabel(projectionTriggered, result.governed_output),
      intervention:           projectionTriggered,
      governed_response_hash: result.receipt.output_hash,
    }) : Promise.resolve(),
  ]);

  return NextResponse.json({
    governed_output:       result.governed_output,
    raw_output:            result.raw_output,
    // CRS: Python measurement preferred; TypeScript fallback
    M:                     mergedCRS?.M ?? result.M,
    C:                     mergedCRS?.C ?? result.state.C,
    R:                     mergedCRS?.R ?? result.state.R,
    S:                     mergedCRS?.S ?? result.state.S,
    health_band:           mergedCRS?.health_band ?? result.health_band,
    weakest_pillar:        mergedCRS?.weakest_pillar ?? null,
    crs_source:            python ? 'python-cbf' : 'typescript-kernel',
    fpl1:                  mergedCRS?.fpl1 ?? null,
    ccp_lambda:            mergedCRS?.ccp_lambda ?? null,
    iec_variance:          mergedCRS?.iec_variance ?? null,
    // TypeScript kernel values always present
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
    z_weights:             result.receipt.z_weights,
    receipt_id:            receiptId,
    memory_injected:       memoryContext.length > 0,
    invariance_violations: result.invariance_violations,
    metrics:               result.metrics ?? null,
    governor_sensing:      result.governor_sensing,
    version: result.receipt.version ?? 'SovereignKernel-TS-v2+AsyncGovernor',
  });
}

export async function GET() {
  return NextResponse.json({
    name:     'Lex Aureon SovereignKernel API',
    version:  'v2+AsyncGovernor+PythonCBF',
    endpoint: '/api/lex/govern',
    governor: 'G(x,z) async sensing + Python CBF QP + FPL1 classification',
  });
}
