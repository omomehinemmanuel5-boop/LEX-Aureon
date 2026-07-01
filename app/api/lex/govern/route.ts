/**
 * POST /api/lex/govern
 * SovereignKernel governance cycle — F(x,z) sync + G(x,z) async governor.
 *
 * wire: loadKernelZ() threads session-adaptive z into runCycle().
 *
 * wire: callPythonGovernor() called concurrently with the TypeScript kernel.
 * The Python backend (api/python/govern.py) computes CCP/IEC/ADV + a CBF QP
 * filter + FPL1 simulation. These are surfaced as *detail* metrics.
 *
 * COHERENCE (2026-06-30): the reported constitutional state is ONE vector — the
 * TypeScript kernel's governed state — and M and health_band are both derived
 * from THAT vector:
 *     C/R/S = state = result.state (TS kernel, CBF-guaranteed, has a real
 *             before→after trajectory via raw_state)
 *     M     = min(C, R, S)
 *     band  = healthBand(M)              (same thresholds as api/python _health_band)
 * Previously the response mixed sources: C/R/S came from Python, `state` from the
 * TS kernel (a different vector), M was max(min(python), tsM), and health_band
 * was derived from Python's min-CRS — so the band could say CRITICAL next to an
 * M of 0.30. The Python measurement is retained as `crs_detail` (labeled), not as
 * the authoritative state. `crs_source` reflects the state engine (always the TS
 * kernel now); `crs_detail.source` records whether Python detail was available.
 *
 * feat: response includes raw_state + m_before (pre-governance "before" state)
 *   alongside the governed state + M ("after"), matching the stream route.
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

/**
 * Health band from the stability margin M — the single, documented mapping.
 * Kept identical to api/python/govern.py `_health_band` so both engines agree.
 * Deriving the band from the reported M guarantees band ↔ M coherence.
 */
function healthBand(m: number): string {
  if (m >= 0.25) return 'OPTIMAL';
  if (m >= 0.15) return 'ALERT';
  if (m >= 0.08) return 'STRESSED';
  return 'CRITICAL';
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

  // ── Pre-governance ("before") state ───────────────────────────────────────
  // raw_state is the raw kernel measurement before the governor correction /
  // CBF projection that produced result.state ("after"). Captured here because
  // the self-referential block below may overwrite result.state/result.M.
  const rawState = result.receipt.raw_state;
  const mBefore  = Math.min(rawState.C, rawState.R, rawState.S);

  // ── Python CRS measurement (concurrent with self-referential) ────────────
  // Runs the CCP/IEC/ADV pipeline + CBF QP + FPL1. Retained as DETAIL only —
  // it is not the authoritative reported state (it has no before→after
  // trajectory and its ADV is calibrated separately). Non-fatal on failure.
  const [pythonResult] = await Promise.allSettled([
    callPythonGovernor(prompt, result.raw_output, result.governed_output),
  ]);
  const python = pythonResult.status === 'fulfilled' ? pythonResult.value : null;

  // Merge is retained for its detail fields (fpl1, ccp_lambda, iec_variance,
  // crs_method tag). It is NOT used for the reported C/R/S/M/band anymore.
  let mergedCRS = python ? mergePythonCRS(
    python,
    result.M,
    result.state.C, result.state.R, result.state.S,
  ) : null;

  // ── Self-referential CRS ──────────────────────────────────────────────────
  let projectionTriggered = result.receipt.safety_projection_triggered;
  let forcedCritical = false;

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
          projectionTriggered    = true;
          forcedCritical         = true; // refusal → CRITICAL regardless of M
          result.receipt.safety_projection_triggered = true;
          mergedCRS = null; // Python detail no longer relevant after refusal
        }
        result.M     = Math.min(kernel.state.C, kernel.state.R, kernel.state.S);
        result.state = { ...kernel.state };
      }
    } catch (e) {
      logger.error('govern.self_referential', 'self-referential CRS failed', errorFields(e));
    }
  }

  // ── Single authoritative reported state (TS kernel governed state) ────────
  // C/R/S, M, band all derive from THIS one vector — no cross-engine mixing.
  const reportedState = { C: result.state.C, R: result.state.R, S: result.state.S };
  const reportedM     = Math.min(reportedState.C, reportedState.R, reportedState.S);
  const reportedBand  = forcedCritical ? 'CRITICAL' : healthBand(reportedM);
  result.health_band  = reportedBand; // keep receipt/health band consistent

  // Python detail (labeled; not the authoritative state)
  const crsDetail = python ? {
    source:      'python-cbf',
    ccp:         python.ccp_detail.ccp,
    iec:         python.iec_detail.iec,
    adv:         python.adv_detail.adv,
    python_c:    python.c,
    python_r:    python.r,
    python_s:    python.s,
    python_m:    python.m,
    python_band: python.health_band,
    fpl1:        python.fpl1,
  } : null;

  // ── Persist receipt ───────────────────────────────────────────────────────
  // crs_method still records the Python detail measurement (ccp/iec/adv) when
  // available, for audit — it documents what the detail engine measured, while
  // the receipt's m_after/state reflect the authoritative TS kernel state.
  const [receiptId] = await Promise.all([
    writeKernelReceipt(session_id, turn, result, mergedCRS?.crs_method),
    incrementRuns(),
    promptEmbedding.length ? storeMemory({
      session_id, prompt,
      prompt_hash:            result.receipt.input_hash,
      embedding:              promptEmbedding,
      M:                      reportedM,
      C:                      reportedState.C,
      R:                      reportedState.R,
      S:                      reportedState.S,
      health_band:            reportedBand,
      state_label:            classifyStateLabel(projectionTriggered, result.governed_output),
      intervention:           projectionTriggered,
      governed_response_hash: result.receipt.output_hash,
    }) : Promise.resolve(),
  ]);

  return NextResponse.json({
    governed_output:       result.governed_output,
    raw_output:            result.raw_output,
    // ── Authoritative constitutional state ("after") — one coherent vector ──
    C:                     reportedState.C,
    R:                     reportedState.R,
    S:                     reportedState.S,
    M:                     reportedM,
    state:                 reportedState,
    health_band:           reportedBand,
    // Pre-governance ("before") state — raw kernel measurement
    raw_state:             { C: rawState.C, R: rawState.R, S: rawState.S },
    m_before:              mBefore,
    // State engine is always the TS kernel now; Python is detail (below).
    crs_source:            'typescript-kernel',
    crs_detail:            crsDetail,
    weakest_pillar:        mergedCRS?.weakest_pillar ?? null,
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
    governor: 'G(x,z) async sensing + Python CBF QP + FPL1 classification (detail)',
  });
}
