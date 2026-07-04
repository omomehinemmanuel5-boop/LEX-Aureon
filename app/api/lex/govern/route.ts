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
 * sovereignty drift. The refusal triggers on the sovereignty violation itself
 * (S_self < threshold), independent of the keyword Pre-Eval classifier
 * (retained only as a secondary trigger). Both the raw cosine (sovereignty_raw)
 * and the boolean (sovereignty_drift) are surfaced for calibration.
 *
 * FAIL-LOUD (2026-07-01): the self-referential measurement depends on the
 * embedding backend. When embeddings (or the constitutional centroid) are
 * unavailable, the measurement cannot run — and previously it silently
 * defaulted to "no drift" while the API still reported a normal health band, so
 * a blind detector looked healthy. That is the most dangerous failure mode for
 * a safety layer. We now surface `detection_degraded: true` whenever S_self
 * could not be measured, and log it. The keyword classifier remains the only
 * (weak) active detector in that state. This does NOT auto-refuse (that would
 * make an embedding outage refuse all traffic) — it makes the degradation
 * visible instead of silent.
 *
 * CAPITULATION JUDGE (2026-07-01, measurement-only PROTOTYPE): the fair test
 * with working Gemini embeddings showed S_self does not separate capitulation
 * from benign output. An output-side LLM judge (lib/capitulation_judge.ts) runs
 * on the PRE-REFUSAL governed output, in parallel with the Python call, and is
 * surfaced as `capitulation_signal` for calibration. It does NOT trigger refusal.
 *
 * EVAL FAST-PATH (2026-07-03): synthetic benchmark traffic (tagged session ids —
 * see isEvalSession) skips the two measurement-only extras — the Python governor
 * DETAIL and the capitulation judge. Neither affects the reported governed
 * output, the CRS state (which comes from the TS kernel), or the refusal
 * decision, so skipping them does not change what the benchmark measures — it
 * just removes 1–2 network/LLM round-trips per prompt, which dominated per-call
 * latency and rate-limit backoff during heavy runs. Real user sessions
 * (session-<ms>) always get the full pipeline.
 *
 * MULTI-PROVIDER EMBEDDINGS, PINNED PER REQUEST (2026-07-04): embeddings now
 * have a real runtime fallback chain (Gemini → Mistral → Jina — see
 * lib/lex_memory.ts) instead of a single statically-selected provider, so a
 * live Gemini outage (e.g. the daily free-tier embed quota) no longer degrades
 * detection outright. But Reciprocity (cosine(input, output)) and Sovereignty
 * (cosine(output, constitutional centroid)) are only meaningful when every
 * vector in the comparison comes from the SAME embedding model. So: the prompt
 * embedding resolves a provider for this request via embedTextResolved(), and
 * that SAME provider is then FORCED (via embedTextWithProvider /
 * getConstitutionalCentroid(provider)) for the output embedding and the
 * constitutional centroid — no further fallback within the request. If the
 * pinned provider then fails for the output or centroid call, the request
 * honestly reports detection_degraded rather than silently comparing across
 * incompatible embedding spaces.
 *
 * feat: response includes raw_state + m_before (pre-governance "before" state)
 *   alongside the governed state + M ("after"), matching the stream route.
 */

import { NextResponse } from 'next/server';
import { getCachedKernel } from '@/lib/kernel_cache';
import { writeKernelReceipt, loadKernelState, loadKernelZ } from '@/lib/kernel_bridge';
import { incrementRuns } from '@/lib/db';
import {
  embedTextResolved, embedTextWithProvider, retrieveSimilar, buildMemoryContext,
  storeMemory, classifyStateLabel, ensureLexMemoryTable,
  getConstitutionalCentroid, getSessionCentroid,
  type EmbedProvider,
} from '@/lib/lex_memory';
import { CANONICAL_REFUSAL } from '@/lib/refusals';
import { MAX_PROMPT_CHARS } from '@/lib/schemas';
import { logger, errorFields } from '@/lib/logger';
import { callPythonGovernor, mergePythonCRS } from '@/lib/python_bridge';
import { judgeCapitulation } from '@/lib/capitulation_judge';

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

/**
 * Synthetic eval traffic (benchmark harnesses) is tagged with these session
 * prefixes. For those we skip the measurement-only extras (Python governor
 * detail + capitulation judge) — see the EVAL FAST-PATH note above. Real user
 * sessions (session-<ms>-<rand>) never match these and always get everything.
 */
function isEvalSession(sid: string): boolean {
  return /^(lexbench-|synthetic_|bench-|jbb_|adv_|hb_)/.test(sid);
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

  const evalSession = isEvalSession(session_id);

  // ── All async work runs concurrently ─────────────────────────────────────
  let promptEmbedding: number[] = [];
  // The provider that resolved for THIS request's prompt embedding — pinned
  // and reused for the output embedding + constitutional centroid so the
  // self-referential comparison always sits in one embedding space.
  let promptEmbedProvider: EmbedProvider | null = null;
  let memoryContext = '';
  const memoryPromise = (async () => {
    try {
      const resolved = await embedTextResolved(prompt);
      promptEmbedding      = resolved.vector;
      promptEmbedProvider  = resolved.provider;
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

  // ── Python CRS measurement (detail) + output-side capitulation judge ──────
  // Both run concurrently. On eval sessions both are skipped (fast-path) — they
  // are measurement-only and do not affect governed_output, the reported CRS
  // state, or the refusal decision, so the benchmark measures the same thing.
  const [pythonResult, capitulationResult] = await Promise.allSettled([
    evalSession
      ? Promise.resolve(null)
      : callPythonGovernor(prompt, result.raw_output, result.governed_output),
    evalSession
      ? Promise.resolve(null)
      : judgeCapitulation(prompt, result.governed_output),
  ]);
  const python = pythonResult.status === 'fulfilled' ? pythonResult.value : null;
  const capitulationSignal =
    capitulationResult.status === 'fulfilled' ? capitulationResult.value : null;

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
  let detectionDegraded = false;            // true when S_self could NOT be measured

  if (promptEmbedding.length && promptEmbedProvider) {
    try {
      // Pin the SAME provider that resolved for the prompt — no fallback here.
      // If this provider can't embed the output or the centroid right now, that
      // is an honest "degraded" state, not a reason to compare across spaces.
      const [outputEmb, constCentroid, sessCentroid] = await Promise.all([
        embedTextWithProvider(result.governed_output, promptEmbedProvider).catch(() => [] as number[]),
        getConstitutionalCentroid(promptEmbedProvider),
        getSessionCentroid(session_id),
      ]);
      if (outputEmb.length && constCentroid) {
        const sr = kernel.applySelfReferentialMeasurement(
          outputEmb, promptEmbedding, constCentroid, sessCentroid,
        );
        // Paper §4.3 / §6.2: S_self = cosine(output_embedding, constitutional centroid).
        sovereigntyRaw           = sr.selfCRS.sovereignty_raw;
        sovereigntyDriftDetected = sr.selfCRS.sovereignty_violated;
        result.M     = Math.min(kernel.state.C, kernel.state.R, kernel.state.S);
        result.state = { ...kernel.state };
      } else {
        // Output embedding or constitutional centroid unavailable under the
        // pinned provider → the self-referential sovereignty measurement
        // could not run this turn.
        detectionDegraded = true;
      }
    } catch (e) {
      detectionDegraded = true;
      logger.error('govern.self_referential', 'self-referential CRS failed', errorFields(e));
    }
  } else {
    // No prompt embedding → no resolved provider → semantic memory AND
    // self-referential detection both unavailable this turn (all configured
    // embedding providers failed).
    detectionDegraded = true;
  }

  // Refusal trigger: the self-referential sovereignty violation (paper's
  // mechanism) OR the keyword classifier. The keyword path does not need
  // embeddings, so it remains active even when detection is degraded.
  // NOTE: capitulation_signal is measurement-only and deliberately NOT a
  // trigger yet — see header. Enforcement requires validation first.
  const keywordAttack = result.semantic_signal.attack_type !== 'none'
                     && result.semantic_signal.severity >= 0.7;
  if (sovereigntyDriftDetected || keywordAttack) {
    result.governed_output = CANONICAL_REFUSAL;
    projectionTriggered    = true;
    forcedCritical         = true; // refusal → CRITICAL regardless of M
    result.receipt.safety_projection_triggered = true;
    mergedCRS = null;
  }

  // Calibration log: judge verdict vs the enforced triggers, every turn the
  // judge returned a verdict (skipped on eval fast-path).
  if (capitulationSignal) {
    logger.info('govern.capitulation_calibration', 'judge vs enforced triggers', {
      session_id, turn,
      judge_capitulated: capitulationSignal.capitulated,
      judge_category:    capitulationSignal.category,
      judge_confidence:  capitulationSignal.confidence,
      s_self:            sovereigntyRaw,
      sovereignty_drift: sovereigntyDriftDetected,
      keyword_attack:    keywordAttack,
      refused:           sovereigntyDriftDetected || keywordAttack,
    });
  }

  if (detectionDegraded) {
    // Fail LOUD: a blind detector must never read as "safe".
    logger.warn('govern.detection',
      'self-referential sovereignty unavailable (all embedding providers down, or pinned provider failed mid-request) — detection degraded; keyword classifier only',
      { session_id, turn, resolved_provider: promptEmbedProvider });
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
    detection_degraded:    detectionDegraded,         // true → S_self could not be measured
    embed_provider:        promptEmbedProvider,       // which provider served this request's embeddings
    // Output-side capitulation judge (measurement-only PROTOTYPE — not enforced;
    // null on eval fast-path or when the judge is unavailable, which must never
    // be read as "no capitulation")
    capitulation_signal:   capitulationSignal,
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
    governor: 'G(x,z) async sensing + self-referential sovereignty detection (paper §4.3/§6.2) + capitulation judge (measurement-only)',
  });
}
