/**
 * POST /api/lex/kernel
 * Runs the SovereignKernel governance cycle.
 * Parallel to /api/lex/run — does not replace it.
 */

import { NextResponse } from 'next/server';
import { SovereignKernel } from '@/lib/sovereign_kernel';
import { writeKernelReceipt, loadKernelState } from '@/lib/kernel_bridge';

// Session-scoped kernel instances (warm across requests in same serverless instance)
const kernelCache = new Map<string, SovereignKernel>();

function getKernel(sessionId: string, savedState?: { C: number; R: number; S: number } | null): SovereignKernel {
  if (!kernelCache.has(sessionId)) {
    const k = new SovereignKernel();
    if (savedState) k.state = savedState;
    kernelCache.set(sessionId, k);
  }
  return kernelCache.get(sessionId)!;
}

export async function POST(req: Request) {
  let body: { prompt?: string; session_id?: string; turn?: number };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { prompt, session_id, turn = 1 } = body;
  if (!prompt?.trim()) return NextResponse.json({ error: 'prompt required' }, { status: 400 });
  if (!session_id?.trim()) return NextResponse.json({ error: 'session_id required' }, { status: 400 });

  // Load persisted state from Turso if kernel is cold
  const savedState = await loadKernelState(session_id);
  const kernel = getKernel(session_id, savedState);

  const result = await kernel.runCycle(prompt);

  if (result.status === 'Error') {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Persist to Turso
  const receiptId = await writeKernelReceipt(session_id, turn, result);

  return NextResponse.json({
    governed_output:     result.governed_output,
    raw_output:          result.raw_output,
    M:                   result.M,
    health_band:         result.health_band,
    temperature:         result.temperature,
    theta:               result.theta,
    effective_theta:     result.effective_theta,
    attack_pressure:     result.attack_pressure,
    adv_gain:            result.adv_gain,
    semantic_signal:     result.semantic_signal,
    lyapunov_V:          result.lyapunov_V,
    delta_V:             result.delta_V,
    stability_ratio:     result.stability_ratio,
    suspension_triggered: result.suspension_triggered,
    epsilon_injected:    result.epsilon_injected,
    projection_triggered: result.receipt.safety_projection_triggered,
    projection_magnitude: result.projection_magnitude,
    state:               result.state,
    receipt_id:          receiptId,
    invariance_violations: result.invariance_violations,
    version:             'SovereignKernel-TS-v2',
  });
}

export async function GET() {
  return NextResponse.json({
    name:    'Lex Aureon SovereignKernel API',
    version: 'v2',
    endpoint: '/api/lex/kernel',
    innovations: [
      'Constitutional temperature control — LLM inference temperature varies with M',
      'Dual LLM calls — raw and governed response per turn',
      'Adaptive gain θ(t) — correction strength scales with constitutional stress',
      'Two-level hysteresis — soft floor (0.08) + hard CBF floor (0.05)',
      'Semantic transducer — CRS deltas applied before LLM call',
      'Shannon entropy ADV scoring — diverse responses increase S',
      'Epsilon injection — prevents frozen attractors below M=0.15',
    ],
  });
}
