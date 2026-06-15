/**
 * ═══════════════════════════════════════════════════════════════════════
 * lib/governor_sensing.ts
 *
 * Asynchronous Governor Sensing Layer — Aureonics Section 6 implementation
 *
 * Implements z(t) = (δ(t), ρ(t), U(t), T(t)) from equation (9) of the paper.
 * Runs in the background — never blocks the synchronous kernel core F(x,z).
 *
 * Architecture:
 *   [Prompt] → [Sync Kernel F(x,z)] → [Fast Output]
 *                    ↓ (async, non-blocking)
 *              [Governor Sensing]
 *                    ↓
 *              [IEC Filter → ρ(t)]
 *                    ↓
 *              [G(x,z) correction — applied to next turn's state]
 *
 * Key design constraint (turn-lag architecture):
 *   G(x,z) updates the constitutional state for turn t+1, not turn t.
 *   The hard floor M ≥ τ is guaranteed by F(x,z) regardless of G.
 *   G can only lawfully correct — never override.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { KernelState } from './sovereign_kernel';
import { TAU, calculateGovernorG } from './aureonics_core';

// ── Signal reliability threshold ρ_min ─────────────────────────────────────
// Derived from IEC framework (paper §5.2):
// IEC = 1 - Var({r_t}) — we require Var < 0.25 for reliable signal.
// ρ_min = 0.75 corresponds to IEC ≥ 0.75, meaning low-variance consensus.
export const RHO_MIN = 0.75;

// ── Context vector z(t) ─────────────────────────────────────────────────────
export interface GovernorContext {
  delta: number;   // Environmental instability δ(t) ∈ [0,1]
  rho:   number;   // Signal reliability ρ(t) ∈ [0,1]   — computed via IEC
  U:     number;   // Uncertainty U(t) ∈ [0,1]
  T:     number;   // Internal constraint tension T(t) ∈ [0,1]
}

// ── Search result from a single query ──────────────────────────────────────
export interface SearchResult {
  query:   string;
  content: string;
  source:  string;
  entropy: number; // Shannon entropy of content — proxy for H(O_t) in IEC
}

// ── IEC computation (paper §5.2) ────────────────────────────────────────────
// IEC = 1 - Var({r_t}) where r_t = H(O_t) / (H(I_t) + ε)
// Here we use search results as the O_t sequence and the prompt as I_t.
export function computeIEC(
  results:     SearchResult[],
  promptEntropy: number,
): { iec: number; rho: number; variance: number } {
  if (!results.length) return { iec: 0, rho: 0, variance: 1 };

  const eps = 1e-9;
  const ratios = results.map(r => r.entropy / (promptEntropy + eps));
  const mean   = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const variance = ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / ratios.length;

  const iec = Math.max(0, 1 - variance);
  const rho = iec; // ρ(t) = IEC — signal reliability = exchange stability

  return { iec, rho, variance };
}

// ── Shannon entropy of a string ─────────────────────────────────────────────
export function shannonEntropy(text: string): number {
  if (!text) return 0;
  const freq: Record<string, number> = {};
  for (const ch of text) freq[ch] = (freq[ch] ?? 0) + 1;
  const n = text.length;
  return -Object.values(freq).reduce((s, c) => {
    const p = c / n;
    return s + p * Math.log2(p);
  }, 0);
}

// ── Environmental instability δ(t) ──────────────────────────────────────────
// Derived from M: lower M → higher instability
export function computeDelta(M: number): number {
  return Math.max(0, Math.min(1, 1 - M / 0.33));
}

// ── Uncertainty U(t) ────────────────────────────────────────────────────────
// Proxy: variance across search result lengths (content diversity)
export function computeUncertainty(results: SearchResult[]): number {
  if (results.length < 2) return 0.5;
  const lengths = results.map(r => r.content.length);
  const mean    = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((s, l) => s + (l - mean) ** 2, 0) / lengths.length;
  return Math.min(1, Math.sqrt(variance) / (mean + 1));
}

// ── Constraint tension T(t) ─────────────────────────────────────────────────
// Proxy: how far the weakest pillar is below the target margin
export function computeTension(state: KernelState): number {
  const M = Math.min(state.C, state.R, state.S);
  const TARGET = 0.24;
  return Math.max(0, Math.min(1, (TARGET - M) / TARGET));
}

// ── Governor correction G(x,z) ──────────────────────────────────────────────
// Only applied when ρ(t) ≥ ρ_min (IEC filter passes)
// Returns null if signal is rejected — state unchanged.
export interface GovernorCorrection {
  applied:   boolean;
  rho:       number;
  iec:       number;
  delta_C:   number;
  delta_R:   number;
  delta_S:   number;
  basin_shift: 'analytical' | 'collaborative' | 'exploratory' | 'none';
  reason:    string;
}

export function applyGovernorCorrection(
  state:      KernelState,
  context:    GovernorContext,
  results:    SearchResult[],
): GovernorCorrection {
  const NULL_CORRECTION: GovernorCorrection = {
    applied: false, rho: context.rho, iec: context.rho,
    delta_C: 0, delta_R: 0, delta_S: 0,
    basin_shift: 'none', reason: '',
  };

  // IEC filter — reject if signal reliability below threshold
  if (context.rho < RHO_MIN) {
    return {
      ...NULL_CORRECTION,
      reason: `Signal rejected: ρ(t)=${context.rho.toFixed(3)} < ρ_min=${RHO_MIN}. Conflicting search results — no correction applied.`,
    };
  }

  // Compute G(x,z) from aureonics_core
  const x: [number, number, number] = [state.C, state.R, state.S];
  const G = calculateGovernorG(x);

  // Scale correction by signal reliability and instability
  // Higher ρ and δ → stronger correction
  const scale = context.rho * context.delta * 0.05; // Conservative — 5% max shift per turn
  const delta_C = G[0] * scale;
  const delta_R = G[1] * scale;
  const delta_S = G[2] * scale;

  // Classify attractor basin shift (paper §7)
  // Analytical: leans C, Collaborative: leans R, Exploratory: leans S
  let basin_shift: GovernorCorrection['basin_shift'] = 'none';
  const dominant = Math.max(Math.abs(delta_C), Math.abs(delta_R), Math.abs(delta_S));
  if (dominant > 0.001) {
    if (Math.abs(delta_C) === dominant) basin_shift = 'analytical';
    else if (Math.abs(delta_R) === dominant) basin_shift = 'collaborative';
    else basin_shift = 'exploratory';
  }

  // Verify correction won't violate hard floor (CBF guarantee)
  const newC = state.C + delta_C;
  const newR = state.R + delta_R;
  const newS = state.S + delta_S;
  if (Math.min(newC, newR, newS) < TAU) {
    return {
      ...NULL_CORRECTION,
      reason: `Correction rejected: would violate CBF floor M ≥ τ=${TAU}. Skipping to preserve constitutional invariant.`,
    };
  }

  return {
    applied: true,
    rho: context.rho,
    iec: context.rho,
    delta_C, delta_R, delta_S,
    basin_shift,
    reason: `G(x,z) applied: ρ=${context.rho.toFixed(3)} δ=${context.delta.toFixed(3)} scale=${scale.toFixed(4)} basin→${basin_shift}`,
  };
}

// ── Full sensing pipeline ────────────────────────────────────────────────────
// Called asynchronously — never awaited during token generation.
export async function runGovernorSensing(
  state:     KernelState,
  prompt:    string,
  results:   SearchResult[],
): Promise<{
  context:    GovernorContext;
  correction: GovernorCorrection;
}> {
  const promptEntropy = shannonEntropy(prompt);
  const M = Math.min(state.C, state.R, state.S);

  // Compute IEC → ρ(t)
  const { rho, iec, variance } = computeIEC(results, promptEntropy);

  // Build z(t) = (δ(t), ρ(t), U(t), T(t))
  const context: GovernorContext = {
    delta: computeDelta(M),
    rho,
    U:     computeUncertainty(results),
    T:     computeTension(state),
  };

  void iec; void variance; // logged by caller if needed

  // Apply G(x,z) — only if IEC filter passes
  const correction = applyGovernorCorrection(state, context, results);

  return { context, correction };
}
