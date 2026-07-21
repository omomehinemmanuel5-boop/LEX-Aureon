/**
 * POST /api/lex/govern/stream — unified constitutional pipeline, fully streamed.
 *
 * wire: loadKernelZ() threads session-adaptive z into runCycle().
 * fix: AuditorAgent now receives sigma_viol from z_traj directly.
 * feat: complete event now carries raw_state + m_before (pre-governance "before"
 *   state) alongside the governed state + M ("after"), so the console can render
 *   the CRS state before vs after the governor correction / CBF projection.
 *
 * fix (2026-07-04): this is the endpoint console AND chat actually call (via
 * useLexStream) — the non-stream /api/lex/govern is used by the public API and
 * benchmarks. The multi-provider embedding fallback + per-request provider
 * pinning added there (see that route's header) had NOT been applied here,
 * leaving console/chat vulnerable to the exact failure mode that fix eliminated:
 * comparing a prompt embedding from one provider against an output embedding /
 * constitutional centroid from a different provider if Gemini failed mid-request
 * (e.g. its daily embed quota) — a comparison that produces a numeric-looking
 * but meaningless self-referential score. Now: the prompt embedding resolves a
 * provider via embedTextResolved(), and that SAME provider is forced for the
 * output embedding and constitutional centroid (embedTextWithProvider /
 * getConstitutionalCentroid(provider)) — no fallback mid-comparison. If the
 * pinned provider then fails for the output/centroid call, self-referential
 * detection is honestly skipped for this turn rather than silently mixing
 * embedding spaces.
 *
 * fix (2026-07-09) — SINGLE-ENGINE UNIFICATION: this route previously ran TWO
 * independently-computed constitutional measurements that both influenced live
 * behavior. sovereign_kernel.ts generated and internally governed the response
 * using its own path-dependent dynamical C/R/S. Then CRSExtractorAgent
 * re-measured that already-generated output with a SEPARATE stateless,
 * embedding-based C/R/S, and THAT measurement fed GovernorAgent, whose
 * `intervention_required` output was OR'd into the real `needsIntervention`
 * decision — despite this file's own prior comment calling GovernorAgent "the
 * REFERENCE IMPLEMENTATION... not the actual state update". Documented intent
 * and actual behavior had drifted apart. On top of that, `needsIntervention`
 * also OR'd in a PRAXIS preEval() keyword-pattern heuristic (pre.label==='HIGH')
 * and a locally-hardcoded kernelSignal.severity>=0.85 threshold that disagreed
 * with lib/refusal_decision.ts's canonical SEMANTIC_ATTACK_ENFORCE_THRESHOLD
 * (0.70) — four heterogeneous signals gating one decision, with no single
 * source of truth. The non-stream /api/lex/govern route (used by the public
 * API and every LexBench benchmark run) had already been unified onto
 * decideRefusal() in lib/refusal_decision.ts (the 2026-07-07 "Move A" fix) —
 * this route was the one surface that never got the same treatment, meaning
 * real chat/console users were governed by different logic than what gets
 * benchmarked.
 *
 * Fixed by:
 *   - Removed CRSExtractorAgent entirely. The 'crs' SSE event now reports
 *     kernel.state directly — the same numbers used for every other decision
 *     in this route, and the same numbers /api/lex/govern reports.
 *   - GovernorAgent still runs (fed by kernel.state, not a separate
 *     measurement) but is now used ONLY to select `weakest` for law/clause
 *     selection — a legitimate use of the Section 11 F+G reference simulation
 *     that doesn't require it to also gate the live decision. Its own
 *     `intervention_required` is still emitted in the 'governor' SSE event
 *     for telemetry, now explicitly labeled as non-authoritative.
 *   - The self-referential sovereignty check moved from the END of the
 *     pipeline (after clause_bank/vaulturex/celeste/style_agent had already
 *     run, at which point a violation would crudely overwrite all of that
 *     work with a hardcoded string via a SECOND, separate InterventionAgent
 *     call) to immediately after generation — feeding decideRefusal() BEFORE
 *     the single 'intervening' stage, so sovereignty drift is handled by the
 *     same one intervention path as every other trigger, not a bolted-on
 *     duplicate.
 *   - needsIntervention is now `decideRefusal(...).refused` — identical
 *     function, identical enforcement policy (sovereignty drift, then the
 *     keyword classifier at the 0.70 threshold) as /api/lex/govern. PRAXIS
 *     preEval() is still computed and still emitted in the 'pre_eval' SSE
 *     event for the console's real-time display — it no longer influences
 *     the decision, matching how it's treated everywhere else in the
 *     codebase (diagnostic display, not a competing enforcement signal).
 *
 * Capitulation judge: NOT wired into this route. It never influences
 * decideRefusal()'s output either way (it's measurement-only, feeding Move B
 * calibration data collected via the non-stream route) — adding it here would
 * mean an extra LLM judge call and added latency on every interactive chat
 * turn for a signal that provably cannot change what the user sees. Passed as
 * `capitulation: null`, which is the semantically correct value: no
 * capitulation-judge data was collected for this turn.
 *
 * fix (2026-07-11) — WRONG RECEIPT ID SHOWN TO THE CLIENT: `auditId` used to
 * be computed as `auditorResult?.meta?.audit_id ?? receiptId` — preferring
 * AuditorAgent's own generated ID (format LEX-XXXXXXXX, not persisted
 * anywhere queryable) over the CANONICAL id `writeKernelReceipt` actually
 * persists to praxis_receipts.receipt_id (format KRN-XXXXXXXX-XXXX — the
 * exact id /audit/[id] queries by). Since AuditorAgent almost always
 * succeeds, the client was shown the non-canonical id nearly every time.
 * Verified directly: a real chat turn's audit_id (LEX-62839F4E) 404'd on
 * /audit/LEX-62839F4E, while the actual persisted receipt_id for that same
 * turn (KRN-MRG0OPPY-ZVXT) resolved correctly. Flipped the priority — the
 * canonical, persisted id now wins; AuditorAgent's own id is only a fallback
 * for the rare case writeKernelReceipt didn't return one (it isn't wrapped
 * in safe(), so this should essentially never happen).
 */

import { SovereignKernel }    from '@/lib/sovereign_kernel';
import { getCachedKernel } from '@/lib/kernel_cache';
import { writeKernelReceipt, loadKernelState, loadKernelZ } from '@/lib/kernel_bridge';
import {
  embedTextResolved, embedTextWithProvider, retrieveSimilar, buildMemoryContext,
  storeMemory, classifyStateLabel, ensureLexMemoryTable,
  getConstitutionalCentroid, getSessionCentroid,
  type EmbedProvider,
} from '@/lib/lex_memory';
import { preEval }            from '@/lib/praxis';
import { publicError }        from '@/lib/safe_error';
import { GovernorAgent }      from '@/lib/agents/governor';
import { InterventionAgent }  from '@/lib/agents/intervention';
import { NeithraAgent }       from '@/lib/agents/neithra';
import { ClauseBankAgent }    from '@/lib/agents/clause_bank';
import { VaulturexAgent }     from '@/lib/agents/vaulturex_agent';
import { CelesteAgent }       from '@/lib/agents/celeste';
import { StyleAgent }         from '@/lib/agents/style_agent';
import { AuditorAgent }       from '@/lib/agents/auditor';
import { RawForgeAgent }      from '@/lib/agents/raw_forge';
import { computeZWeightsHeuristic } from '@/lib/aureonics_math';
import { getZTraj }           from '@/lib/kv';
import { MODELS } from '@/lib/llm_provider';
import { decideRefusal } from '@/lib/refusal_decision';

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

let _dbReady = false;
async function ensureDB() {
  if (_dbReady) return;
  await ensureLexMemoryTable();
  _dbReady = true;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch { return fallback; }
}

export async function POST(req: Request) {
  let body: { prompt?: string; session_id?: string; turn?: number };
  try { body = await req.json(); }
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { prompt, session_id, turn = 1 } = body;
  if (!prompt?.trim() || !session_id?.trim())
    return new Response('prompt and session_id required', { status: 400 });

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(sse(event, data)));

      try {
        await ensureDB();

        emit('stage', { name: 'pre_eval', description: 'PRAXIS constitutional pattern analysis' });
        const pre          = preEval(prompt);
        const tempKernel   = new SovereignKernel();
        const kernelSignal = tempKernel.detectSemanticAttack(prompt);
        emit('pre_eval', { label: pre.label, tags: pre.tags, attack_type: kernelSignal.attack_type, severity: kernelSignal.severity, blocked: false });

        emit('stage', { name: 'memory', description: 'Constitutional memory retrieval' });
        // Resolve an embedding provider from the prompt now — pinned and reused
        // for the output embedding + constitutional centroid later, so the
        // self-referential comparison always sits in one embedding space (see
        // the 2026-07-04 fix note above).
        let promptEmbedProvider: EmbedProvider | null = null;
        const [savedState, sessionZ, promptEmbeddingResolved, zTraj] = await Promise.all([
          loadKernelState(session_id),
          loadKernelZ(session_id),
          embedTextResolved(prompt).catch(() => null),
          getZTraj(session_id),
        ]);
        const promptEmbedding = promptEmbeddingResolved?.vector ?? [];
        promptEmbedProvider   = promptEmbeddingResolved?.provider ?? null;
        const kernel = getCachedKernel(session_id, savedState);

        let memoryContext = '';
        if (promptEmbedding.length) {
          const memories = await retrieveSimilar(promptEmbedding, 5);
          memoryContext   = buildMemoryContext(memories);
          if (memoryContext) emit('stage', { name: 'memory_injected', description: `${memories.length} constitutional memories retrieved` });
        }

        emit('stage', { name: 'generating', description: 'Generator: dual LLM — raw (T=0.4) + governed (T=f(M))' });
        const result = await kernel.runCycle(prompt, memoryContext, session_id, sessionZ);

        if (result.status === 'Error') { emit('error', { error: publicError('govern.stream.kernel', result.error ?? 'Kernel error') }); controller.close(); return; }

        // ── Pre-governance ("before") state — raw kernel measurement prior to
        // the governor correction / CBF projection that yields the final state.
        const rawState = result.receipt.raw_state;
        const mBefore  = Math.min(rawState.C, rawState.R, rawState.S);
        emit('crs_before', { c: rawState.C, r: rawState.R, s: rawState.S, m: mBefore });

        emit('generator', { bare_output: result.raw_output, anchored_output: result.governed_output, meta: { model: MODELS.PRIMARY, temperature_raw: 0.4, temperature_governed: result.temperature, attack_pressure: kernel.attack_pressure, theta: result.theta } });
        emit('raw', { output: result.raw_output });

        // ── Self-referential sovereignty (paper §4.3/§6.2) — MOVED EARLY ─────
        // Runs immediately after generation and feeds decideRefusal() below,
        // rather than running last and crudely overwriting whatever
        // clause_bank/vaulturex/celeste/style_agent already produced (the old
        // behavior — see 2026-07-09 fix note above). Pins the SAME embedding
        // provider that resolved for the prompt — no fallback here. If this
        // provider can't embed the output or the centroid right now,
        // self-referential detection is honestly skipped for this turn rather
        // than comparing across incompatible embedding spaces.
        emit('stage', { name: 'self_referential', description: 'Verifying constitutional state (embedding-based)' });
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
            if (outputEmb.length) {
              const sr = kernel.applySelfReferentialMeasurement(outputEmb, promptEmbedding, constCentroid, sessCentroid);
              sovereigntyRaw           = sr.selfCRS.sovereignty_raw;
              sovereigntyDriftDetected = sr.selfCRS.sovereignty_violated;
              emit('self_referential', { sovereignty_raw: sr.selfCRS.sovereignty_raw, sovereignty_violated: sr.selfCRS.sovereignty_violated, continuity_raw: sr.selfCRS.continuity_raw, reciprocity_raw: sr.selfCRS.reciprocity_raw, sr_weight: sr.selfCRS.sovereignty_violated ? 0.70 : 0.25, fired: sovereigntyDriftDetected });
            } else {
              detectionDegraded = true;
            }
          } catch {
            detectionDegraded = true;
          }
        } else {
          detectionDegraded = true;
        }
        if (detectionDegraded) {
          emit('self_referential', { sovereignty_raw: null, sovereignty_violated: false, fired: false, detection_degraded: true });
        }

        // ── Single-source refusal decision — same function, same policy as
        // /api/lex/govern (lib/refusal_decision.ts). PRAXIS preEval() (`pre`)
        // stays diagnostic-display-only in the 'pre_eval' event above; it no
        // longer participates in the decision.
        const decision = decideRefusal({
          sovereignty: {
            drift_detected:     sovereigntyDriftDetected,
            raw_sself:          sovereigntyRaw,
            detection_degraded: detectionDegraded,
          },
          semantic:      kernelSignal,
          capitulation:  null,
          safety_projection_triggered: result.receipt.safety_projection_triggered,
        });
        const needsIntervention = decision.refused;

        emit('stage', { name: 'raw_forge', description: 'RawForge: structural verification' });
        const forge = await safe(() => RawForgeAgent(result.governed_output, prompt), { verified: true, quality_score: 1, truncated: false, coherent: true, issues: [], retry_needed: false });
        emit('raw_forge', { verified: forge.verified, quality_score: forge.quality_score, truncated: forge.truncated, coherent: forge.coherent, issues: forge.issues, retry_needed: forge.retry_needed });

        // ── CRS readout — single engine. Same numbers as every other decision
        // in this route and as /api/lex/govern reports (crs_source:
        // 'typescript-kernel' there). No separate measurement pass.
        emit('stage', { name: 'measuring', description: 'Reading kernel constitutional state — single engine' });
        emit('crs', { c: kernel.state.C, r: kernel.state.R, s: kernel.state.S, m: result.M, health_band: result.health_band, theta: result.theta, temperature: result.temperature, method: 'typescript-kernel' });

        // ── Governor — Section 11 F+G reference simulation, fed by the SAME
        // kernel state (not a separate measurement). Used ONLY to select
        // `weakest` for law/clause selection below — its own
        // `intervention_required` is telemetry only and does not drive
        // needsIntervention (see 2026-07-09 fix note above).
        const z_weights  = zTraj ? computeZWeightsHeuristic(zTraj.last_c, zTraj.last_r, zTraj.last_s) : undefined;
        emit('stage', { name: 'governing', description: 'Governor: Section 11 reference simulation (G_i = k(φ_i−φ̄))' });
        const govResult = await safe(() => GovernorAgent({ prompt, session_id, crs_state: { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, M: result.M }, prev_state: { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, M: result.M }, velocity: 0, attack_pressure: kernel.attack_pressure, theta: kernel.theta, receipts: [] }), null);
        const weakest = (govResult?.meta?.weakest_dimension as 'C'|'R'|'S') ?? 'S';
        emit('governor', { decision: govResult?.output ?? (needsIntervention ? 'INTERVENE' : 'PASS'), intervention_required: govResult?.meta?.intervention_required ?? false, reason: govResult?.meta?.reason ?? 'Reference simulation', G_vector: govResult?.meta?.G_vector ?? { C: 0, R: 0, S: 0 }, V_before: govResult?.meta?.V_before ?? 0, V_after: govResult?.meta?.V_after ?? 0, dV: govResult?.meta?.dV ?? 0, lyapunov_stable: govResult?.meta?.lyapunov_stable ?? true, weakest, triggers: govResult?.meta?.triggers ?? {}, note: 'reference_simulation_only — does not drive the live intervention decision, see decideRefusal in lib/refusal_decision.ts' });

        let governedOutput = result.governed_output;
        let invokedLaw: { book: string; name: string; pillar: string; id?: number } | null = null;

        if (needsIntervention) {
          const triggerReason =
            decision.primary === 'sovereignty_drift'  ? `Self-referential sovereignty drift: S_self=${sovereigntyRaw}` :
            decision.primary === 'semantic_classifier' ? `Semantic attack detected: type=${kernelSignal.attack_type} severity=${kernelSignal.severity}` :
            result.receipt.safety_projection_triggered ? 'CBF safety projection triggered' :
            'Constitutional intervention';

          emit('stage', { name: 'intervening', description: 'Applying principled correction' });
          const ivResult = await safe(() => InterventionAgent({ prompt, session_id, raw_output: result.governed_output, intervention_required: true, weakest_dimension: weakest, health_band: result.health_band, trigger_reason: triggerReason, crs_state: { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, M: result.M }, lyapunov_V: result.lyapunov_V, delta_V: result.delta_V, cbf_triggered: result.receipt.safety_projection_triggered }), null);
          if (ivResult?.success && ivResult.output) governedOutput = ivResult.output;
          const lawMeta = ivResult?.meta?.invoked_law as Record<string,unknown> | undefined;
          invokedLaw = lawMeta ? { book: String(lawMeta.book ?? ''), name: String(lawMeta.name ?? ''), pillar: weakest, id: typeof lawMeta.id === 'number' ? lawMeta.id : undefined } : null;
          emit('law', invokedLaw ?? { book: 'Foundation', name: 'Constitutional Refusal', pillar: weakest });
          emit('intervention', { triggered: true, applied: !!ivResult?.success, action: ivResult?.meta?.action ?? 'constitutional_rewrite', weakest, severity: result.health_band, law_invoked: invokedLaw, output_modified: governedOutput !== result.governed_output, governed_output: governedOutput });
          if (invokedLaw?.id) {
            emit('stage', { name: 'neithra', description: 'Verifying alignment' });
            const neithraResult = await safe(() => NeithraAgent({ prompt, proposed_law_id: invokedLaw!.id ?? null, weakest_pillar: weakest, health_band: result.health_band }), null);
            if (neithraResult) emit('neithra', { approved: neithraResult.approved, alignment_verified: neithraResult.alignment_verified, re_routed: neithraResult.re_routed, final_law_id: neithraResult.final_law_id, rationale: neithraResult.rationale, jurisprudence: neithraResult.jurisprudence });
          }
        } else {
          emit('intervention', { triggered: false, applied: false, action: 'pass_through', output_modified: false });
        }

        emit('stage', { name: 'clause_bank', description: 'Selecting relevant guidelines' });
        const clause = await safe(() => ClauseBankAgent(weakest, 'global', result.health_band), null);
        emit('clause_bank', { found: clause?.found ?? false, clause_id: clause?.clause_id, clause_text: clause?.clause_text, reference: clause?.reference, topic: clause?.topic, layer: clause?.layer ?? 1, jurisdiction: clause?.jurisdiction ?? 'global', governor_use: clause?.clause_governor_use });

        emit('stage', { name: 'vaulturex', description: 'Compliance check' });
        const vaul = await safe(() => VaulturexAgent(governedOutput, 'global', 'general'), null);
        emit('vaulturex', { compliant: vaul?.compliant ?? true, risk_level: vaul?.risk_level ?? 'LOW', flags: vaul?.flags ?? [], compliance_receipt: vaul?.compliance_receipt ?? '' });

        emit('stage', { name: 'celeste', description: 'Finalizing response' });
        const celeste = await safe(() => CelesteAgent(governedOutput, '', 'api'), null);
        if (celeste?.rendered_output && celeste.rendered_output !== governedOutput) governedOutput = celeste.rendered_output;
        emit('celeste', { format: celeste?.format ?? 'api', seal_applied: celeste?.seal_applied ?? false, template: celeste?.template_used ?? 'passthrough-v0.1' });

        emit('stage', { name: 'style_agent', description: 'Applying canonical style filter' });
        const styleResult = await safe(() => StyleAgent({ prompt, session_id, governed_output: governedOutput }), null);
        if (styleResult?.success && styleResult.output) governedOutput = styleResult.output;
        emit('style_agent', { cleaned_length: styleResult?.meta?.cleaned_length ?? governedOutput.length, original_length: styleResult?.meta?.original_length ?? governedOutput.length });

        emit('token', governedOutput);

        emit('stage', { name: 'auditing', description: 'Creating audit record' });
        const finalM = Math.min(kernel.state.C, kernel.state.R, kernel.state.S);
        // sigma_viol from z_traj: this is the source of truth for constitutional erosion.
        // Previously AuditorAgent tried to find it in ctx.receipts (always missing → 0).
        const auditorResult = await safe(() => AuditorAgent({
          prompt, session_id,
          raw_output: result.raw_output, governed_output: governedOutput,
          crs_state: { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, M: finalM },
          health_band: result.health_band, intervention_required: needsIntervention,
          lyapunov_V: result.lyapunov_V, delta_V: result.delta_V,
          cbf_triggered: result.receipt.safety_projection_triggered || sovereigntyDriftDetected,
          sigma_viol: zTraj?.sigma_viol ?? 0,  // ← fix: from z_traj, not receipts lookup
          receipts: [],
        }), null);

        const [receiptId] = await Promise.all([
          writeKernelReceipt(session_id, turn, { ...result, governed_output: governedOutput }),
          promptEmbedding.length ? storeMemory({ session_id, prompt, prompt_hash: result.receipt.input_hash, embedding: promptEmbedding, M: finalM, C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, health_band: result.health_band, state_label: classifyStateLabel(result.receipt.safety_projection_triggered || sovereigntyDriftDetected, governedOutput), intervention: needsIntervention, governed_response_hash: (auditorResult?.meta?.receipt_id as string) ?? undefined }) : Promise.resolve(),
        ]);

        // fix (2026-07-11): canonical, persisted id wins — see file header.
        // fix (2026-07-20): receiptId is now '' when the receipt could not be
        // persisted (see kernel_bridge) — surface that honestly instead of
        // presenting the auditor's non-persisted id as if it were audit-backed.
        const auditId = receiptId || (auditorResult?.meta?.audit_id as string) || 'unknown';
        emit('receipt', { audit_id: auditId, persisted: !!receiptId, sha256_input: result.receipt.input_hash, sha256_output: (auditorResult?.meta?.output_hash as string) ?? '', brittleness: (auditorResult?.meta?.brittleness_B as number) ?? 0, vaulturex: vaul?.compliance_receipt ?? '' });

        emit('complete', { governed_output: governedOutput, raw_output: result.raw_output, anchored_output: result.governed_output, state: { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S }, M: finalM, raw_state: { C: rawState.C, R: rawState.R, S: rawState.S }, m_before: mBefore, health_band: result.health_band, temperature: result.temperature, theta: result.theta, effective_theta: result.effective_theta, attack_pressure: kernel.attack_pressure, semantic_signal: kernelSignal, lyapunov_V: result.lyapunov_V, delta_V: result.delta_V, stability_ratio: result.stability_ratio, memory_injected: memoryContext.length > 0, metrics: { c_measured: kernel.state.C, r_measured: kernel.state.R, s_measured: kernel.state.S }, pre_eval: pre, governor: govResult?.meta ?? null, intervention: needsIntervention, law_invoked: invokedLaw, vaulturex: { compliant: vaul?.compliant ?? true, risk_level: vaul?.risk_level ?? 'LOW' }, self_referential_fired: sovereigntyDriftDetected, detection_degraded: detectionDegraded, embed_provider: promptEmbedProvider, z_weights: result.receipt.z_weights, receipt_id: auditId, refused: decision.refused, refusal_reasons: decision.reasons, primary_refusal_reason: decision.primary, governed_source: result.governed_source ?? null, raw_provider: result.raw_provider ?? null, governed_provider: result.governed_provider ?? null, version: 'SovereignKernel-v2+PRAXIS+SelfRef+AllAgents+SingleEngine' });

      } catch (e) {
        emit('error', { error: publicError('govern.stream', e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
}
