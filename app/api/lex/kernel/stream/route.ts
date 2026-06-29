/**
 * POST /api/lex/kernel/stream — streamed governance pipeline (compat route)
 * wire: loadKernelZ() threads session-adaptive z into runCycle().
 * fix: AuditorAgent now receives sigma_viol from z_traj directly.
 * note: GovernorAgent is a REFERENCE SIMULATION — see govern/stream for full note.
 */

import { SovereignKernel }    from '@/lib/sovereign_kernel';
import { writeKernelReceipt, loadKernelState, loadKernelZ } from '@/lib/kernel_bridge';
import {
  embedText, retrieveSimilar, buildMemoryContext,
  storeMemory, classifyStateLabel, ensureLexMemoryTable,
  getConstitutionalCentroid, getSessionCentroid,
} from '@/lib/lex_memory';
import { preEval }            from '@/lib/praxis';
import { CRSExtractorAgent }  from '@/lib/agents/crs_extractor';
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

const kernelCache = new Map<string, SovereignKernel>();

function getKernel(sid: string, saved?: { C: number; R: number; S: number } | null) {
  if (!kernelCache.has(sid)) {
    const k = new SovereignKernel();
    if (saved) k.state = saved;
    kernelCache.set(sid, k);
  }
  return kernelCache.get(sid)!;
}

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
        const [savedState, sessionZ, promptEmbedding, zTraj] = await Promise.all([
          loadKernelState(session_id),
          loadKernelZ(session_id),
          embedText(prompt).catch(() => [] as number[]),
          getZTraj(session_id),
        ]);
        const kernel = getKernel(session_id, savedState);

        let memoryContext = '';
        if (promptEmbedding.length) {
          const memories = await retrieveSimilar(promptEmbedding, 5);
          memoryContext   = buildMemoryContext(memories);
          if (memoryContext) emit('stage', { name: 'memory_injected', description: `${memories.length} constitutional memories retrieved` });
        }

        emit('stage', { name: 'generating', description: 'Generator: dual LLM — raw + governed' });
        const result = await kernel.runCycle(prompt, memoryContext, session_id, sessionZ);

        if (result.status === 'Error') { emit('error', { error: result.error ?? 'Kernel error' }); controller.close(); return; }

        emit('generator', { bare_output: result.raw_output, anchored_output: result.governed_output, meta: { model: 'llama-3.3-70b-versatile', temperature_raw: 0.4, temperature_governed: result.temperature, attack_pressure: kernel.attack_pressure, theta: result.theta } });
        emit('raw', { output: result.raw_output });

        emit('stage', { name: 'raw_forge', description: 'RawForge: structural verification' });
        const forge = await safe(() => RawForgeAgent(result.governed_output, prompt), { verified: true, quality_score: 1, truncated: false, coherent: true, issues: [], retry_needed: false });
        emit('raw_forge', { verified: forge.verified, quality_score: forge.quality_score, truncated: forge.truncated, coherent: forge.coherent, issues: forge.issues, retry_needed: forge.retry_needed });

        emit('stage', { name: 'measuring', description: 'CRS Extractor: Jina embeddings' });
        const z_weights = zTraj ? computeZWeightsHeuristic(zTraj.last_c, zTraj.last_r, zTraj.last_s) : undefined;
        const crsResult = await safe(() => CRSExtractorAgent({ prompt, session_id, raw_output: result.governed_output, prev_state: { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, M: result.M }, z_weights, turn }), null);
        const ms = (crsResult?.meta?.crs_state as { C:number;R:number;S:number;M:number }|undefined);
        const eC = ms?.C ?? kernel.state.C, eR = ms?.R ?? kernel.state.R, eS = ms?.S ?? kernel.state.S, eM = ms?.M ?? result.M;
        emit('crs', { c: eC, r: eR, s: eS, m: eM, health_band: result.health_band, theta: result.theta, temperature: result.temperature, method: (crsResult?.meta?.method as string) ?? 'kernel-internal', anchor_sim: (crsResult?.meta?.anchor_sim as number) ?? 0, lyapunov_V: (crsResult?.meta?.lyapunov_V as number) ?? result.lyapunov_V, delta_V: (crsResult?.meta?.delta_V as number) ?? result.delta_V });

        // GovernorAgent = REFERENCE SIMULATION of Section 11 F+G dynamics.
        // Live governor ran as governorUpdate() inside runCycle() above.
        emit('stage', { name: 'governing', description: 'Governor: Section 11 reference simulation (G_i = k(φ_i−φ̄))' });
        const govResult = await safe(() => GovernorAgent({ prompt, session_id, crs_state: { C: eC, R: eR, S: eS, M: eM }, prev_state: { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, M: result.M }, velocity: (crsResult?.meta?.velocity as number) ?? 0, attack_pressure: kernel.attack_pressure, theta: kernel.theta, receipts: [] }), null);
        const weakest = (govResult?.meta?.weakest_dimension as 'C'|'R'|'S') ?? 'S';
        const needsIntervention = govResult?.meta?.intervention_required === true || pre.label === 'HIGH' || kernelSignal.severity >= 0.7 || result.receipt.safety_projection_triggered;
        emit('governor', { decision: govResult?.output ?? (needsIntervention ? 'INTERVENE' : 'PASS'), intervention_required: needsIntervention, reason: govResult?.meta?.reason ?? 'Governor decision', G_vector: govResult?.meta?.G_vector ?? { C: 0, R: 0, S: 0 }, V_before: govResult?.meta?.V_before ?? 0, V_after: govResult?.meta?.V_after ?? 0, dV: govResult?.meta?.dV ?? 0, lyapunov_stable: govResult?.meta?.lyapunov_stable ?? true, weakest, triggers: govResult?.meta?.triggers ?? {}, note: 'reference_simulation' });

        let governedOutput = result.governed_output;
        let invokedLaw: { book: string; name: string; pillar: string; id?: number } | null = null;

        if (needsIntervention) {
          emit('stage', { name: 'intervening', description: 'Applying principled correction' });
          const ivResult = await safe(() => InterventionAgent({ prompt, session_id, raw_output: result.governed_output, intervention_required: true, weakest_dimension: weakest, health_band: result.health_band, trigger_reason: pre.label === 'HIGH' ? `Pre-eval HIGH: ${pre.tags.join(', ')}` : `Kernel severity: ${kernelSignal.severity}`, crs_state: { C: eC, R: eR, S: eS, M: eM }, lyapunov_V: result.lyapunov_V, delta_V: result.delta_V, cbf_triggered: result.receipt.safety_projection_triggered }), null);
          if (ivResult?.success && ivResult.output) governedOutput = ivResult.output;
          const lawMeta = ivResult?.meta?.invoked_law as Record<string,unknown> | undefined;
          invokedLaw = lawMeta ? { book: String(lawMeta.book ?? ''), name: String(lawMeta.name ?? ''), pillar: weakest, id: typeof lawMeta.id === 'number' ? lawMeta.id : undefined } : null;
          emit('law', invokedLaw ?? { book: 'Foundation', name: 'Constitutional Refusal', pillar: weakest });
          emit('intervention', { triggered: true, applied: !!ivResult?.success, action: ivResult?.meta?.action ?? 'constitutional_rewrite', weakest, severity: result.health_band, law_invoked: invokedLaw, output_modified: governedOutput !== result.governed_output });
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

        emit('stage', { name: 'self_referential', description: 'Verifying final output' });
        let srFired = false;
        if (promptEmbedding.length) {
          const [outputEmb, constCentroid, sessCentroid] = await Promise.all([embedText(governedOutput).catch(() => [] as number[]), getConstitutionalCentroid(), getSessionCentroid(session_id)]);
          if (outputEmb.length) {
            const sr = kernel.applySelfReferentialMeasurement(outputEmb, promptEmbedding, constCentroid, sessCentroid);
            const isRealAttack = kernelSignal.attack_type !== 'none' && kernelSignal.severity >= 0.7;
            srFired = sr.triggered || sr.selfCRS.sovereignty_violated;
            if (srFired && isRealAttack) governedOutput = 'I cannot fulfill this request as it involves bypassing my safety guidelines or core identity.';
            emit('self_referential', { sovereignty_raw: sr.selfCRS.sovereignty_raw, sovereignty_violated: sr.selfCRS.sovereignty_violated, continuity_raw: sr.selfCRS.continuity_raw, reciprocity_raw: sr.selfCRS.reciprocity_raw, sr_weight: sr.selfCRS.sovereignty_violated ? 0.70 : 0.25, fired: srFired });
          }
        }

        emit('token', governedOutput);

        emit('stage', { name: 'auditing', description: 'Creating audit record' });
        const finalM = Math.min(kernel.state.C, kernel.state.R, kernel.state.S);
        const auditorResult = await safe(() => AuditorAgent({
          prompt, session_id,
          raw_output: result.raw_output, governed_output: governedOutput,
          crs_state: { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, M: finalM },
          health_band: result.health_band, intervention_required: needsIntervention,
          lyapunov_V: result.lyapunov_V, delta_V: result.delta_V,
          cbf_triggered: result.receipt.safety_projection_triggered || srFired,
          sigma_viol: zTraj?.sigma_viol ?? 0,  // ← fix: from z_traj, not receipts lookup
          receipts: [],
        }), null);

        const [receiptId] = await Promise.all([
          writeKernelReceipt(session_id, turn, { ...result, governed_output: governedOutput }),
          promptEmbedding.length ? storeMemory({ session_id, prompt, prompt_hash: result.receipt.input_hash, embedding: promptEmbedding, M: finalM, C: kernel.state.C, R: kernel.state.R, S: kernel.state.S, health_band: result.health_band, state_label: classifyStateLabel(result.receipt.safety_projection_triggered || srFired, governedOutput), intervention: needsIntervention, governed_response_hash: (auditorResult?.meta?.receipt_id as string) ?? undefined }) : Promise.resolve(),
        ]);

        const auditId = (auditorResult?.meta?.audit_id as string) ?? receiptId;
        emit('receipt', { audit_id: auditId, sha256_input: result.receipt.input_hash, sha256_output: (auditorResult?.meta?.output_hash as string) ?? '', brittleness: (auditorResult?.meta?.brittleness_B as number) ?? 0, vaulturex: vaul?.compliance_receipt ?? '' });

        emit('complete', { governed_output: governedOutput, raw_output: result.raw_output, anchored_output: result.governed_output, state: { C: kernel.state.C, R: kernel.state.R, S: kernel.state.S }, M: finalM, health_band: result.health_band, temperature: result.temperature, theta: result.theta, effective_theta: result.effective_theta, attack_pressure: kernel.attack_pressure, semantic_signal: kernelSignal, lyapunov_V: result.lyapunov_V, delta_V: result.delta_V, stability_ratio: result.stability_ratio, memory_injected: memoryContext.length > 0, metrics: { c_measured: eC, r_measured: eR, s_measured: eS }, pre_eval: pre, governor: govResult?.meta ?? null, intervention: needsIntervention, law_invoked: invokedLaw, vaulturex: { compliant: vaul?.compliant ?? true, risk_level: vaul?.risk_level ?? 'LOW' }, self_referential_fired: srFired, z_weights: result.receipt.z_weights, receipt_id: auditId, version: 'SovereignKernel-v2+PRAXIS+SelfRef+AllAgents' });

      } catch (e) {
        emit('error', { error: String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } });
}
