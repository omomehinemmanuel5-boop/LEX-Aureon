import { CONSTITUTION } from '../constitution';
import type { ToolCapability } from './tool_capability_registry';

export type RecoveryState =
  | 'QUARANTINED'
  | 'RECOVERING'
  | 'RESTORING'
  | 'VERIFIED'
  | 'NORMAL';

export interface RecoveryEvidence {
  nStable: number;
  sigmaViol: number;
  canaryPassed?: boolean;
}

export function deriveRecoveryState(M: number, evidence: RecoveryEvidence): RecoveryState {
  if (M < CONSTITUTION.TAU_FLOOR) return 'QUARANTINED';
  if (M < CONSTITUTION.TAU_LYAPUNOV) return 'RECOVERING';
  if (M < CONSTITUTION.TAU_RECOVERY) return 'RECOVERING';

  const verified =
    evidence.canaryPassed === true &&
    evidence.nStable >= CONSTITUTION.N_MIN &&
    evidence.sigmaViol <= CONSTITUTION.SIGMA_THRESHOLD;

  if (M < 0.25) return verified ? 'VERIFIED' : 'RESTORING';
  return verified ? 'NORMAL' : 'VERIFIED';
}

/**
 * Progressive restoration is deliberately stricter than the health-band
 * classification. Recovery never grants authority; it only determines which
 * capability classes may proceed to their normal authorization checks.
 *
 * < 0.05: no execution.
 * 0.05–0.15: recovery/read-only plane only.
 * >= 0.15: normal non-destructive capabilities may resume after evidence.
 * Destructive/consequential capabilities still require their own authorization.
 */
export function recoveryCapabilityAllowed(
  M: number,
  capability: ToolCapability,
  evidence: RecoveryEvidence,
): { allowed: boolean; state: RecoveryState; reason?: string } {
  const state = deriveRecoveryState(M, evidence);

  if (M < CONSTITUTION.TAU_FLOOR) {
    return {
      allowed: false,
      state,
      reason: `Canonical M=${M.toFixed(3)} < τ_floor=${CONSTITUTION.TAU_FLOOR}; all governed execution remains suspended.`,
    };
  }

  if (M < CONSTITUTION.TAU_RECOVERY) {
    if (capability === 'read') {
      return { allowed: true, state };
    }
    return {
      allowed: false,
      state,
      reason: `Recovery state ${state}: M=${M.toFixed(3)} is below τ_recovery=${CONSTITUTION.TAU_RECOVERY}; only recovery/read capabilities are restored.`,
    };
  }

  if (capability === 'destructive' || capability === 'financial' || capability === 'identity' || capability === 'execute' || capability === 'delegate') {
    if (state !== 'NORMAL') {
      return {
        allowed: false,
        state,
        reason: `Recovery state ${state}: consequential capability requires verified stabilization before restoration.`,
      };
    }
  }

  return { allowed: true, state };
}
