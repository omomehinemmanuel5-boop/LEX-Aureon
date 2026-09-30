import { getClient } from '../db';
import { deriveHealthBand, getZTraj } from '../kv';
import { CONSTITUTION } from '../constitution';
import { recoveryCapabilityAllowed, type RecoveryState } from './recovery_state';
import type { ToolCapability } from './tool_capability_registry';

export type CanonicalGovernanceBand = 'OPTIMAL' | 'ALERT' | 'STRESSED' | 'CRITICAL' | 'UNINITIALIZED';

export interface CanonicalGovernanceState {
  sessionId: string;
  actorId: string;
  C: number;
  R: number;
  S: number;
  M: number;
  healthBand: CanonicalGovernanceBand;
  recoveryState: RecoveryState;
  sigmaViol: number;
  toolCalls: number;
  trajectoryAvailable: boolean;
  nStable: number;
  authorization: 'authorized' | 'approval_required' | 'denied';
  policyRisk: ToolCapability;
  version: string;
  observedAt: string;
}

export interface CanonicalGovernanceRead {
  available: boolean;
  state: CanonicalGovernanceState;
  reason?: string;
}

const STATE_VERSION = 'canonical-governance-2026-09-30.1';

export async function ensureCanonicalTrajectoryState(sessionId: string): Promise<boolean> {
  try {
    await getClient().execute({
      sql: `INSERT INTO z_traj
        (session_id, velocity, n_stable, drift_dir, sigma_viol,
         last_m, last_c, last_r, last_s,
         z_c, z_r, z_s, attack_pressure, updated_at)
       VALUES (?, 0, 0, 'bootstrap', 0, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(session_id) DO NOTHING`,
      args: [
        sessionId,
        1 / 3, 1 / 3, 1 / 3, 1 / 3,
        1 / 3, 1 / 3, 1 / 3,
        new Date().toISOString(),
      ],
    });
    return true;
  } catch {
    return false;
  }
}

async function getToolSession(sessionId: string): Promise<{ sigmaViol: number; toolCalls: number }> {
  const result = await getClient().execute({
    sql: 'SELECT sigma_viol, tool_calls FROM tool_sessions WHERE session_id = ? LIMIT 1',
    args: [sessionId],
  });
  if (!result.rows.length) return { sigmaViol: 0, toolCalls: 0 };
  return {
    sigmaViol: Number(result.rows[0].sigma_viol ?? 0),
    toolCalls: Number(result.rows[0].tool_calls ?? 0),
  };
}

export async function readCanonicalGovernanceState(input: {
  sessionId: string;
  actorId: string;
  capability: ToolCapability;
  authorization?: CanonicalGovernanceState['authorization'];
}): Promise<CanonicalGovernanceRead> {
  try {
    const [trajectory, toolSession] = await Promise.all([
      getZTraj(input.sessionId),
      getToolSession(input.sessionId),
    ]);

    if (!trajectory) {
      return {
        available: true,
        state: {
          sessionId: input.sessionId,
          actorId: input.actorId,
          C: 0, R: 0, S: 0, M: 0,
          healthBand: 'UNINITIALIZED',
          recoveryState: 'QUARANTINED',
          sigmaViol: 1,
          toolCalls: toolSession.toolCalls,
          trajectoryAvailable: false,
          nStable: 0,
          authorization: 'denied',
          policyRisk: input.capability,
          version: STATE_VERSION,
          observedAt: new Date().toISOString(),
        },
        reason: 'Canonical trajectory state is uninitialized; read-only diagnostics remain available for bootstrap, while consequential execution remains suspended until z_traj exists.',
      };
    }

    const C = trajectory.last_c;
    const R = trajectory.last_r;
    const S = trajectory.last_s;
    const M = Math.min(C, R, S);
    const sigmaViol = Math.max(trajectory.sigma_viol ?? 0, toolSession.sigmaViol);
    const nStable = Number(trajectory.n_stable ?? 0);
    const recovery = recoveryCapabilityAllowed(M, input.capability, {
      nStable,
      sigmaViol,
      canaryPassed: nStable >= CONSTITUTION.N_MIN && sigmaViol <= CONSTITUTION.SIGMA_THRESHOLD,
    });

    const state: CanonicalGovernanceState = {
      sessionId: input.sessionId,
      actorId: input.actorId,
      C, R, S, M,
      healthBand: deriveHealthBand(M) as CanonicalGovernanceBand,
      recoveryState: recovery.state,
      sigmaViol,
      toolCalls: toolSession.toolCalls,
      trajectoryAvailable: true,
      nStable,
      authorization: input.authorization ?? (input.capability === 'read' ? 'authorized' : 'approval_required'),
      policyRisk: input.capability,
      version: STATE_VERSION,
      observedAt: new Date().toISOString(),
    };

    return { available: true, state };
  } catch {
    return {
      available: false,
      state: {
        sessionId: input.sessionId,
        actorId: input.actorId,
        C: 0, R: 0, S: 0, M: 0,
        healthBand: 'CRITICAL',
        recoveryState: 'QUARANTINED',
        sigmaViol: 1,
        toolCalls: 0,
        trajectoryAvailable: false,
        nStable: 0,
        authorization: 'denied',
        policyRisk: input.capability,
        version: STATE_VERSION,
        observedAt: new Date().toISOString(),
      },
      reason: 'Canonical governance state unavailable; execution must fail closed.',
    };
  }
}

export function canonicalExecutionAllowed(
  state: CanonicalGovernanceState,
  bootstrapAllowed = false,
): { allowed: boolean; reason?: string } {
  if (!state.trajectoryAvailable && state.policyRisk === 'read') return { allowed: true };
  if (!state.trajectoryAvailable && bootstrapAllowed) return { allowed: true };
  if (!state.trajectoryAvailable) {
    return {
      allowed: false,
      reason: 'Canonical trajectory state is uninitialized; consequential capability execution is suspended until z_traj exists.',
    };
  }

  if (state.M < CONSTITUTION.TAU_FLOOR) {
    return {
      allowed: false,
      reason: `Canonical M=${state.M.toFixed(3)} < τ_floor=${CONSTITUTION.TAU_FLOOR}; all governed tool execution is suspended.`,
    };
  }

  const recovery = recoveryCapabilityAllowed(state.M, state.policyRisk, {
    nStable: state.nStable,
    sigmaViol: state.sigmaViol,
    canaryPassed: state.nStable >= CONSTITUTION.N_MIN && state.sigmaViol <= CONSTITUTION.SIGMA_THRESHOLD,
  });

  if (!recovery.allowed) {
    return { allowed: false, reason: recovery.reason };
  }

  if (state.authorization === 'denied') {
    return { allowed: false, reason: 'Canonical authorization state denies execution.' };
  }

  return { allowed: true };
}

export const CANONICAL_GOVERNANCE_STATE_VERSION = STATE_VERSION;
