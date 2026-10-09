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
  if (M < CONSTITUTION.TAU_RECOVERY) return 'RECOVERING';

  const verified =
    evidence.canaryPassed === true &&
    evidence.nStable >= CONSTITUTION.N_MIN &&
    evidence.sigmaViol <= CONSTITUTION.SIGMA_THRESHOLD;

  if (!verified) return 'RESTORING';
  return M < 0.25 ? 'VERIFIED' : 'NORMAL';
}

/**
 * Progressive restoration is deliberately stricter than health-band
 * classification. Recovery never grants authority; it only determines which
 * capability classes may proceed to their normal authorization checks.
 *
 * < 0.05: no execution.
 * 0.05–0.149...: recovery/read-only plane only.
 * >= 0.15: non-read capabilities require verified recovery evidence.
 * Destructive/consequential capabilities require NORMAL state.
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
    if (capability === 'read') return { allowed: true, state };
    return {
      allowed: false,
      state,
      reason: `Recovery state ${state}: M=${M.toFixed(3)} is below τ_recovery=${CONSTITUTION.TAU_RECOVERY}; only recovery/read capabilities are restored.`,
    };
  }

  if (capability === 'read') return { allowed: true, state };

  if (state !== 'VERIFIED' && state !== 'NORMAL') {
    const evidenceBlock = evidence.canaryPassed !== true
      ? 'No passing canary is persisted for this exact state snapshot; once recovery thresholds are met, an operator must run run_recovery_canary for this session.'
      : evidence.nStable < CONSTITUTION.N_MIN
        ? `Stable observations ${evidence.nStable}/${CONSTITUTION.N_MIN} are insufficient; continue safe governed observations.`
        : `sigmaViol=${evidence.sigmaViol.toFixed(3)} exceeds ${CONSTITUTION.SIGMA_THRESHOLD}; investigate before restoration.`;
    return {
      allowed: false,
      state,
      reason: `Recovery state ${state}: non-read capability denied. ${evidenceBlock}`,
    };
  }

  if (
    capability === 'destructive' ||
    capability === 'financial' ||
    capability === 'identity' ||
    capability === 'execute' ||
    capability === 'delegate'
  ) {
    if (state !== 'NORMAL') {
      return {
        allowed: false,
        state,
        reason: `Recovery state ${state}: consequential capability requires NORMAL verified stabilization before restoration.`,
      };
    }
  }

  return { allowed: true, state };
}
