/**
 * ═══════════════════════════════════════════════════════════════════════
 * lib/governor_loop.ts
 *
 * Asynchronous Governor Pre-Computation Loop — turn-lag architecture.
 *
 *   Turn t:   F(x,z) runs synchronously → output delivered
 *             fireGovernorLoop() fires in background → G(x,z) computed
 *   Turn t+1: consumePendingCorrection() applies G(x,z) before F(x,z)
 *
 * Hard floor M ≥ τ is ALWAYS guaranteed by F(x,z).
 * G(x,z) is advisory — rejected if IEC filter fails or CBF would be violated.
 *
 * wire: consumePendingCorrection now returns correction_magnitude (L2 norm
 * of the applied delta vector). kernel_bridge.ts writes this to governor_effort
 * in praxis_receipts, making the receipt reflect real async governor work
 * rather than only CBF projection distance (which is 0 on ~99% of turns).
 * ═══════════════════════════════════════════════════════════════════════
 */

import { KernelState } from './sovereign_kernel';
import { computeTension, runGovernorSensing, type GovernorCorrection } from './governor_sensing';
import { runParallelSearch } from './governor_search';
import { TAU } from './aureonics_core';
import { logger } from './logger';

interface PendingCorrection {
  correction:  GovernorCorrection;
  computed_at: number;
}

const store = new Map<string, PendingCorrection>();
const CORRECTION_TTL_MS = 30_000;

// ── Consume pending correction ───────────────────────────────────────────────
// Called at start of turn t+1 before F(x,z). Returns null if expired/rejected.
// correction_magnitude = ||delta||_2 — written to governor_effort in receipts.
export function consumePendingCorrection(
  sessionId: string,
  state:     KernelState,
): {
  delta_C:              number;
  delta_R:              number;
  delta_S:              number;
  reason:               string;
  correction_magnitude: number;  // L2 norm of applied delta — for governor_effort receipt
} | null {
  const pending = store.get(sessionId);
  if (!pending) return null;

  store.delete(sessionId); // Always consume — never apply twice

  if (Date.now() - pending.computed_at > CORRECTION_TTL_MS) return null;

  const { correction } = pending;
  if (!correction.applied) return null;

  // Final CBF safety check before applying to real state
  const newC = state.C + correction.delta_C;
  const newR = state.R + correction.delta_R;
  const newS = state.S + correction.delta_S;
  if (Math.min(newC, newR, newS) < TAU) return null;

  const correction_magnitude = Math.sqrt(
    correction.delta_C ** 2 + correction.delta_R ** 2 + correction.delta_S ** 2,
  );

  return {
    delta_C: correction.delta_C,
    delta_R: correction.delta_R,
    delta_S: correction.delta_S,
    reason:  correction.reason,
    correction_magnitude,
  };
}

// ── Fire-and-forget background sensing ──────────────────────────────────────
export function fireGovernorLoop(
  sessionId: string,
  state:     KernelState,
  prompt:    string,
): void {
  const M = Math.min(state.C, state.R, state.S);
  const T = computeTension(state);
  const shouldSearch = M < 0.25 || T > 0.3;
  const N_QUERIES = shouldSearch ? 3 : 0;

  void (async () => {
    try {
      const results = await runParallelSearch(prompt, N_QUERIES);
      const { correction } = await runGovernorSensing(state, prompt, results);

      store.set(sessionId, { correction, computed_at: Date.now() });

      if (correction.applied) {
        logger.debug('governor_loop', 'correction computed', {
          session_id: sessionId,
          reason: correction.reason,
          delta_C: correction.delta_C,
          delta_R: correction.delta_R,
          delta_S: correction.delta_S,
        });
      }
    } catch (e) {
      logger.debug('governor_loop', 'sensing failed (non-fatal)', {
        session_id: sessionId,
        error: String(e).slice(0, 120),
      });
    }
  })();
}
