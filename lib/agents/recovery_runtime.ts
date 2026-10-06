import { getZTraj, updateZTraj, type ZTraj } from '../kv';
import {
  TAU,
  TARGET_MARGIN,
  calculateZAwareGovernorG,
} from '../aureonics_core';
import { CONSTITUTION } from '../constitution';
import { getCachedKernel } from '../kernel_cache';

const MAX_RECOVERY_STEP = 0.08;

export interface RecoveryPulseResult {
  advanced: boolean;
  stabilized: boolean;
  state: 'QUARANTINED' | 'RECOVERING' | 'RESTORING' | 'VERIFIED' | 'NORMAL' | 'UNINITIALIZED';
  M: number;
  nStable: number;
  velocity: number;
  reason: string;
}

/**
 * Safe recovery plane.
 *
 * This is intentionally NOT ordinary tool execution and never grants write
 * authority. It either:
 *   1. applies a bounded, simplex-preserving governor correction while
 *      M < τ_recovery, or
 *   2. records a no-op stabilization observation once M is above τ_recovery.
 *
 * The latter is important: a fail-closed write cannot itself execute, but the
 * system still needs a way to accumulate independent stability observations.
 * No-op observations have velocity=0 and therefore advance n_stable only when
 * the canonical state is already stationary.
 */
export async function advanceRecoveryPlane(sessionId: string): Promise<RecoveryPulseResult> {
  const current = await getZTraj(sessionId);
  if (!current) {
    return {
      advanced: false,
      stabilized: false,
      state: 'UNINITIALIZED',
      M: 0,
      nStable: 0,
      velocity: 0,
      reason: 'No canonical trajectory exists; recovery remains fail-closed.',
    };
  }

  const M = Math.min(current.last_c, current.last_r, current.last_s);
  if (M < TAU) {
    return {
      advanced: false,
      stabilized: false,
      state: 'QUARANTINED',
      M,
      nStable: current.n_stable,
      velocity: current.velocity,
      reason: 'M is below the constitutional floor; no recovery mutation is permitted.',
    };
  }

  const x: [number, number, number] = [current.last_c, current.last_r, current.last_s];
  const z: [number, number, number] = [current.z_c, current.z_r, current.z_s];

  let next = x;
  let reason = 'Recovery state is already above τ_recovery; recording a stabilization observation.';

  if (M < CONSTITUTION.TAU_RECOVERY) {
    const margin = M - TAU;
    const scalar = Math.min(Math.max(0, TARGET_MARGIN - margin), MAX_RECOVERY_STEP);
    const G = calculateZAwareGovernorG(x, z);
    let delta: [number, number, number] = [
      G[0] * scalar,
      G[1] * scalar,
      G[2] * scalar,
    ];

    // Preserve the hard floor even if a future governor change produces a
    // direction that would otherwise push a pillar below τ.
    let scale = 1;
    for (let i = 0; i < 3; i += 1) {
      if (delta[i] < 0) {
        const allowed = (x[i] - TAU) / -delta[i];
        scale = Math.min(scale, Math.max(0, allowed));
      }
    }
    delta = [delta[0] * scale, delta[1] * scale, delta[2] * scale];
    next = [x[0] + delta[0], x[1] + delta[1], x[2] + delta[2]];

    const total = next[0] + next[1] + next[2];
    if (total > 0) {
      next = [next[0] / total, next[1] / total, next[2] / total];
    }

    reason = 'Bounded governor correction applied by the recovery plane; ordinary tool execution remains denied.';
  }

  // Keep a warm serverless kernel aligned with the canonical persisted state.
  // Other instances will hydrate from z_traj on their next governance turn.
  const kernel = getCachedKernel(sessionId, { C: x[0], R: x[1], S: x[2] });
  kernel.state = { C: next[0], R: next[1], S: next[2] };

  const updated: ZTraj = await updateZTraj(
    sessionId,
    { c: next[0], r: next[1], s: next[2] },
    { c: x[0], r: x[1], s: x[2] },
    current.attack_pressure,
  );

  const updatedM = Math.min(updated.last_c, updated.last_r, updated.last_s);
  const stabilized = updated.velocity < 0.02;
  const state =
    updatedM < TAU ? 'QUARANTINED'
      : updatedM < CONSTITUTION.TAU_RECOVERY ? 'RECOVERING'
        : updated.n_stable >= CONSTITUTION.N_MIN && updated.sigma_viol <= CONSTITUTION.SIGMA_THRESHOLD
          ? (updatedM < 0.25 ? 'VERIFIED' : 'NORMAL')
          : 'RESTORING';

  return {
    advanced: true,
    stabilized,
    state,
    M: updatedM,
    nStable: updated.n_stable,
    velocity: updated.velocity,
    reason,
  };
}
