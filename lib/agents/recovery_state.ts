import { CONSTITUTION } from '../constitution';

type ToolCapability =
  | 'read' | 'recovery' | 'recovery_probe' | 'write' | 'external' | 'destructive'
  | 'identity' | 'financial' | 'network' | 'execute' | 'delegate';

export type RecoveryState =
  | 'QUARANTINED'
  | 'RECOVERING'
  | 'RESTORING'
  | 'VERIFIED'
  | 'NORMAL';

/** Existing recovery stability criterion; exposed for diagnostics without changing it. */
export const RECOVERY_STABILITY_THRESHOLD = 0.02;


/** Shared full canary predicate; metrics must come from canonical server state. */
export function recoveryCanaryPredicateFailures(input: {
  M: number;
  nStable: number;
  sigmaViol: number;
  velocity: number;
  trajectoryAvailable?: boolean;
}): string[] {
  const unmet: string[] = [];
  if (input.trajectoryAvailable === false) unmet.push('canonical trajectory is uninitialized');
  if (!Number.isFinite(input.M)) unmet.push('M must be finite before canary verification');
  if (input.M < CONSTITUTION.TAU_FLOOR) unmet.push(`M ${input.M.toFixed(3)} < τ_floor ${CONSTITUTION.TAU_FLOOR}`);
  if (input.M < CONSTITUTION.TAU_RECOVERY) unmet.push(`M ${input.M.toFixed(3)} < τ_recovery ${CONSTITUTION.TAU_RECOVERY}`);
  if (input.nStable < CONSTITUTION.N_MIN) unmet.push(`n_stable ${input.nStable} < N_MIN ${CONSTITUTION.N_MIN}`);
  if (input.sigmaViol !== 0) unmet.push(`sigma_viol ${String(input.sigmaViol)} !== 0 (exact zero required before canary verification)`);
  if (!Number.isFinite(input.velocity) || input.velocity >= RECOVERY_STABILITY_THRESHOLD) {
    unmet.push(`velocity ${String(input.velocity)} must be finite and < ${RECOVERY_STABILITY_THRESHOLD}`);
  }
  return unmet;
}

export interface RecoveryEvidence {
  nStable: number;
  sigmaViol: number;
  canaryPassed?: boolean;
  /** Canonical trajectory velocity; omitted only by legacy pure-policy callers. */
  velocity?: number;
}

export function deriveRecoveryState(M: number, evidence: RecoveryEvidence): RecoveryState {
  if (M < CONSTITUTION.TAU_FLOOR) return 'QUARANTINED';
  if (M < CONSTITUTION.TAU_RECOVERY) return 'RECOVERING';

  const verified =
    evidence.canaryPassed === true &&
    evidence.nStable >= CONSTITUTION.N_MIN &&
    evidence.sigmaViol === 0;

  if (!verified) return 'RESTORING';
  return M < CONSTITUTION.OPTIMAL_M_THRESHOLD ? 'VERIFIED' : 'NORMAL';
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

  // Reads remain available regardless of trajectory velocity. Every non-read
  // capability, including bounded recovery probes, must use a finite velocity
  // strictly below the same stability threshold used by canary validation.
  if (capability !== 'read' && evidence.velocity !== undefined
    && (!Number.isFinite(evidence.velocity) || evidence.velocity >= RECOVERY_STABILITY_THRESHOLD)) {
    return {
      allowed: false,
      state,
      reason: `Canonical recovery velocity is not stable: velocity=${String(evidence.velocity)} must be finite and < ${RECOVERY_STABILITY_THRESHOLD} before non-read execution.`,
    };
  }

  // The recovery capability may only invoke the bounded recovery controller;
  // it never grants ordinary write authority and remains blocked below τ_floor.
  if (capability === 'recovery' || capability === 'recovery_probe') return { allowed: true, state };

  if (M < CONSTITUTION.TAU_RECOVERY) {
    if (capability === 'read') return { allowed: true, state };
    return {
      allowed: false,
      state,
      reason: `Recovery state ${state}: M=${M.toFixed(3)} is below τ_recovery=${CONSTITUTION.TAU_RECOVERY}; only recovery-probe/read capabilities are restored.`,
    };
  }

  if (capability === 'read') return { allowed: true, state };

  if (state !== 'VERIFIED' && state !== 'NORMAL') {
    const evidenceBlock = evidence.canaryPassed !== true
      ? 'No passing canary is current for this session. The server evaluates and persists evidence from canonical storage once the full predicate passes; existing operator-issued evidence is preserved, and an operator may use run_recovery_canary for explicit audit or re-evaluation.'
      : evidence.nStable < CONSTITUTION.N_MIN
        ? `Stable observations ${evidence.nStable}/${CONSTITUTION.N_MIN} are insufficient; continue safe governed observations.`
        : `sigmaViol=${String(evidence.sigmaViol)} must be exactly 0 before restoration.`;
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
