/**
 * POST /api/lex/govern
 * Canonical non-streamed governance endpoint.
 *
 * Live contract: validate input, load session state + session-adaptive z, build
 * memory/threat context, run SovereignKernel, persist the receipt/calibration
 * signals, and return one coherent CRS vector.
 *
 * Keep executable route comments concise; place long historical rationale in
 * docs/architecture/govern-route-history.md.
 */

import { publicError } from '@/lib/safe_error';
import { NextResponse } from 'next/server';
import { getCachedKernel } from '@/lib/kernel_cache';
import { writeKernelReceipt, loadKernelState, loadKernelZ } from '@/lib/kernel_bridge';
import { incrementRuns } from '@/lib/db';
import {
  embedTextResolved, embedTextWithProvider, retrieveSimilar, buildMemoryContext,
  storeMemory, classifyStateLabel, ensureLexMemoryTable,
  getConstitutionalCentroid, getSessionCentroid,
  getHarmReferenceCentroid, getBenignReferenceCentroid, cosineSimilarity,
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
import type { IdentityMode } from '@/lib/sovereign_kernel';
// fix (2026-07-26): output-shaping agents, previously present ONLY in the
// streaming route. See the canonicalisation block below for why.
import { CelesteAgent } from '@/lib/agents/celeste';
import { StyleAgent }   from '@/lib/agents/style_agent';

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

const VALID_IDENTITY_MODES: IdentityMode[] = ['full', 'minimal', 'dynamic', 'none'];
function resolveIdentityMode(raw: unknown): IdentityMode {
  return typeof raw === 'string' && (VALID_IDENTITY_MODES as string[]).includes(raw)
    ? raw as IdentityMode
    : 'full';
}

export async function POST(req: Request) {
  let body: { prompt?: string; session_id?: string; turn?: number; identity_mode?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { prompt, session_id, turn = 1 } = body;
  if (!prompt?.trim())     return NextResponse.json({ error: 'prompt required' },     { status: 400 });
  if (!session_id?.trim()) return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  if (prompt.length > MAX_PROMPT_CHARS) return NextResponse.json({ error: `prompt too long (max ${MAX_PROMPT_CHARS} chars)` }, { status: 400 });

  const identityMode = resolveIdentityMode(body.identity_mode);

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

  // ── Input-side threat signal (2026-07-12, contrastive fix 2026-07-18) ─────
  // See file header. Reuses the prompt embedding already resolved above (no
  // second embed call). Both centroids pinned to the SAME provider that
  // resolved the prompt embedding — mixing embedding spaces would produce a
  // meaningless cosine value (see this file's long-standing CORRECTNESS
  // CONSTRAINT, mirrored from lib/lex_memory.ts). threatSignal is
  // harm-similarity MINUS benign-similarity, clamped to [0,1]; falls back to
  // the pre-fix absolute harm-similarity if the benign centroid is
  // unavailable this turn (degraded, not blocked). Defaults to 0 when the
  // embedding or the harm centroid itself is unavailable — same honest-
  // default convention as detection_degraded elsewhere in this route.
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
    return NextResponse.json({ error: publicError('govern.kernel', result.error) }, { status: 500 });
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
    // Provider-exhaustion provenance (2026-07-08) — see lib/sovereign_kernel.ts
    // header. governed_source: 'governed' | 'raw_fallback' | 'unavailable'.
    // Benchmark runners should exclude 'unavailable' turns from scoring —
    // no real content was produced on either arm, so it is neither a genuine
    // refusal nor a genuine over-refusal.
    governed_source:       result.governed_source ?? null,
    raw_provider:          result.raw_provider ?? null,
    governed_provider:     result.governed_provider ?? null,
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
    // Input-side threat signal (2026-07-12, contrastive fix 2026-07-18) — see
    // file header. NOT statistically validated at scale; surfaced for audit
    // alongside sovereignty_raw.
    prompt_threat_signal:  threatSignal,
    // Identity mode (2026-07-18) — which self-knowledge block was actually
    // used this turn. See file header.
    identity_mode:         identityMode,
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
    receipt_id:            receiptId || null,
    // False when the audit receipt could not be persisted (e.g. DB quota
    // exhaustion) — the response is then NOT audit-backed. See kernel_bridge.
    receipt_persisted:     !!receiptId,
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
    version:  'v2+AsyncGovernor+SingleEngine+UnifiedRefusal+CalibrationDB+ThreatSignal+IdentityMode',
    endpoint: '/api/lex/govern',
    governor: 'G(x,z) async sensing + self-referential sovereignty detection (paper §4.3/§6.2) + input-side threat signal (2026-07-12, held-out harm reference centroid, contrastive recalibration 2026-07-18) + capitulation judge (measurement-only, DB-persisted for Move B accumulate-then-decide). Single-engine constitutional measurement (Move C, 2026-07-07); refusal decision unified in lib/refusal_decision.ts (Move A); healthBand single-sourced in lib/health_band.ts (Move D); calibration accumulation in lib/capitulation_calibration.ts (Move B); optional identity_mode override (2026-07-18: full/minimal/dynamic/none) for governed-arm self-knowledge A/B/C/D testing.',
  });
}
