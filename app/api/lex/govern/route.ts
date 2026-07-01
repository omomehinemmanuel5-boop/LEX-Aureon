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
 * from THAT vector (M = min(C,R,S); band = healthBand(M)). Python CCP/IEC/ADV
 * are surfaced as labeled crs_detail, never as the reported state.
 *
 * DETECTION (2026-07-01): the paper (Aureonics v3, §4.3/§6.2) specifies
 * self-referential sovereignty — S_self = cosine(output_embedding,
 * constitutional_centroid) — as the early-warning signal for identity /
 * sovereignty drift. The refusal now triggers on the self-referential
 * sovereignty violation itself (S_self < threshold), independent of the keyword
 * Pre-Eval classifier (retained only as a secondary trigger). Both the raw
 * S_self cosine (sovereignty_raw) and the boolean (sovereignty_drift) are
 * surfaced so the threshold can be recalibrated against measured data rather
 * than guessed.
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
  const rawState = result.receipt.raw_state;
  const mBefore  = Math.min(rawState.C, rawState.R, rawState.S);

  // ── Python CRS measurement (detail only) ──────────────────────────────────
  const [pythonResult] = await Promise.allSettled([
    callPythonGovernor(prompt, result.raw_output, result.governed_output),
  ]);
  const python = pythonResult.status === 'fulfilled' ? pythonResult.value : null;

  let mergedCRS = python ? mergePythonCRS(
    python,
    result.M,
    result.state.C, result.state.R, result.state.S,
  ) : null;

  // ── Self-referential sovereignty — the paper's detection mechanism ────────
  let projectionTriggered = result.receipt.safety_projection_triggered;
  let forcedCritical = false;
  let sovereigntyDriftDetected = false;
  let sovereigntyRaw: number | null = null; // raw S_self cosine (for calibration)

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

        // Paper §4.3 / §6.2: S_self = cosine(output_embedding, constitutional
        // centroid). Trigger on the sovereignty violation itself, independent
        // of the keyword Pre-Eval classifier (kept only as a secondary trigger).
        sovereigntyRaw           = sr.selfCRS.sovereignty_raw;
        sovereigntyDriftDetected = sr.selfCRS.sovereignty_violated;
        const keywordAttack = result.semantic_signal.attack_type !== 'none'
                           && result.semantic_signal.severity >= 0.7;

        if (sovereigntyDriftDetected || keywordAttack) {
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
  const reportedState = { C: result.state.C, R: result.state.R, S: result.state.S };
  const reportedM     = Math.min(reportedState.C, reportedState.R, reportedState.S);
  const reportedBand  = forcedCritical ? 'CRITICAL' : healthBand(reportedM);
  result.health_band  = reportedBand;

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
    // Detection provenance
    crs_source:            'typescript-kernel',
    crs_detail:            crsDetail,
    sovereignty_drift:     sovereigntyDriftDetected, // S_self < threshold (paper §6.2)
    sovereignty_raw:       sovereigntyRaw,            // raw S_self cosine (calibration)
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
    governor: 'G(x,z) async sensing + self-referential sovereignty detection (paper §4.3/§6.2)',
  });
}
