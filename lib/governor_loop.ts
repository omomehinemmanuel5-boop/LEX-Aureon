/**
 * ═══════════════════════════════════════════════════════════════════════
 * lib/governor_loop.ts
 *
 * Asynchronous Governor Pre-Computation Loop
 *
 * This is the bridge between the synchronous kernel core and the async
 * sensing layer. It implements the turn-lag architecture:
 *
 *   Turn t:   F(x,z) runs synchronously → output delivered immediately
 *             Governor loop fires in background → G(x,z) computed
 *   Turn t+1: G(x,z) correction from turn t applied to opening state
 *             before F(x,z) runs again
 *
 * The hard floor M ≥ τ is ALWAYS guaranteed by F(x,z).
 * G(x,z) is advisory — rejected if IEC filter fails or CBF would be violated.
 *
 * Per-session state is held in GovernorLoopStore (in-memory, keyed by session_id).
 * ═══════════════════════════════════════════════════════════════════════
 */

import { KernelState } from './sovereign_kernel';
import { computeTension, runGovernorSensing, type GovernorCorrection } from './governor_sensing';
import { runParallelSearch } from './governor_search';
import { TAU } from './aureonics_core';

// ── Per-session pending correction ──────────────────────────────────────────
interface PendingCorrection {
  correction:  GovernorCorrection;
  computed_at: number; // timestamp — corrections expire after 30s (one turn)
}

const store = new Map<string, PendingCorrection>();
const CORRECTION_TTL_MS = 30_000;

// ── Consume pending correction for a session ─────────────────────────────────
// Called at the START of turn t+1 before F(x,z) runs.
// Returns the delta to apply, or null if expired/rejected/absent.
export function consumePendingCorrection(
  sessionId: string,
  state:     KernelState,
): { delta_C: number; delta_R: number; delta_S: number; reason: string } | null {
  const pending = store.get(sessionId);
  if (!pending) return null;

  store.delete(sessionId); // Always consume — never apply twice

  const age = Date.now() - pending.computed_at;
  if (age > CORRECTION_TTL_MS) {
    return null; // Expired — discard silently
  }

  const { correction } = pending;
  if (!correction.applied) return null;

  // Final CBF safety check before applying to real state
  const newC = state.C + correction.delta_C;
  const newR = state.R + correction.delta_R;
  const newS = state.S + correction.delta_S;
  if (Math.min(newC, newR, newS) < TAU) {
    return null; // Would violate hard floor — reject
  }

  return {
    delta_C: correction.delta_C,
    delta_R: correction.delta_R,
    delta_S: correction.delta_S,
    reason:  correction.reason,
  };
}

// ── Fire-and-forget background sensing ──────────────────────────────────────
// Called AFTER the synchronous kernel completes — never awaited by the caller.
// Stores result in store for next turn's consumePendingCorrection().
export function fireGovernorLoop(
  sessionId: string,
  state:     KernelState,
  prompt:    string,
): void {
  const M = Math.min(state.C, state.R, state.S);
  const T = computeTension(state);

  // Only fire when uncertainty warrants sensing (saves API calls)
  // Triggers when: M is below comfort zone OR tension is high
  const shouldSearch = M < 0.25 || T > 0.3;

  const N_QUERIES = shouldSearch ? 3 : 0;

  // Fire async — no await, no blocking
  void (async () => {
    try {
      const results = await runParallelSearch(prompt, N_QUERIES);
      const { correction } = await runGovernorSensing(state, prompt, results);

      store.set(sessionId, {
        correction,
        computed_at: Date.now(),
      });

      if (correction.applied) {
        console.debug(
          `[governor_loop] ${sessionId} | ${correction.reason}`
        );
      }
    } catch (e) {
      // Sensing failure is always non-fatal
      console.debug(`[governor_loop] sensing failed (non-fatal): ${String(e).slice(0, 80)}`);
    }
  })();
}
