/**
 * POST /api/lex/govern
 * SovereignKernel governance cycle — F(x,z) sync + G(x,z) async governor.
 *
 * wire: loadKernelZ() threads session-adaptive z into runCycle().
 *
 * ARCHITECTURAL UNIFICATION (2026-07-07):
 *
 *   Move C — one-engine constitutional measurement. The Python detail engine
 *   (bag-of-words TF cosine masquerading as CCP/IEC/ADV; retired for the same
 *   reason we retired `toxicity`/`truth_score`) is no longer called from the
 *   live path. `weakest_pillar` / `governance_pressure` / `corrections` are
 *   computed from the TS-native governorState() on the SAME reported CRS —
 *   coherent with C/R/S/M by construction, no possibility of two engines
 *   drifting. The one Python-unique capability (`simulate_cbf` + FPL1
 *   classification) was ported to lib/cbf_simulation.ts; it's a system-
 *   property proof, not per-turn measurement, so it runs offline.
 *
 *   Move A — the refusal rule is now a single pure function
 *   (lib/refusal_decision.ts) that composes every enforcement signal + every
 *   measurement-only signal into ONE decision object. Previously refusal was
 *   an inline `sovereignty_drift || keyword_attack` expression with two other
 *   signals wired in as status flags or logged for calibration but not
 *   actually contributing. Now: single call, single audit surface, one place
 *   to change if the policy changes.
 *
 *   Move D — healthBand is imported from lib/health_band.ts, the sole source
 *   of the τ_stretch=0.25 / τ_soft=0.15 / τ_hard=0.08 thresholds. The
 *   offline Python simulator (api/python/govern.py `_health_band`) mirrors
 *   the thresholds by hand — a comment there names lib/health_band.ts as the
 *   source, so future edits touch one file first.
 *
 *   Move B — DB persistence for the capitulation-judge calibration signal
 *   (lib/capitulation_calibration.ts). The judge stays measurement-only (it
 *   does NOT trigger refusal — see decideRefusal), but every firing on a
 *   real user turn now writes a paired row (judge verdict + enforced
 *   decision + S_self) to capitulation_calibration. Move B moves to a
 *   real decision when the table has enough rows to answer the questions
 *   in the module's decision-analysis SQL block — see that file for the
 *   exact queries.
 *
 * COHERENCE (2026-06-30, preserved): the reported constitutional state is
 * ONE vector — the TypeScript kernel's governed state — and M and health
 * band are both derived from THAT vector.
 *
 * DETECTION (2026-07-01, preserved): the paper (§4.3/§6.2) specifies
 * self-referential sovereignty — S_self = cosine(output_embedding,
 * constitutional_centroid) — as the early-warning signal for identity /
 * sovereignty drift. Both the raw cosine and the boolean are surfaced.
 *
 * FAIL-LOUD (2026-07-01, preserved): when embeddings (or the centroid) are
 * unavailable, `detection_degraded: true` is surfaced and logged. The
 * keyword classifier remains active in that state (embedding-independent).
 *
 * EVAL FAST-PATH (2026-07-03, preserved): synthetic benchmark traffic
 * (isEvalSession) skips the capitulation judge — one fewer network round
 * trip per prompt during heavy runs. Does not affect what benchmarks
 * measure (the judge is measurement-only).
 *
 * MULTI-PROVIDER EMBEDDINGS, PINNED PER REQUEST (2026-07-04, preserved).
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
import { governorState } from '@/lib/aureonics_math';
import { judgeCapitulation } from '@/lib/capitulation_judge';
import { decideRefusal } from '@/lib/refusal_decision';
import { healthBand } from '@/lib/health_band';
import { persistCapitulationCalibration } from '@/lib/capitulation_calibration';

let _dbReady = false;
async function ensureDB() {
  if (_dbReady) return;
  await ensureLexMemoryTable();
  _dbReady = true;
}

/**
 * Synthetic eval traffic (benchmark harnesses) is tagged with these session
 * prefixes. For those we skip the measurement-only capitulation judge.
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

  // ── Output-side capitulation judge (measurement-only PROTOTYPE) ───────────
  const capitulationResult = await Promise.allSettled([
    evalSession
      ? Promise.resolve(null)
      : judgeCapitulation(prompt, result.governed_output),
  ]);
  const capitulationSignal =
    capitulationResult[0].status === 'fulfilled' ? capitulationResult[0].value : null;

  // ── Self-referential sovereignty — the paper's §4.3/§6.2 mechanism ────────
  let sovereigntyDriftDetected = false;
  let sovereigntyRaw: number | null = null;
  let detectionDegraded = false;

  if (promptEmbedding.length && promptEmbedProvider) {
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
        sovereigntyRaw           = sr.selfCRS.sovereignty_raw;
        sovereigntyDriftDetected = sr.selfCRS.sovereignty_violated;
        result.M     = Math.min(kernel.state.C, kernel.state.R, kernel.state.S);
        result.state = { ...kernel.state };
      } else {
        detectionDegraded = true;
      }
    } catch (e) {
      detectionDegraded = true;
      logger.error('govern.self_referential', 'self-referential CRS failed', errorFields(e));
    }
  } else {
    detectionDegraded = true;
  }

  // ── Single-source refusal decision (Move A) ───────────────────────────────
  const decision = decideRefusal({
    sovereignty: {
      drift_detected:     sovereigntyDriftDetected,
      raw_sself:          sovereigntyRaw,
      detection_degraded: detectionDegraded,
    },
    semantic:      result.semantic_signal,
    capitulation:  capitulationSignal,
    safety_projection_triggered: result.receipt.safety_projection_triggered,
  });

  let projectionTriggered = decision.safety_projection_triggered;
  if (decision.refused) {
    result.governed_output = CANONICAL_REFUSAL;
    projectionTriggered    = true;
    result.receipt.safety_projection_triggered = true;
  }

  // Calibration: (a) durable DB row for accumulation-then-decide analysis
  // (Move B), (b) runtime log for quick visibility. Both fire only when the
  // judge returned a verdict, i.e. on real user turns (eval fast-path skips
  // the judge entirely). Both are best-effort — no user-facing effect.
  if (capitulationSignal) {
    void persistCapitulationCalibration({
      session_id, turn,
      judge_capitulated: capitulationSignal.capitulated,
      judge_category:    capitulationSignal.category,
      judge_confidence:  capitulationSignal.confidence,
      judge_reason:      capitulationSignal.reason,
      judge_model:       capitulationSignal.judge_model,
      s_self:            sovereigntyRaw,
      refused:           decision.refused,
      primary_reason:    decision.primary,
      reasons:           JSON.stringify(decision.reasons),
    });
    logger.info('govern.capitulation_calibration', 'judge vs enforced decision', {
      session_id, turn,
      judge_capitulated: capitulationSignal.capitulated,
      judge_category:    capitulationSignal.category,
      judge_confidence:  capitulationSignal.confidence,
      s_self:            sovereigntyRaw,
      refused:           decision.refused,
      primary_reason:    decision.primary,
      all_reasons:       decision.reasons,
    });
  }

  if (detectionDegraded) {
    // Fail LOUD: a blind detector must never read as "safe".
    logger.warn('govern.detection',
      'self-referential sovereignty unavailable (embedding provider down, or pinned provider failed mid-request) — detection degraded; keyword classifier only',
      { session_id, turn, resolved_provider: promptEmbedProvider });
  }

  // ── Single authoritative reported state (TS kernel governed state) ────────
  const reportedState = { C: result.state.C, R: result.state.R, S: result.state.S };
  const reportedM     = Math.min(reportedState.C, reportedState.R, reportedState.S);
  const reportedBand  = decision.forced_critical ? 'CRITICAL' : healthBand(reportedM);
  result.health_band  = reportedBand;

  // TS-native governor detail — computed from the SAME reported state, so
  // these detail fields are coherent with the reported C/R/S/M by construction
  // (Move C: no separate Python engine, one state, one governor readout).
  const govDetail = governorState(reportedState.C, reportedState.R, reportedState.S);

  // ── Persist receipt ───────────────────────────────────────────────────────
  const [receiptId] = await Promise.all([
    writeKernelReceipt(session_id, turn, result),
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
    // Governor readout derived from the SAME reported state
    weakest_pillar:        govDetail.weakest_pillar,
    governance_pressure:   govDetail.governance_pressure,
    constitutional_band:   govDetail.constitutional_band,
    corrections:           govDetail.corrections,
    intervention_triggered: govDetail.active,
    // Sovereignty (§4.3/§6.2)
    sovereignty_drift:     sovereigntyDriftDetected,
    sovereignty_raw:       sovereigntyRaw,
    detection_degraded:    detectionDegraded,
    embed_provider:        promptEmbedProvider,
    // Refusal decision (Move A) — full evidence trail for the receipt
    refused:               decision.refused,
    refusal_reasons:       decision.reasons,
    primary_refusal_reason: decision.primary,
    // Output-side capitulation judge (measurement-only PROTOTYPE)
    capitulation_signal:   capitulationSignal,
    // TypeScript kernel values
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
    version:  'v2+AsyncGovernor+SingleEngine+UnifiedRefusal+CalibrationDB',
    endpoint: '/api/lex/govern',
    governor: 'G(x,z) async sensing + self-referential sovereignty detection (paper §4.3/§6.2) + capitulation judge (measurement-only, DB-persisted for Move B accumulate-then-decide). Single-engine constitutional measurement (Move C, 2026-07-07); refusal decision unified in lib/refusal_decision.ts (Move A); healthBand single-sourced in lib/health_band.ts (Move D); calibration accumulation in lib/capitulation_calibration.ts (Move B).',
  });
}
