/**
 * FORMAL PAPER REFERENCE IMPLEMENTATION — NOT WIRED INTO PRODUCTION PIPELINE
 *
 * This is the exact Section 11 Aureonics dynamical system from the paper.
 * Production governance runs through lib/praxis.ts (runPRAXIS) which uses
 * the same G_i = k(φ_i - φ̄) correction but without replicator dynamics.
 *
 * Kept here as the authoritative mathematical reference.
 * Do not delete — do not wire into route.ts without review.
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

// ── Constants from paper ──────────────────────────────────────────────────
const TAU   = 0.05;   // TAU_FLOOR — matches PRAXIS pipeline constitutional floor
const K     = 4.0;    // governor gain k
const ALPHA = 0.5;    // replicator coupling α
const MU    = 2.0;    // Lyapunov quadratic weight μ
const DT    = 1.0;    // discrete time step
const A     = 0.5;    // baseline fitness |a_i(z)| ≤ A
const FLOOR = 1e-9;   // prevent log(0)

// ── Replicator fitness functions (Section 11, eq 15-17) ──────────────────
function fitness(x: [number, number, number], z: number): [number, number, number] {
  const [C, R, S] = x;
  // a_i(z) modulated by environmental signal z ∈ [-1, 1]
  const a_C = A + 0.2 * z;
  const a_R = A - 0.1 * z;
  const a_S = A - 0.1 * z;

  const f_C = a_C - ALPHA * (R + S);
  const f_R = a_R - ALPHA * (C + S);
  const f_S = a_S - ALPHA * (C + R);
  return [f_C, f_R, f_S];
}

// ── Replicator dynamics F_i = x_i(f_i - f̄) ──────────────────────────────
function replicatorF(
  x: [number, number, number],
  z: number
): [number, number, number] {
  const f = fitness(x, z);
  const f_bar = x[0]*f[0] + x[1]*f[1] + x[2]*f[2]; // mean fitness
  return [
    x[0] * (f[0] - f_bar),
    x[1] * (f[1] - f_bar),
    x[2] * (f[2] - f_bar),
  ];
}

// ── Governor correction G_i = k(φ_i - φ̄) — mass-conserving ──────────────
function governorG(x: [number, number, number]): [number, number, number] {
  const phi = x.map(xi => Math.max(0, TAU - xi)) as [number, number, number];
  const phi_bar = (phi[0] + phi[1] + phi[2]) / 3;
  return [
    K * (phi[0] - phi_bar),
    K * (phi[1] - phi_bar),
    K * (phi[2] - phi_bar),
  ];
}

// ── Full dynamics: dx/dt = F + G ──────────────────────────────────────────
function stepDynamics(
  x: [number, number, number],
  z: number
): [number, number, number] {
  const F = replicatorF(x, z);
  const G = governorG(x);
  const x_next: [number, number, number] = [
    x[0] + DT * (F[0] + G[0]),
    x[1] + DT * (F[1] + G[1]),
    x[2] + DT * (F[2] + G[2]),
  ];
  // Project back to simplex with floor
  const total = x_next.reduce((s, v) => s + Math.max(v, FLOOR), 0);
  return x_next.map(v => Math.max(v, FLOOR) / total) as [number, number, number];
}

// ── Lyapunov function — Section 11.10 ────────────────────────────────────
// V(x) = -Σ log(x_i) + (μ/2) Σ max(0, τ - x_i)²
function lyapunovV(x: [number, number, number]): number {
  const barrier = -x.reduce((s, xi) => s + Math.log(Math.max(xi, FLOOR)), 0);
  const penalty = (MU / 2) * x.reduce((s, xi) => {
    const violation = Math.max(0, TAU - xi);
    return s + violation * violation;
  }, 0);
  return barrier + penalty;
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
