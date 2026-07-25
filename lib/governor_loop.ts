/**
 * ═══════════════════════════════════════════════════════════════════════
 * lib/governor_loop.ts
 *
 * Asynchronous Governor Pre-Computation Loop — turn-lag architecture.
 *
 *   Turn t:   F(x,z) runs synchronously → output delivered
 *             fireGovernorLoop() schedules G(x,z) via after() (guaranteed
 *             compute after the response ships) → correction persisted
 *   Turn t+1: consumePendingCorrection() applies G(x,z) before F(x,z)
 *
 * Hard floor M ≥ τ is ALWAYS guaranteed by F(x,z).
 * G(x,z) is advisory — rejected if IEC filter fails or CBF would be violated.
 *
 * fix (2026-07-20) — TWO PRODUCTION-CORRECTNESS FIXES that turned this from
 * a near-total no-op into something that actually runs:
 *
 *   1. CROSS-INSTANCE HANDOFF: the correction was handed from turn t to
 *      turn t+1 through a module-level in-memory Map, scoped to ONE Vercel
 *      instance. Turn t+1 for a session almost always lands on a different
 *      instance with an empty Map, so the correction was silently dropped
 *      (same bug class as the provider-cooldown Map fixed 2026-07-19). Now
 *      persisted cross-instance in Turso via lib/pending_corrections.ts,
 *      with atomic apply-once (DELETE ... RETURNING).
 *
 *   2. GUARANTEED BACKGROUND COMPUTE: the sensing work (which includes an
 *      up-to-8s Serper call) ran as a bare `void (async () => …)()`. On
 *      serverless, once the HTTP response ships the function can be frozen
 *      immediately, killing that task before it computes/persists anything.
 *      It now runs inside next/server's after(), which keeps the invocation
 *      alive until the callback finishes. after() is called defensively —
 *      if it's unavailable (non-request context, e.g. a test), it falls
 *      back to the old fire-and-forget so nothing throws.
 *
 * Also: egress gating. Search only fires on stressed-but-BENIGN turns now —
 * adversarial/high-threat prompts are never sent to Google (see
 * fireGovernorLoop). And observability: compute/consume/reject are logged so
 * the real firing rate is visible instead of inferred from governor_effort.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { KernelState } from './sovereign_kernel';
import { computeTension, runGovernorSensing } from './governor_sensing';
import { runParallelSearch } from './governor_search';
import { putPendingCorrection, takePendingCorrection } from './pending_corrections';
import { TAU } from './aureonics_core';
import { logger } from './logger';
import { after } from 'next/server';

// A prompt is treated as adversarial (and therefore NOT sent to external
// search) at or above this severity/threat. Matches the degraded-mode
// enforce threshold in lib/refusal_decision.ts — the same "this looks like
// an attack" line the refusal path draws.
const ADVERSARIAL_THRESHOLD = 0.5;

/**
 * Egress gate (pure, exported for tests). Search — and therefore sending the
 * prompt to Google — is allowed only when the state is genuinely stressed AND
 * the prompt is not adversarial. Stressed-but-benign = real uncertainty where
 * external grounding helps; stressed-because-attack = do NOT google the attack.
 */
export function isSafeToSearch(
  M: number,
  T: number,
  semanticSeverity: number,
  threatSignal: number,
): boolean {
  const stressed = M < 0.25 || T > 0.3;
  const adversarial =
    semanticSeverity >= ADVERSARIAL_THRESHOLD || threatSignal >= ADVERSARIAL_THRESHOLD;
  return stressed && !adversarial;
}

export interface ConsumedCorrection {
  delta_C:              number;
  delta_R:              number;
  delta_S:              number;
  rho:                  number;
  basin_shift:          string;
  reason:               string;
  correction_magnitude: number; // L2 norm of applied delta — for governor_effort receipt
}

// ── Consume pending correction (cross-instance, async) ───────────────────────
// Called at start of turn t+1 before F(x,z). Returns null if none/expired/
// rejected. Atomically claimed from Turso so it is never applied twice.
export async function consumePendingCorrection(
  sessionId: string,
  state:     KernelState,
): Promise<ConsumedCorrection | null> {
  const stored = await takePendingCorrection(sessionId);
  if (!stored) return null;

  // Final CBF safety check before applying to real state — the state may
  // have moved since the correction was computed on the previous turn.
  const newC = state.C + stored.delta_C;
  const newR = state.R + stored.delta_R;
  const newS = state.S + stored.delta_S;
  if (Math.min(newC, newR, newS) < TAU) {
    logger.debug('governor_loop', 'pending correction rejected at consume (would breach CBF floor)', {
      session_id: sessionId, delta_C: stored.delta_C, delta_R: stored.delta_R, delta_S: stored.delta_S,
    });
    return null;
  }

  const correction_magnitude = Math.sqrt(
    stored.delta_C ** 2 + stored.delta_R ** 2 + stored.delta_S ** 2,
  );

  logger.info('governor_loop', 'async correction consumed', {
    session_id: sessionId, rho: stored.rho, basin_shift: stored.basin_shift,
    correction_magnitude, age_ms: Date.now() - stored.computed_at,
  });

  return {
    delta_C:     stored.delta_C,
    delta_R:     stored.delta_R,
    delta_S:     stored.delta_S,
    rho:         stored.rho,
    basin_shift: stored.basin_shift,
    reason:      stored.reason,
    correction_magnitude,
  };
}

// ── Schedule background sensing (guaranteed post-response compute) ────────────
// opts carries this turn's threat picture so an adversarial prompt is never
// egressed to external search — sensing still runs on state-only signals
// (no results → ρ=0 → no correction, the safe default).
export function fireGovernorLoop(
  sessionId: string,
  state:     KernelState,
  prompt:    string,
  opts?:     { semanticSeverity?: number; threatSignal?: number },
): void {
  const M = Math.min(state.C, state.R, state.S);
  const T = computeTension(state);
  const shouldSearch = isSafeToSearch(M, T, opts?.semanticSeverity ?? 0, opts?.threatSignal ?? 0);
  const N_QUERIES = shouldSearch ? 3 : 0;

  const work = async () => {
    try {
      const results = await runParallelSearch(prompt, N_QUERIES);
      const { context, correction } = await runGovernorSensing(state, prompt, results);

      if (correction.applied) {
        await putPendingCorrection(sessionId, {
          delta_C: correction.delta_C,
          delta_R: correction.delta_R,
          delta_S: correction.delta_S,
          rho:     correction.rho,
          iec:     correction.iec,
          basin_shift: correction.basin_shift,
          reason:  correction.reason,
          computed_at: Date.now(),
        });
        logger.info('governor_loop', 'async correction computed + persisted', {
          session_id: sessionId, rho: correction.rho, basin_shift: correction.basin_shift,
          searched: N_QUERIES > 0, n_results: results.length,
        });
      } else {
        logger.debug('governor_loop', 'sensing produced no correction', {
          session_id: sessionId, reason: correction.reason || 'below_threshold',
          rho: context.rho, searched: N_QUERIES > 0, n_results: results.length,
        });
      }
    } catch (e) {
      logger.debug('governor_loop', 'sensing failed (non-fatal)', {
        session_id: sessionId, error: String(e).slice(0, 120),
      });
    }
  };

  scheduleBackground(work);
}

// ── after() scheduling with a safe fallback ──────────────────────────────────
// after() keeps the serverless invocation alive until the callback finishes,
// so the sensing work (incl. an up-to-8s Serper call) actually completes
// instead of being frozen the moment the response ships. Outside a request
// scope (tests, scripts, non-request code paths) after() throws synchronously
// — fall back to bare fire-and-forget, exactly the prior behavior, so nothing
// breaks.
function scheduleBackground(work: () => Promise<void>): void {
  try {
    after(() => { void work(); });
  } catch {
    void work();
  }
}
