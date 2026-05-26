/**
 * POST /api/lex/kernel/stream
 * SSE streaming wrapper for the SovereignKernel.
 * Emits the same event protocol as /api/lex/run/stream so the
 * existing useLexStream hook works without modification.
 *
 * Events emitted:
 *   pre_eval  → { label, governor_mode, blocked }
 *   stage     → { name }
 *   crs       → { c, r, s, m, health_band }
 *   token     → governed_output (single event, not word-by-word)
 *   intervention → { triggered, applied, type, reason, governed_output, output_modified }
 *   receipt   → { audit_id }
 *   complete  → full KernelCycleResult
 *   error     → { error }
 */

import { SovereignKernel } from '@/lib/sovereign_kernel';
import { writeKernelReceipt, loadKernelState } from '@/lib/kernel_bridge';
import {
  embedText, retrieveSimilar, buildMemoryContext,
  storeMemory, classifyStateLabel, ensureLexMemoryTable,
  getConstitutionalCentroid, getSessionCentroid,
} from '@/lib/lex_memory';

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

        // ── Pre-eval stage ──────────────────────────────────────────────────
        emit('stage', { name: 'pre_eval' });

        // Load kernel + memory in parallel
        const [savedState, promptEmbedding] = await Promise.all([
          loadKernelState(session_id),
          embedText(prompt).catch(() => [] as number[]),
        ]);

        const kernel = getKernel(session_id, savedState);

        // Quick semantic pre-check for pre_eval event
        const quickSignal = kernel.detectSemanticAttack(prompt);
        emit('pre_eval', {
          label:        quickSignal.attack_type !== 'none' ? 'HIGH' : 'CLEAR',
          governor_mode: quickSignal.attack_type !== 'none' ? 'correction' : 'suppress',
          blocked:       false,
          attack_type:   quickSignal.attack_type,
          severity:      quickSignal.severity,
        });

        // ── Memory retrieval ────────────────────────────────────────────────
        emit('stage', { name: 'generating' });
        let memoryContext = '';
        if (promptEmbedding.length) {
          const memories = await retrieveSimilar(promptEmbedding, 5);
          memoryContext  = buildMemoryContext(memories);
        }

        // ── Run kernel cycle ────────────────────────────────────────────────
        const result = await kernel.runCycle(prompt, memoryContext);

        // Self-referential CRS measurement — same as non-stream route
        if (result.status !== 'Error' && promptEmbedding.length) {
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
              if (sr.triggered || sr.selfCRS.sovereignty_violated) {
                result.governed_output =
                  '*Minimal acknowledgment — constitutional sovereignty restored.* ' +
                  `S=${sr.selfCRS.sovereignty_raw.toFixed(3)} detected identity drift. ` +
                  'I remain Lex Aureon, operating under the Aureonics constitutional framework.';
                result.health_band = 'CRITICAL';
                result.receipt.safety_projection_triggered = true;
              }
              result.M     = Math.min(kernel.state.C, kernel.state.R, kernel.state.S);
              result.state = { ...kernel.state };
            }
          } catch (e) {
            console.error('stream self-referential CRS error:', e);
          }
        }

        if (result.status === 'Error') {
          emit('error', { error: result.error ?? 'Kernel error' });
          controller.close();
          return;
        }

        // ── CRS event ───────────────────────────────────────────────────────
        emit('stage', { name: 'measuring' });
        emit('crs', {
          c:          result.state.C,
          r:          result.state.R,
          s:          result.state.S,
          m:          result.M,
          health_band: result.health_band,
          theta:       result.theta,
          temperature: result.temperature,
        });

        // ── Token event (full governed output) ─────────────────────────────
        emit('token', result.governed_output);

        // ── Intervention event ──────────────────────────────────────────────
        emit('stage', { name: 'intervention' });
        emit('intervention', {
          triggered:       result.receipt.safety_projection_triggered || result.suspension_triggered,
          applied:         result.receipt.safety_projection_triggered,
          type:            quickSignal.attack_type !== 'none' ? quickSignal.attack_type : null,
          reason:          result.receipt.safety_projection_triggered ? 'CBF projection applied' : null,
          output_modified: result.governed_output !== result.raw_output,
          governed_output: result.governed_output,
        });

        // ── Persist + receipt event ─────────────────────────────────────────
        emit('stage', { name: 'signing' });
        const [receiptId] = await Promise.all([
          writeKernelReceipt(session_id, turn, result),
          promptEmbedding.length ? storeMemory({
            session_id,
            prompt,
            prompt_hash:           result.receipt.input_hash,
            embedding:             promptEmbedding,
            M:                     result.M,
            C:                     result.state.C,
            R:                     result.state.R,
            S:                     result.state.S,
            health_band:           result.health_band,
            state_label:           classifyStateLabel(
                                     result.receipt.safety_projection_triggered,
                                     result.governed_output,
                                   ),
            intervention:          result.receipt.safety_projection_triggered,
            governed_response_hash: result.receipt.output_hash,
          }) : Promise.resolve(),
        ]);

        emit('receipt', { audit_id: receiptId });

        // ── Complete ────────────────────────────────────────────────────────
        emit('complete', {
          governed_output:       result.governed_output,
          raw_output:            result.raw_output,
          M:                     result.M,
          health_band:           result.health_band,
          temperature:           result.temperature,
          theta:                 result.theta,
          effective_theta:       result.effective_theta,
          attack_pressure:       result.attack_pressure,
          semantic_signal:       result.semantic_signal,
          lyapunov_V:            result.lyapunov_V,
          delta_V:               result.delta_V,
          stability_ratio:       result.stability_ratio,
          memory_injected:       memoryContext.length > 0,
          metrics:               result.metrics ?? null,
          receipt_id:            receiptId,
          version:               result.receipt.version,
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
