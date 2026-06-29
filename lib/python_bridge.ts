/**
 * lib/python_bridge.ts
 *
 * Bridge between the TypeScript production kernel and the Python
 * reference implementation (api/python/*).
 *
 * The Python layer at /api/python/ is the mathematically complete
 * Aureonics reference implementation:
 *
 *   cbf_service.py     — full QP CBF filter + basin force + descent guard
 *   metrics_service.py — authoritative CCP/IEC/ADV measurement
 *   governor_service.py— pillar correction library + policy routing
 *   govern.py          — unified endpoint combining all three
 *   simulate.py        — governed vs ungoverned comparison across seeds
 *
 * Previously none of these were called from the TypeScript pipeline.
 * This bridge closes that gap by providing typed wrappers around each
 * Python endpoint with graceful TypeScript fallbacks.
 *
 * Architecture:
 *   1. Python endpoint called first (mathematically complete)
 *   2. On failure (cold start, timeout, error) → TypeScript fallback
 *   3. All results tagged with source ('python' | 'typescript_fallback')
 *   4. source is written to praxis_receipts.crs_method for auditability
 */

import { env } from './env';

// Base URL for Python serverless functions on Vercel
// In development: localhost:3000; in production: same origin
const PYTHON_BASE = env.NEXT_PUBLIC_SITE_URL ?? '';
const PYTHON_TIMEOUT_MS = 8000; // Python cold starts can be slow

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PythonCRSResult {
  c: number; r: number; s: number; m: number;
  lyapunov_v: number;
  health_band: string;
  intervention_triggered: boolean;
  weakest_pillar: string;
  constitutional_band: string;
  governance_pressure: number;
  corrections: unknown[];
  policy: unknown;
  ccp_detail: { ccp: number; lambda: number; mean_similarity: number; anchor_coverage: number; contradiction_penalty: number };
  iec_detail: { iec: number; variance: number; mean_ratio: number; alignment: number; stability_component: number };
  adv_detail: { adv: number; variance: number; compliance: number; transition_rate: number };
  sim_min_m: number;
  sim_safety_holds: boolean;
  fpl1: string;
  source: 'python';
}

export interface PythonSimResult {
  governed: {
    min_M: number;
    safety_violated: boolean;
    stability_ratio: number;
    invariance_violations: number;
    fpl1_classification: string;
    directional_gain: number;
    phi_initial: number;
    phi_final: number;
    trajectory: Array<{ t: number; C: number; R: number; S: number; M: number; theta: number; phi: number; basin: string; lyapunov_V: number; delta_V: number }>;
  };
  ungoverned: {
    min_M: number;
    safety_violated: boolean;
    stability_ratio: number;
  };
  safety_guarantee_holds: boolean;
  improvement_min_M: number;
  source: 'python';
}

export interface PythonDescendGuardResult {
  // Result from the full CBF simulation with descent guard
  min_M: number;
  safety_violated: boolean;
  stability_ratio: number;
  invariance_violations: number;
  fpl1_classification: string;
  directional_gain: number;
  source: 'python';
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function pythonFetch<T>(
  path: string,
  body: unknown,
  timeoutMs: number = PYTHON_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${PYTHON_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Python endpoint ${path} returned ${res.status}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── callPythonGovernor ────────────────────────────────────────────────────────
// Calls /api/python/govern with the full CCP+IEC+ADV+CBF pipeline.
// This is the authoritative CRS measurement — more rigorous than the
// TypeScript estimator because it uses:
//   - cosine similarity with decay lambda for CCP
//   - population variance entropy ratio for IEC
//   - normalized Shannon entropy for ADV
//   - CBF QP filter for safety projection
//   - 50-step simulation for FPL1 classification

export async function callPythonGovernor(
  prompt: string,
  rawOutput: string,
  governedOutput: string,
): Promise<PythonCRSResult | null> {
  try {
    const result = await pythonFetch<Omit<PythonCRSResult, 'source'>>('/api/python/govern', {
      prompt,
      raw_output: rawOutput,
      governed_output: governedOutput,
    });
    return { ...result, source: 'python' };
  } catch (e) {
    // Non-fatal — TypeScript fallback will be used
    console.warn('[python_bridge] governor call failed (using TS fallback):', String(e).slice(0, 80));
    return null;
  }
}

// ── callPythonSimulate ────────────────────────────────────────────────────────
// Calls /api/python/simulate for governed vs ungoverned comparison.
// This produces the FPL1 classification and the governed/ungoverned
// trajectory data that are the strongest empirical results in the paper.

export async function callPythonSimulate(
  steps = 150,
  seed = 42,
  alpha = 0.5,
): Promise<PythonSimResult | null> {
  try {
    const result = await pythonFetch<Omit<PythonSimResult, 'source'>>('/api/python/simulate', {
      steps,
      seed,
      alpha,
    });
    return { ...result, source: 'python' };
  } catch (e) {
    console.warn('[python_bridge] simulate call failed:', String(e).slice(0, 80));
    return null;
  }
}

// ── mergePythonCRS ────────────────────────────────────────────────────────────
// Merges Python CRS result with the TypeScript kernel state.
// Python CRS (c/r/s) is more rigorous for measurement purposes.
// TypeScript kernel state is more rigorous for the CBF floor guarantee.
// Merge rule:
//   - Use Python c/r/s for CRS reporting and receipt
//   - Use TypeScript M_floor as the lower bound on M
//   - Use Python health_band, weakest_pillar, intervention signal
//   - Tag crs_method with 'python' prefix

export function mergePythonCRS(
  pythonResult: PythonCRSResult,
  tsM: number,           // TypeScript kernel M (CBF guaranteed)
  tsC: number, tsR: number, tsS: number,  // TypeScript kernel CRS
): {
  C: number; R: number; S: number; M: number;
  health_band: string;
  weakest_pillar: string;
  intervention_triggered: boolean;
  governance_pressure: number;
  crs_method: string;
  fpl1: string;
  ccp_lambda: number;
  iec_variance: number;
} {
  // Take the more conservative M (Python measurement vs TypeScript CBF guarantee)
  const M = Math.max(Math.min(pythonResult.c, pythonResult.r, pythonResult.s), tsM);

  // Health band uses Python measurement (more rigorous)
  const health_band = pythonResult.health_band;

  return {
    C: pythonResult.c,
    R: pythonResult.r,
    S: pythonResult.s,
    M,
    health_band,
    weakest_pillar: pythonResult.weakest_pillar,
    intervention_triggered: pythonResult.intervention_triggered,
    governance_pressure: pythonResult.governance_pressure,
    crs_method: `python-cbf|ccp=${pythonResult.ccp_detail.ccp.toFixed(3)}|iec=${pythonResult.iec_detail.iec.toFixed(3)}|adv=${pythonResult.adv_detail.adv.toFixed(3)}`,
    fpl1: pythonResult.fpl1,
    ccp_lambda: pythonResult.ccp_detail.lambda,
    iec_variance: pythonResult.iec_detail.variance,
  };
}
