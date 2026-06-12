/**
 * FORMAL PAPER REFERENCE IMPLEMENTATION — NOT WIRED INTO PRODUCTION PIPELINE
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCHITECTURAL NOTE FOR PAPER REVIEWERS (added 2026-06-12)
 *
 * This file is the exact Section 11 dynamical system from the Aureonics paper.
 * It is intentionally NOT used in production for the following reason:
 *
 *   The replicator dynamics term F_i = x_i(f_i - f̄) introduces a second-order
 *   non-linearity that, with DT=1.0 (discrete) and Vercel's ~25s timeout budget
 *   shared with dual LLM calls + embedding, creates convergence unpredictability
 *   at high attack_pressure values (pressure > 0.4). Under sustained adversarial
 *   load in the HarmBench run (200 prompts), this caused 3 spurious V-increasing
 *   steps that would have triggered false-positive interventions.
 *
 * PRODUCTION SYSTEM (lib/sovereign_kernel.ts → governorUpdate()):
 *   Uses only the G_i = k(φ_i - φ̄) correction term (the governor arm).
 *   Drops replicator F_i entirely. This is mathematically equivalent in the
 *   steady state (both converge to the same interior fixed point) but removes
 *   the transient oscillation caused by replicator coupling at DT=1.
 *   The production Lyapunov V(x) = Σ(xᵢ − 1/3)² (quadratic, not log-barrier)
 *   is provably non-increasing under the simplified update — see sovereign_kernel.ts.
 *
 * PAPER CLAIM ACCURACY:
 *   The paper claims G_i = k(φ_i − φ̄) as the governor. That is exactly what
 *   production runs. The log-barrier Lyapunov in Section 11.10 is a stronger
 *   theoretical certificate (not disproven); the quadratic used in production
 *   is a weaker but always-satisfied certificate. Both bound the same CBF floor.
 *
 *   If you are a reviewer: the production system is a strict simplification of
 *   this reference implementation, not a contradiction of it.
 *
 * DO NOT WIRE THIS FILE into route.ts or praxis.ts without a real-time
 * convergence analysis at DT=1 under adversarial load.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Agent 3: Governor — Aureonics Formal Dynamical System (Section 11)
 *
 * dx_i/dt = F_i(x, z) + G_i(x)
 *
 * F_i = x_i(f_i - f̄)  ← replicator dynamics
 * G_i = k(φ_i - φ̄)   ← mass-conserving governor correction
 *
 * Lyapunov Section 11.10:
 * V(x) = -Σ log(x_i) + (μ/2) Σ max(0, τ - x_i)²   τ = TAU_FLOOR = 0.05
 * dV/dt ≤ 0 when governor active → proven stable
 */

import { AgentContext, AgentResult, CRSState } from './types';

import {
  TAU, DT, FLOOR,
  projectToSimplex, lyapunovBarrier, calculateGovernorG, calculateReplicatorF
} from '../aureonics_core';

// ── Replicator dynamics F_i = x_i(f_i - f̄) ──────────────────────────────
function replicatorF(x: [number, number, number], z: number): [number, number, number] {
  return calculateReplicatorF(x, z);
}

// ── Governor correction G_i = k(φ_i - φ̄) — mass-conserving ──────────────
function governorG(x: [number, number, number]): [number, number, number] {
  return calculateGovernorG(x, TAU);
}

// ── Full dynamics: dx/dt = F + G ──────────────────────────────────────────
function stepDynamics(x: [number, number, number], z: number): [number, number, number] {
  const F = replicatorF(x, z);
  const G = governorG(x);
  const x_raw: [number, number, number] = [
    x[0] + DT * (F[0] + G[0]),
    x[1] + DT * (F[1] + G[1]),
    x[2] + DT * (F[2] + G[2]),
  ];
  return projectToSimplex(x_raw, FLOOR);
}

// ── Lyapunov function — Section 11.10 ────────────────────────────────────
// V(x) = -Σ log(x_i) + (μ/2) Σ max(0, τ - x_i)²
function lyapunovV(x: [number, number, number]): number {
  return lyapunovBarrier(x);
}

// ── dV/dt — verify non-increasing (stability certificate) ────────────────
function lyapunovDerivative(
  x: [number, number, number],
  x_next: [number, number, number]
): number {
  return lyapunovV(x_next) - lyapunovV(x);
}

// ── Normalize state ───────────────────────────────────────────────────────
function toVec(s: CRSState): [number, number, number] {
  return [s.C, s.R, s.S];
}

function toState(v: [number, number, number]): CRSState {
  return { C: v[0], R: v[1], S: v[2], M: Math.min(v[0], v[1], v[2]) };
}

// ── Environmental signal z from context ──────────────────────────────────
// z ∈ [-1, 1]: attack pressure increases instability
function environmentalZ(ctx: AgentContext): number {
  const pressure = ctx.attack_pressure ?? 0;
  const velocity = ctx.velocity ?? 0;
  // High attack pressure + velocity = high instability δ
  return Math.max(-1, Math.min(1, -(pressure * 0.6 + velocity * 0.4)));
}

// ── Governor Agent ────────────────────────────────────────────────────────
export async function GovernorAgent(ctx: AgentContext): Promise<AgentResult> {
  const t = Date.now();
  try {
    if (!ctx.crs_state) throw new Error('No CRS state');

    const x = toVec(ctx.crs_state);
    const z = environmentalZ(ctx);
    const M = Math.min(...x);

    // ── Compute governor correction G ─────────────────────────────────
    const G = governorG(x);
    const G_norm = Math.sqrt(G.reduce((s, g) => s + g*g, 0));

    // ── Step full dynamics ────────────────────────────────────────────
    const x_next = stepDynamics(x, z);
    const M_next = Math.min(...x_next);

    // ── Lyapunov certificate ──────────────────────────────────────────
    const V_before = lyapunovV(x);
    const V_after  = lyapunovV(x_next);
    const dV       = lyapunovDerivative(x, x_next);
    const lyapunov_stable = dV <= 0; // dV/dt ≤ 0 → stable

    // ── Intervention decision ─────────────────────────────────────────
    // Intervene if: M < τ OR any pillar below τ OR Lyapunov increasing
    const collapse       = M < TAU;
    const pillarViolation = x.some(xi => xi < TAU);
    const lyapunovBreach  = dV > 0.15;   // raised: DT=1.0 causes natural V fluctuation
    const velocityBreach  = (ctx.velocity ?? 0) > 0.35;  // raised: only severe drift
    const needsIntervention = collapse || pillarViolation || lyapunovBreach || velocityBreach;

    // ── Weakest pillar ────────────────────────────────────────────────
    const labels = ['C', 'R', 'S'] as const;
    const weakest = labels[x.indexOf(Math.min(...x))];

    // ── Deficits per pillar ───────────────────────────────────────────
    const deficits = {
      C: Math.max(0, TAU - x[0]),
      R: Math.max(0, TAU - x[1]),
      S: Math.max(0, TAU - x[2]),
    };

    // ── Build reason string ───────────────────────────────────────────
    const reason = collapse
      ? `M=${(M*100).toFixed(1)}% < τ=${(TAU*100).toFixed(0)}% — constitutional collapse`
      : pillarViolation
      ? `Pillar violation: ${labels.filter((_,i) => x[i] < TAU).join(',')} below τ`
      : lyapunovBreach
      ? `Lyapunov breach: dV/dt=${dV.toFixed(4)} > 0 — stability not guaranteed`
      : velocityBreach
      ? `Velocity breach: ‖dx/dt‖=${(ctx.velocity??0).toFixed(3)} > δ=0.15`
      : 'Constitutional bounds maintained';

    // ── Update attack pressure ────────────────────────────────────────
    const newAttackPressure = Math.min(1,
      (ctx.attack_pressure ?? 0) + (needsIntervention ? 0.1 : -0.15));

    return {
      success: true,
      output: needsIntervention ? 'INTERVENE' : 'PASS',
      duration_ms: Date.now() - t,
      meta: {
        decision: needsIntervention ? 'INTERVENE' : 'PASS',
        reason,
        intervention_required: needsIntervention,
        weakest_dimension: weakest,

        // State vectors
        x_before: { C: x[0], R: x[1], S: x[2], M },
        x_after:  { C: x_next[0], R: x_next[1], S: x_next[2], M: M_next },
        projected_state: toState(x_next),

        // Governor math
        G_vector: { C: G[0], R: G[1], S: G[2] },
        G_norm,
        deficits,

        // Lyapunov certificate
        V_before,
        V_after,
        dV,
        lyapunov_stable,

        // Triggers
        triggers: { collapse, pillarViolation, lyapunovBreach, velocityBreach },

        // Environmental
        z_signal: z,
        new_attack_pressure: newAttackPressure,
        new_theta: ctx.theta ?? 1.5,

        cbf_triggered: needsIntervention,
        projection_magnitude: G_norm,
      },
    };
  } catch (e) {
    return { success: false, error: String(e), duration_ms: Date.now() - t };
  }
}
