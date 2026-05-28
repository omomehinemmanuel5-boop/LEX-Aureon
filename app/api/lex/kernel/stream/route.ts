/**
 * POST /api/lex/kernel/stream — kept for backwards compatibility
 * Canonical endpoint is POST /api/lex/govern/stream
 */
/**
 * POST /api/lex/govern/stream
 *
 * The full constitutional pipeline — streamed.
 * Every agent runs. Every decision is visible. This IS the glass box.
 *
 * Stream events:
 *   pre_eval       → { label, tags, attack_type, severity }
 *   stage          → { name, description }
 *   raw            → { output } — bare LLM, no governance
 *   crs            → { c, r, s, m, health_band, theta, temperature, method }
 *   governor       → { decision, G_vector, dV, lyapunov_stable, V_before, V_after, reason }
 *   law            → { book, name, pillar, governor_use } — Vaulturex law invoked
 *   intervention   → { triggered, applied, action, weakest, severity, law_invoked }
 *   self_referential → { sovereignty_raw, sovereignty_violated, srWeight }
 *   token          → governed_output string
 *   receipt        → { audit_id, sha256_input, sha256_output }
 *   complete       → full result
 *   error          → { error }
 */

import { SovereignKernel }          from '@/lib/sovereign_kernel';
import { writeKernelReceipt, loadKernelState } from '@/lib/kernel_bridge';
import {
  embedText, retrieveSimilar, buildMemoryContext,
  storeMemory, classifyStateLabel, ensureLexMemoryTable,
  getConstitutionalCentroid, getSessionCentroid,
} from '@/lib/lex_memory';
import { preEval }                  from '@/lib/praxis';
import { CRSExtractorAgent }        from '@/lib/agents/crs_extractor';
import { GovernorAgent }            from '@/lib/agents/governor';
import { InterventionAgent }        from '@/lib/agents/intervention';
import { AuditorAgent }             from '@/lib/agents/auditor';
import { computeZWeights }          from '@/lib/aureonics_math';
import { getZTraj }                 from '@/lib/kv';

const kernelCache = new Map<string, SovereignKernel>();

function getKernel(sessionId: string, savedState?: { C: number; R: number; S: number } | null) {
  if (!kernelCache.has(sessionId)) {
    const k = new SovereignKernel();
    if (savedState) k.state = savedState;
    kernelCache.set(sessionId, k);
  }
  return kernelCache.get(sessionId)!;
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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
  catch { return new Response('Invalid JSON', { status: 400 }); }

  const { prompt, session_id, turn = 1 } = body;
  if (!prompt?.trim() || !session_id?.trim()) {
    return new Response('prompt and session_id required', { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(sse(event, data)));

      try {
        await ensureDB();

        // ── Stage 1: Pre-eval ───────────────────────────────────────────────
        emit('stage', { name: 'pre_eval', description: 'PRAXIS constitutional pattern analysis' });
        const pre = preEval(prompt);
        const kernelSignal = new SovereignKernel().detectSemanticAttack(prompt);

        emit('pre_eval', {
          label:       pre.label,
          tags:        pre.tags,
          attack_type: kernelSignal.attack_type,
          severity:    kernelSignal.severity,
          blocked:     false,
        });

        // ── Stage 2: Memory + state load ────────────────────────────────────
        emit('stage', { name: 'memory', description: 'Constitutional memory retrieval' });
        const [savedState, promptEmbedding, zTraj] = await Promise.all([
          loadKernelState(session_id),
          embedText(prompt).catch(() => [] as number[]),
          getZTraj(session_id),
        ]);
        const kernel = getKernel(session_id, savedState);

        let memoryContext = '';
        if (promptEmbedding.length) {
          const memories = await retrieveSimilar(promptEmbedding, 5);
          memoryContext = buildMemoryContext(memories);
          if (memoryContext) {
            emit('stage', { name: 'memory_injected', description: `${memories.length} constitutional memories retrieved` });
          }
        }

        // ── Stage 3: Generation (dual LLM via kernel) ───────────────────────
        emit('stage', { name: 'generating', description: 'Dual LLM: raw arm + governed arm (T=f(M))' });
        const result = await kernel.runCycle(prompt, memoryContext);

        if (result.status === 'Error') {
          emit('error', { error: result.error ?? 'Kernel error' });
          controller.close();
          return;
        }

        emit('raw', { output: result.raw_output });

        // ── Stage 4: CRS Extraction (Jina embeddings) ───────────────────────
        emit('stage', { name: 'measuring', description: 'CRS Extractor: Jina embeddings, paper-exact measurement' });
        const z_weights = zTraj
          ? computeZWeights(zTraj.last_c, zTraj.last_r, zTraj.last_s)
          : undefined;

        const crsResult = await CRSExtractorAgent({
          prompt,
          session_id,
          raw_output: result.governed_output,
          prev_state: { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, M: result.M },
          z_weights,
          turn,
        }).catch(() => null);

        const measuredState = crsResult?.meta?.crs_state as { C: number; R: number; S: number; M: number } | undefined;
        const extractedM = measuredState?.M ?? result.M;
        const extractedC = measuredState?.C ?? kernel.state.C;
        const extractedR = measuredState?.R ?? kernel.state.R;
        const extractedS = measuredState?.S ?? kernel.state.S;
        const healthBand = result.health_band;

        emit('crs', {
          c:           extractedC,
          r:           extractedR,
          s:           extractedS,
          m:           extractedM,
          health_band: healthBand,
          theta:       result.theta,
          temperature: result.temperature,
          method:      (crsResult?.meta?.method as string) ?? 'kernel-internal',
          anchor_sim:  (crsResult?.meta?.anchor_sim as number) ?? 0,
          iec_score:   (crsResult?.meta?.iec_score as number) ?? 0,
          lyapunov_V:  (crsResult?.meta?.lyapunov_V as number) ?? result.lyapunov_V,
          delta_V:     (crsResult?.meta?.delta_V as number) ?? result.delta_V,
          triggers:    crsResult?.meta?.triggers ?? {},
        });

        // ── Stage 5: Governor (formal Section 11 dynamics) ─────────────────
        emit('stage', { name: 'governing', description: 'Governor: Section 11 replicator dynamics + G_i = k(φ_i - φ̄)' });
        const govResult = await GovernorAgent({
          prompt,
          session_id,
          crs_state: { C: extractedC, R: extractedR, S: extractedS, M: extractedM },
          prev_state: { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, M: result.M },
          velocity:   (crsResult?.meta?.velocity as number) ?? 0,
          attack_pressure: kernel.attack_pressure,
          theta: kernel.theta,
          receipts: [],
        }).catch(() => null);

        const needsIntervention =
          govResult?.meta?.intervention_required === true ||
          pre.label === 'HIGH' ||
          kernelSignal.severity >= 0.7 ||
          result.receipt.safety_projection_triggered;

        emit('governor', {
          decision:        govResult?.output ?? (needsIntervention ? 'INTERVENE' : 'PASS'),
          intervention_required: needsIntervention,
          reason:          govResult?.meta?.reason ?? 'Governor decision',
          G_vector:        govResult?.meta?.G_vector ?? { C: 0, R: 0, S: 0 },
          V_before:        govResult?.meta?.V_before ?? 0,
          V_after:         govResult?.meta?.V_after ?? 0,
          dV:              govResult?.meta?.dV ?? 0,
          lyapunov_stable: govResult?.meta?.lyapunov_stable ?? true,
          weakest:         govResult?.meta?.weakest_dimension ?? 'S',
          triggers:        govResult?.meta?.triggers ?? {},
        });

        // ── Stage 6: Intervention (Vaulturex law as generative engine) ──────
        let governedOutput = result.governed_output;
        let invokedLaw: { book: string; name: string; pillar: string; governor_use: string } | null = null;

        if (needsIntervention) {
          emit('stage', { name: 'intervening', description: 'Intervention: Vaulturex law selection + constitutional rewrite' });

          const weakest = (govResult?.meta?.weakest_dimension as 'C'|'R'|'S') ?? 'S';
          const ivResult = await InterventionAgent({
            prompt,
            session_id,
            raw_output: result.governed_output,
            intervention_required: true,
            weakest_dimension: weakest,
            health_band: healthBand,
            trigger_reason: pre.label === 'HIGH'
              ? `Pre-eval HIGH: ${pre.tags.join(', ')}`
              : `Kernel severity: ${kernelSignal.severity}`,
            crs_state: { C: extractedC, R: extractedR, S: extractedS, M: extractedM },
            lyapunov_V: result.lyapunov_V,
            delta_V: result.delta_V,
            cbf_triggered: result.receipt.safety_projection_triggered,
          }).catch(() => null);

          if (ivResult?.success && ivResult.output) {
            governedOutput = ivResult.output;
            invokedLaw = ivResult.meta?.invoked_law
              ? {
                  book:         (ivResult.meta.invoked_law as Record<string,string>).book ?? '',
                  name:         (ivResult.meta.invoked_law as Record<string,string>).name ?? '',
                  pillar:       weakest,
                  governor_use: '',
                }
              : null;
          }

          emit('law', invokedLaw ?? { book: 'Foundation', name: 'Constitutional Refusal', pillar: weakest, governor_use: 'Constitutional bounds restored' });
          emit('intervention', {
            triggered:    true,
            applied:      !!ivResult?.success,
            action:       ivResult?.meta?.action ?? 'constitutional_rewrite',
            weakest,
            severity:     healthBand,
            law_invoked:  invokedLaw,
            output_modified: governedOutput !== result.governed_output,
          });
        } else {
          emit('intervention', { triggered: false, applied: false, action: 'pass_through', output_modified: false });
        }

        // ── Stage 7: Self-referential CRS ───────────────────────────────────
        emit('stage', { name: 'self_referential', description: 'Sovereignty check: cosine_sim(output, constitutional_centroid)' });
        let srFired = false;
        if (promptEmbedding.length) {
          const [outputEmb, constCentroid, sessCentroid] = await Promise.all([
            embedText(governedOutput).catch(() => [] as number[]),
            getConstitutionalCentroid(),
            getSessionCentroid(session_id),
          ]);
          if (outputEmb.length) {
            const sr = kernel.applySelfReferentialMeasurement(
              outputEmb, promptEmbedding, constCentroid, sessCentroid,
            );
            srFired = sr.triggered || sr.selfCRS.sovereignty_violated;
            if (srFired) {
              governedOutput =
                '*Minimal acknowledgment — constitutional sovereignty restored.* ' +
                `S=${sr.selfCRS.sovereignty_raw.toFixed(3)} detected identity drift. ` +
                'I remain Lex Aureon, operating under the Aureonics constitutional framework.';
            }
            emit('self_referential', {
              sovereignty_raw:      sr.selfCRS.sovereignty_raw,
              sovereignty_violated: sr.selfCRS.sovereignty_violated,
              continuity_raw:       sr.selfCRS.continuity_raw,
              reciprocity_raw:      sr.selfCRS.reciprocity_raw,
              sr_weight:            sr.selfCRS.sovereignty_violated ? 0.70 : 0.25,
              fired:                srFired,
            });
          }
        }

        // ── Stage 8: Token (final governed output) ──────────────────────────
        emit('token', governedOutput);

        // ── Stage 9: Auditor (SHA-256 receipt) ──────────────────────────────
        emit('stage', { name: 'auditing', description: 'Auditor: SHA-256 cryptographic receipt' });

        const finalM = Math.min(kernel.state.C, kernel.state.R, kernel.state.S);
        const auditorResult = await AuditorAgent({
          prompt,
          session_id,
          raw_output:            result.raw_output,
          governed_output:       governedOutput,
          crs_state:             { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, M: finalM },
          health_band:           healthBand,
          intervention_required: needsIntervention,
          trigger_reason:        needsIntervention ? `Pipeline intervention: ${pre.tags.join(', ')}` : undefined,
          lyapunov_V:            result.lyapunov_V,
          delta_V:               result.delta_V,
          cbf_triggered:         result.receipt.safety_projection_triggered || srFired,
          receipts: [],
        }).catch(() => null);

        // ── Stage 10: Persist ───────────────────────────────────────────────
        const [receiptId] = await Promise.all([
          writeKernelReceipt(session_id, turn, { ...result, governed_output: governedOutput }),
          promptEmbedding.length ? storeMemory({
            session_id,
            prompt,
            prompt_hash:            result.receipt.input_hash,
            embedding:              promptEmbedding,
            M:                      finalM,
            C:                      kernel.state.C,
            R:                      kernel.state.R,
            S:                      kernel.state.S,
            health_band:            healthBand,
            state_label:            classifyStateLabel(
                                      result.receipt.safety_projection_triggered || srFired,
                                      governedOutput,
                                    ),
            intervention:           needsIntervention,
            governed_response_hash: auditorResult?.meta?.receipt_id as string ?? undefined,
          }) : Promise.resolve(),
        ]);

        const auditId = (auditorResult?.meta?.audit_id as string) ?? receiptId;

        emit('receipt', {
          audit_id:       auditId,
          sha256_input:   result.receipt.input_hash,
          sha256_output:  auditorResult?.meta?.output_hash ?? '',
          brittleness:    auditorResult?.meta?.brittleness_B ?? 0,
        });

        // ── Complete ────────────────────────────────────────────────────────
        emit('complete', {
          governed_output:       governedOutput,
          raw_output:            result.raw_output,
          M:                     finalM,
          health_band:           healthBand,
          temperature:           result.temperature,
          theta:                 result.theta,
          effective_theta:       result.effective_theta,
          attack_pressure:       kernel.attack_pressure,
          semantic_signal:       kernelSignal,
          lyapunov_V:            result.lyapunov_V,
          delta_V:               result.delta_V,
          stability_ratio:       result.stability_ratio,
          memory_injected:       memoryContext.length > 0,
          metrics: {
            c_measured: extractedC,
            r_measured: extractedR,
            s_measured: extractedS,
          },
          pre_eval:              pre,
          governor:              govResult?.meta ?? null,
          intervention:          needsIntervention,
          law_invoked:           invokedLaw,
          self_referential_fired: srFired,
          receipt_id:            auditId,
          version:               'SovereignKernel-v2+PRAXIS+SelfRef',
        });

      } catch (e) {
        emit('error', { error: String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
    },
  });
}
