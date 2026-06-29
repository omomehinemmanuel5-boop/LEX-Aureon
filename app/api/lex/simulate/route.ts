/**
 * GET/POST /api/lex/simulate
 *
 * Exposes the Python governed-vs-ungoverned CBF simulation as a live
 * API endpoint. This is the Aureonics paper's primary empirical result:
 *
 *   Governed: all seeds safe (min M ≥ τ = 0.05)
 *   Ungoverned: all seeds collapse (min M → 0.00, 24–132 violations)
 *   FPL1 classification: LYAPUNOV STABLE + FORWARD INVARIANT
 *
 * Delegates to api/python/simulate.py which runs:
 *   - Full replicator dynamics (F)
 *   - Adaptive governor correction G_i = θ(t)·k(φ_i − φ̄)
 *   - Basin force from Φ gradient (mass-conserving)
 *   - Descent guard (halves force when Φ would increase)
 *   - CBF QP safety filter (applied LAST, guarantees M ≥ τ for all t)
 *
 * Parameters (GET or POST body):
 *   steps  — number of simulation steps (default 150, max 300)
 *   seed   — random seed (default 42)
 *   alpha  — replicator competition coupling (default 0.5)
 *
 * Returns governed and ungoverned trajectories + safety summary.
 */

import { NextResponse } from 'next/server';
import { callPythonSimulate } from '@/lib/python_bridge';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const steps = Math.min(parseInt(url.searchParams.get('steps') ?? '150'), 300);
  const seed  = parseInt(url.searchParams.get('seed')  ?? '42');
  const alpha = parseFloat(url.searchParams.get('alpha') ?? '0.5');

  return runSimulate(steps, seed, alpha);
}

export async function POST(req: Request) {
  let body: { steps?: number; seed?: number; alpha?: number } = {};
  try { body = await req.json(); } catch { /* use defaults */ }

  const steps = Math.min(body.steps ?? 150, 300);
  const seed  = body.seed  ?? 42;
  const alpha = body.alpha ?? 0.5;

  return runSimulate(steps, seed, alpha);
}

async function runSimulate(steps: number, seed: number, alpha: number) {
  const result = await callPythonSimulate(steps, seed, alpha);

  if (!result) {
    return NextResponse.json(
      { error: 'Python simulation unavailable (cold start or timeout). Retry in 10s.' },
      { status: 503 },
    );
  }

  // Return a clean summary alongside the full trajectory data
  return NextResponse.json({
    // Summary (paper Table 1 row)
    governed_min_M:          result.governed.min_M,
    ungoverned_min_M:        result.ungoverned.min_M,
    safety_guarantee_holds:  result.safety_guarantee_holds,
    improvement_min_M:       result.improvement_min_M,
    fpl1_classification:     result.governed.fpl1_classification,
    stability_ratio:         result.governed.stability_ratio,
    invariance_violations:   result.governed.invariance_violations,
    directional_gain:        result.governed.directional_gain,
    phi_initial:             result.governed.phi_initial,
    phi_final:               result.governed.phi_final,

    // Full trajectories for visualization
    governed_trajectory:     result.governed.trajectory,
    source:                  'python-cbf-reference',
    params:                  { steps, seed, alpha },
  });
}
