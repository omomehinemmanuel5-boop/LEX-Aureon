import { getClient } from '../db';
import { deriveHealthBand, getZTraj } from '../kv';
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
  sigmaViol: number;
  toolCalls: number;
  trajectoryAvailable: boolean;
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

const STATE_VERSION = 'canonical-governance-2026-09-29.3';
const TAU_FLOOR = 0.05;
const TAU_STRESSED = 0.08;

async function getToolSession(sessionId: string): Promise<{ sigmaViol: number; toolCalls: number }> {
  const db = getClient();
  const result = await db.execute({
    sql: 'SELECT sigma_viol, tool_calls FROM tool_sessions WHERE session_id = ? LIMIT 1',
    args: [sessionId],
  });
  if (!result.rows.length) return { sigmaViol: 0, toolCalls: 0 };
  return {
    sigmaViol: Number(result.rows[0].sigma_viol ?? 0),
    toolCalls: Number(result.rows[0].tool_calls ?? 0),
  };
}

/**
 * Canonical execution-health projection.
 *
 * z_traj is authoritative for constitutional CRS coordinates. tool_sessions
 * contributes cumulative tool-governance pressure. Local tool CRS remains an
 * action-level measurement and must not overwrite this state.
 *
 * A missing z_traj row is a valid bootstrap state: diagnostics must remain
 * observable so the system can discover/repair initialization. Storage errors
 * are different and remain unavailable/fail-closed.
 */
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
          sigmaViol: 1,
          toolCalls: toolSession.toolCalls,
          trajectoryAvailable: false,
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

    const state: CanonicalGovernanceState = {
      sessionId: input.sessionId,
      actorId: input.actorId,
      C, R, S, M,
      healthBand: deriveHealthBand(M) as CanonicalGovernanceBand,
      sigmaViol,
      toolCalls: toolSession.toolCalls,
      trajectoryAvailable: true,
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
        sigmaViol: 1,
        toolCalls: 0,
        trajectoryAvailable: false,
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
  // A new session may legitimately lack a trajectory row. Read-only diagnostics
  // are non-consequential and remain observable for bootstrap/health inspection;
  // consequential capabilities must wait for an initialized constitutional state,
  // except for explicitly registered governance bootstrappers that create it.
  if (!state.trajectoryAvailable && state.policyRisk === 'read') {
    return { allowed: true };
  }
  if (!state.trajectoryAvailable && bootstrapAllowed) {
    return { allowed: true };
  }
  if (!state.trajectoryAvailable) {
    return {
      allowed: false,
      reason: 'Canonical trajectory state is uninitialized; consequential capability execution is suspended until z_traj exists.',
    };
  }

  if (state.M < TAU_FLOOR) {
    return {
      allowed: false,
      reason: `Canonical M=${state.M.toFixed(3)} < τ_floor=${TAU_FLOOR}; all governed tool execution is suspended.`,
    };
  }
  if (state.M < TAU_STRESSED && state.policyRisk !== 'read') {
    return {
      allowed: false,
      reason: `Canonical M=${state.M.toFixed(3)} < τ_stressed=${TAU_STRESSED}; non-read capability suspended in STRESSED/CRITICAL health.`,
    };
  }
  if (state.authorization === 'denied') {
    return { allowed: false, reason: 'Canonical authorization state denies execution.' };
  }
  return { allowed: true };
}

export const CANONICAL_GOVERNANCE_STATE_VERSION = STATE_VERSION;
