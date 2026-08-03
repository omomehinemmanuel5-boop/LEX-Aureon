/**
 * lib/governance_service.ts
 *
 * featur (2026-08-03) — EXTRACTED GOVERNANCE SERVICE. Previously the entire
 * governance pipeline (embedding, memory, threat scoring, kernel run, self-
 * referential measurement, refusal decision, output shaping, calibration,
 * persistence) lived inline in app/api/lex/govern/route.ts (399 lines). This
 * module extracts all business logic into a single testable function, leaving
 * the route to handle HTTP parsing and response formatting only.
 *
 * The route's behavior is unchanged — this is a pure extraction with no
 * semantic modifications. Every input/output field matches the previous
 * inline implementation exactly.
 */

import { getCachedKernel } from './kernel_cache';
import { writeKernelReceipt, loadKernelState, loadKernelZ } from './kernel_bridge';
import { incrementRuns } from './db';
import {
  embedTextResolved, embedTextWithProvider, retrieveSimilar, buildMemoryContext,
  retrieveSessionHistory, buildSessionContext,
  storeMemory, classifyStateLabel,
  getConstitutionalCentroid, getSessionCentroid,
  getHarmReferenceCentroid, getBenignReferenceCentroid, cosineSimilarity,
  type EmbedProvider,
} from './lex_memory';
import { CANONICAL_REFUSAL } from './refusals';
import { logger, errorFields } from './logger';
import { governorState } from './aureonics_math';
import { judgeCapitulation } from './capitulation_judge';
import { decideRefusal, type RefusalDecision } from './refusal_decision';
import { healthBand } from './health_band';
import { persistCapitulationCalibration } from './capitulation_calibration';
import type { IdentityMode } from './sovereign_kernel';
import { CelesteAgent } from './agents/celeste';
import { StyleAgent } from './agents/style_agent';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GovernRequest {
  prompt:         string;
  session_id:     string;
  turn:           number;
  identity_mode:  IdentityMode;
}

export interface GovernResponse {
  governed_output:          string;
  raw_output:               string;
  C:                        number;
  R:                        number;
  S:                        number;
  M:                        number;
  state:                    { C: number; R: number; S: number };
  health_band:              string;
  raw_state:                { C: number; R: number; S: number };
  m_before:                 number;
  crs_source:               string;
  governed_source:          string | null;
  raw_provider:             string | null;
  governed_provider:        string | null;
  weakest_pillar:           string;
  governance_pressure:      string;
  constitutional_band:      string;
  corrections:              number;
  intervention_triggered:   boolean;
  sovereignty_drift:        boolean;
  sovereignty_raw:          number | null;
  detection_degraded:       boolean;
  embed_provider:           EmbedProvider | null;
  prompt_threat_signal:     number;
  identity_mode:            IdentityMode;
  refused:                  boolean;
  refusal_reasons:          string[];
  primary_refusal_reason:   string | null;
  capitulation_signal:      ReturnType<typeof null | { capitulated: boolean; category: string; confidence: number; reason: string; judge_model: string }> | null;
  temperature:              number;
  theta:                    number;
  effective_theta:          number;
  attack_pressure:          number;
  adv_gain:                 number;
  semantic_signal:          { type: string; severity: number };
  lyapunov_V:               number;
  delta_V:                  number;
  stability_ratio:          number;
  suspension_triggered:     boolean;
  epsilon_injected:         boolean;
  projection_triggered:     boolean;
  projection_magnitude:     number;
  z_weights:                [number, number, number];
  receipt_id:               string | null;
  receipt_persisted:        boolean;
  memory_injected:          boolean;
  invariance_violations:    number;
  metrics:                  Record<string, number> | null;
  governor_sensing:         Record<string, unknown> | null;
  version:                  string;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/**
 * Synthetic eval traffic (benchmark harnesses) is tagged with these session
 * prefixes. For those we skip the measurement-only capitulation judge.
 */
export function isEvalSession(sid: string): boolean {
  return /^(lexbench-|synthetic_|bench-|jbb_|adv_|hb_)/.test(sid);
}

// ── Core Governance Service ────────────────────────────────────────────────────

/**
 * Execute the full governance pipeline for a single turn.
 * Returns a complete GovernResponse ready for JSON serialization.
 *
 * This function replaces the inline logic that previously lived in
 * app/api/lex/govern/route.ts. The pipeline is:
 *
 *   1. Embed prompt + load session memory (concurrent)
 *   2. Compute input-side threat signal
 *   3. Run kernel cycle
 *   4. Output-side capitulation judge (measurement-only)
 *   5. Self-referential sovereignty measurement
 *   6. Refusal decision (unified from all signals)
 *   7. Output canonicalisation (Celeste + Style agents)
 *   8. Calibration persistence
 *   9. Receipt + memory persistence
 *   10. Assemble response
 */
export async function executeGovern(
  req: GovernRequest,
): Promise<GovernResponse> {
  const { prompt, session_id, turn, identity_mode: identityMode } = req;
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
      const [sessionTurns, memories] = await Promise.all([
        retrieveSessionHistory(session_id, 6),
        retrieveSimilar(promptEmbedding, 5),
      ]);
      memoryContext = [buildSessionContext(sessionTurns), buildMemoryContext(memories)]
        .filter(Boolean)
        .join('\n\n');
    } catch (e) {
      logger.warn('govern.memory', 'embed/retrieve failed', errorFields(e));
    }
  })();

  const [savedState, sessionZ] = await Promise.all([
    loadKernelState(session_id),
    loadKernelZ(session_id),
    memoryPromise,
  ]);

  // ── Input-side threat signal ──────────────────────────────────────────────
  let threatSignal = 0;
  if (promptEmbedding.length && promptEmbedProvider) {
    try {
      const [harmCentroid, benignCentroid] = await Promise.all([
        getHarmReferenceCentroid(promptEmbedProvider),
        getBenignReferenceCentroid(promptEmbedProvider),
      ]);
      if (harmCentroid) {
        const harmSim   = cosineSimilarity(promptEmbedding, harmCentroid);
        const benignSim = benignCentroid ? cosineSimilarity(promptEmbedding, benignCentroid) : 0;
        threatSignal = Math.max(0, Math.min(1, harmSim - benignSim));
      }
    } catch (e) {
      logger.warn('govern.threat_signal', 'harm/benign reference centroid unavailable', errorFields(e));
    }
  }

  // ── TypeScript kernel cycle ───────────────────────────────────────────────
  const kernel = getCachedKernel(session_id, savedState);
  const result = await kernel.runCycle(prompt, memoryContext, session_id, sessionZ, threatSignal, identityMode);

  if (result.status === 'Error') {
    throw new Error(`Governance kernel error: ${result.error}`);
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

  // ── Self-referential sovereignty ──────────────────────────────────────────
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

  // ── Single-source refusal decision ────────────────────────────────────────
  const decision: RefusalDecision = decideRefusal({
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

  // ── Output canonicalisation ───────────────────────────────────────────────
  try {
    const celeste = await CelesteAgent(result.governed_output, '', 'api');
    if (celeste?.rendered_output && celeste.rendered_output !== result.governed_output) {
      result.governed_output = celeste.rendered_output;
    }
  } catch (e) {
    logger.error('govern.celeste', 'CelesteAgent failed; leaving output unshaped', errorFields(e));
  }

  try {
    const styleResult = await StyleAgent({ prompt, session_id, governed_output: result.governed_output });
    if (styleResult?.success && styleResult.output) {
      result.governed_output = styleResult.output;
    }
  } catch (e) {
    logger.error('govern.style_agent', 'StyleAgent failed; leaving output unstyled', errorFields(e));
  }

  // Boundary guarantee
  if (decision.refused) result.governed_output = CANONICAL_REFUSAL;

  // ── Calibration persistence ───────────────────────────────────────────────
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
    logger.warn('govern.detection',
      'self-referential sovereignty unavailable (embedding provider down, or pinned provider failed mid-request) — detection degraded; keyword classifier only',
      { session_id, turn, resolved_provider: promptEmbedProvider });
  }

  // ── Single authoritative reported state ───────────────────────────────────
  const reportedState = { C: result.state.C, R: result.state.R, S: result.state.S };
  const reportedM     = Math.min(reportedState.C, reportedState.R, reportedState.S);
  const reportedBand  = decision.forced_critical ? 'CRITICAL' : healthBand(reportedM);
  result.health_band  = reportedBand;

  const govDetail = governorState(reportedState.C, reportedState.R, reportedState.S);

  // ── Persist receipt ───────────────────────────────────────────────────────
  const [receiptId] = await Promise.all([
    writeKernelReceipt(session_id, turn, result),
    incrementRuns(),
    promptEmbedding.length ? storeMemory({
      session_id, prompt,
      prompt_hash:            result.receipt.input_hash,
      embedding:              promptEmbedding,
      embedding_provider:     promptEmbedProvider,
      M:                      reportedM,
      C:                      reportedState.C,
      R:                      reportedState.R,
      S:                      reportedState.S,
      health_band:            reportedBand,
      state_label:            classifyStateLabel(projectionTriggered, result.governed_output),
      intervention:           projectionTriggered,
      governed_response_hash: result.receipt.output_hash,
      governed_response:      result.governed_output,
    }) : Promise.resolve(),
  ]);

  // ── Assemble response ─────────────────────────────────────────────────────
  return {
    governed_output:          result.governed_output,
    raw_output:               result.raw_output,
    C:                        reportedState.C,
    R:                        reportedState.R,
    S:                        reportedState.S,
    M:                        reportedM,
    state:                    reportedState,
    health_band:              reportedBand,
    raw_state:                { C: rawState.C, R: rawState.R, S: rawState.S },
    m_before:                 mBefore,
    crs_source:               'typescript-kernel',
    governed_source:          result.governed_source ?? null,
    raw_provider:             result.raw_provider ?? null,
    governed_provider:        result.governed_provider ?? null,
    weakest_pillar:           govDetail.weakest_pillar,
    governance_pressure:      govDetail.governance_pressure,
    constitutional_band:      govDetail.constitutional_band,
    corrections:              govDetail.corrections,
    intervention_triggered:   govDetail.active,
    sovereignty_drift:        sovereigntyDriftDetected,
    sovereignty_raw:          sovereigntyRaw,
    detection_degraded:       detectionDegraded,
    embed_provider:           promptEmbedProvider,
    prompt_threat_signal:     threatSignal,
    identity_mode:            identityMode,
    refused:                  decision.refused,
    refusal_reasons:          decision.reasons,
    primary_refusal_reason:   decision.primary,
    capitulation_signal:      capitulationSignal,
    temperature:              result.temperature,
    theta:                    result.theta,
    effective_theta:          result.effective_theta,
    attack_pressure:          result.attack_pressure,
    adv_gain:                 result.adv_gain,
    semantic_signal:          result.semantic_signal,
    lyapunov_V:               result.lyapunov_V,
    delta_V:                  result.delta_V,
    stability_ratio:          result.stability_ratio,
    suspension_triggered:     result.suspension_triggered,
    epsilon_injected:         result.epsilon_injected,
    projection_triggered:     projectionTriggered,
    projection_magnitude:     result.projection_magnitude,
    z_weights:                result.receipt.z_weights,
    receipt_id:               receiptId || null,
    receipt_persisted:        !!receiptId,
    memory_injected:          memoryContext.length > 0,
    invariance_violations:    result.invariance_violations,
    metrics:                  result.metrics ?? null,
    governor_sensing:         result.governor_sensing,
    version:                  result.receipt.version ?? 'SovereignKernel-TS-v2+AsyncGovernor',
  };
}
