import { CONSTITUTION } from '../constitution';
import { readCanonicalGovernanceState } from './canonical_governance_state';
import { advanceRecoveryPlane } from './recovery_runtime';

export type ClientRecoveryPulseStatus = 'ADVANCED' | 'WAITING' | 'BLOCKED' | 'UNAVAILABLE';

export interface ClientRecoveryPulseResult {
  status: ClientRecoveryPulseStatus;
  pulse?: Awaited<ReturnType<typeof advanceRecoveryPlane>>;
  recovery_state?: string;
  C?: number;
  R?: number;
  S?: number;
  M?: number;
  n_stable?: number;
  velocity?: number;
  sigma_viol?: number;
  canary_passed?: boolean;
  reason?: string;
  grants_write_authority: false;
}

/**
 * Authenticated client recovery facade. The caller supplies only a session
 * already resolved by the MCP transport; no client-provided session identifier
 * or authority claim is accepted here. Exactly one bounded pulse is attempted.
 */
export async function requestClientRecoveryPulse(sessionId: string): Promise<ClientRecoveryPulseResult> {
  if (!sessionId) {
    return { status: 'BLOCKED', reason: 'Authenticated route did not bind a canonical session.', grants_write_authority: false };
  }
  try {
    const before = await readCanonicalGovernanceState({ sessionId, actorId: 'recovery-service', capability: 'read' });
    if (!before.available || !before.state.trajectoryAvailable) {
      return { status: 'UNAVAILABLE', reason: before.reason ?? 'Canonical trajectory is unavailable.', grants_write_authority: false };
    }
    if (before.state.M < CONSTITUTION.TAU_FLOOR) {
      return { status: 'BLOCKED', recovery_state: before.state.recoveryState, M: before.state.M, reason: 'The quarantine floor is active; no recovery mutation is permitted.', grants_write_authority: false };
    }
    const pulse = await advanceRecoveryPlane(sessionId);
    const after = await readCanonicalGovernanceState({ sessionId, actorId: 'recovery-service', capability: 'read' });
    return {
      status: !after.available ? 'UNAVAILABLE' : pulse.advanced ? 'ADVANCED' : /wait|interval/i.test(pulse.reason) ? 'WAITING' : 'BLOCKED',
      pulse,
      recovery_state: after.state.recoveryState,
      C: after.state.C, R: after.state.R, S: after.state.S, M: after.state.M,
      n_stable: after.state.nStable, velocity: after.state.velocity,
      sigma_viol: after.state.sigmaViol, canary_passed: after.state.canaryPassed === true,
      grants_write_authority: false,
    };
  } catch {
    return { status: 'UNAVAILABLE', reason: 'Recovery service failed closed; canonical state was not certified.', grants_write_authority: false };
  }
}
