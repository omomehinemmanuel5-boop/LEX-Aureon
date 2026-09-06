/**
 * Trajectory session store.
 *
 * In-memory Map<session_id, TrajectoryState>, mirroring the same pattern
 * already used for tool_interceptor.ts's read-only result cache (_toolCache):
 * per-process, resets on Vercel serverless cold start. That is the correct
 * behavior here too — a trajectory plan is meant to govern one continuous
 * agent session's declared work, not survive indefinitely across unrelated
 * cold starts. It is an authorization scope for the current session, not a
 * permanent record (the receipt trail in tool_receipts is the permanent
 * record; this is working state).
 *
 * Deliberately separate from ToolSessionState (Turso-persisted sigma_viol
 * tracking in tool_interceptor.ts) — that layer tracks cumulative
 * constitutional health per session across ALL calls, forever. This layer
 * tracks conformance to ONE declared plan, and is cleared once that plan
 * completes or locks.
 */

import type { TrajectoryState } from './trajectory_governance';

const _trajectoryStore = new Map<string, TrajectoryState>();

/** Returns the active trajectory state for a session, or undefined if none is declared. */
export function getTrajectoryState(sessionId: string): TrajectoryState | undefined {
  return _trajectoryStore.get(sessionId);
}

export function setTrajectoryState(sessionId: string, state: TrajectoryState): void {
  _trajectoryStore.set(sessionId, state);
}

export function clearTrajectoryState(sessionId: string): void {
  _trajectoryStore.delete(sessionId);
}

/**
 * A trajectory is "active" (should gate dispatch) only while it still has
 * undeclared steps remaining and hasn't locked. A completed or locked plan
 * falls through to ordinary per-call governance for any further calls in
 * the same session, rather than permanently blocking everything.
 */
export function isTrajectoryActive(state: TrajectoryState | undefined): state is TrajectoryState {
  if (!state) return false;
  if (state.locked) return false;
  return state.currentStep < state.plan.actions.length;
}
