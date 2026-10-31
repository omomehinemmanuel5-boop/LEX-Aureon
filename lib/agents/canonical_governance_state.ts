import { getClient } from '../db';
import { deriveHealthBand, getZTraj } from '../kv';
import { CONSTITUTION } from '../constitution';
import { RECOVERY_STABILITY_THRESHOLD, recoveryCapabilityAllowed, type RecoveryState } from './recovery_state';
import { readRecoveryCanaryEvidence, recoverySnapshotFingerprint } from './recovery_canary_evidence';
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
  velocity?: number;
  toolCalls: number;
  trajectoryAvailable: boolean;
  nStable: number;
  canaryPassed?: boolean;
  canaryReceiptId?: string | null;
  canaryEvidenceId?: number | null;
  stateFingerprint?: string | null;
  trajectoryUpdatedAt?: string | null;
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
export interface CanonicalGovernanceReadInput {
  sessionId: string;
  actorId: string;
  capability: ToolCapability;
  authorization?: CanonicalGovernanceState['authorization'];
  /** Historical tool-session telemetry is not part of authorization hot paths. */
  includeToolTelemetry?: boolean;
}
const STATE_VERSION = 'canonical-governance-2026-10-10.1';

export type CanonicalTrajectoryBootstrapResult =
  | { status: 'created' | 'existing'; sessionId: string; verified: true }
  | { status: 'unverified'; sessionId: string; verified: false; reason: string };

function isVerifiedCanonicalTrajectory(
  trajectory: Awaited<ReturnType<typeof getZTraj>>,
  sessionId: string,
): boolean {
  if (!trajectory || trajectory.session_id !== sessionId) return false;
  return [trajectory.velocity, trajectory.n_stable, trajectory.sigma_viol,
    trajectory.last_m, trajectory.last_c, trajectory.last_r, trajectory.last_s,
    trajectory.updated_at].every(value => value !== null && value !== undefined
      && (typeof value === 'string' ? value.length > 0 : Number.isFinite(value)));
}

export async function ensureCanonicalTrajectoryState(
  sessionId: string,
): Promise<CanonicalTrajectoryBootstrapResult> {
  try {
    const insert = await getClient().execute({
      sql: `INSERT INTO z_traj
        (session_id, velocity, n_stable, drift_dir, sigma_viol,
         last_m, last_c, last_r, last_s,
         z_c, z_r, z_s, attack_pressure, updated_at)
       VALUES (?, 0, 0, 'bootstrap', 0, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(session_id) DO NOTHING
       RETURNING session_id`,
      args: [sessionId, 1 / 3, 1 / 3, 1 / 3, 1 / 3, 1 / 3, 1 / 3, 1 / 3, new Date().toISOString()],
    });
    const trajectory = await getZTraj(sessionId);
    if (!isVerifiedCanonicalTrajectory(trajectory, sessionId)) {
      return { status: 'unverified', sessionId, verified: false, reason: 'Canonical trajectory insert/read-back did not produce a valid row for the requested session.' };
    }
    const created = insert.rows.some(row => row.session_id === sessionId);
    return { status: created ? 'created' : 'existing', sessionId, verified: true };
  } catch {
    return { status: 'unverified', sessionId, verified: false, reason: 'Canonical trajectory storage or read-back failed.' };
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

export async function readCanonicalGovernanceState(input: CanonicalGovernanceReadInput): Promise<CanonicalGovernanceRead> {
  try {
    const [trajectory, toolSession] = await Promise.all([
      getZTraj(input.sessionId),
      input.includeToolTelemetry
        ? getToolSession(input.sessionId)
        : Promise.resolve({ sigmaViol: 0, toolCalls: 0 }),
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
          velocity: 0,
          toolCalls: toolSession.toolCalls,
          trajectoryAvailable: false,
          nStable: 0,
          canaryPassed: false,
          canaryReceiptId: null,
          stateFingerprint: null,
          trajectoryUpdatedAt: null,
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
    // z_traj is the only authorization authority. tool_sessions is retained
    // here only for historical call-count telemetry and must not elevate or
    // otherwise alter canonical recovery state.
    const sigmaViol = Number(trajectory.sigma_viol ?? 0);
    const nStable = Number(trajectory.n_stable ?? 0);
    const velocity = Number(trajectory.velocity ?? 0);
    const trajectoryUpdatedAt = String(trajectory.updated_at ?? '');
    const stateFingerprint = recoverySnapshotFingerprint({
      sessionId: input.sessionId,
      policyVersion: STATE_VERSION,
      C, R, S, nStable, sigmaViol,
      trajectoryUpdatedAt,
    });
    const canary = await readRecoveryCanaryEvidence(input.sessionId, stateFingerprint, { sessionId: input.sessionId, stateVersion: STATE_VERSION, stateFingerprint, M, sigmaViol, nStable, velocity });
    const recovery = recoveryCapabilityAllowed(M, input.capability, {
      nStable,
      sigmaViol,
      canaryPassed: canary.passed,
    });

    const state: CanonicalGovernanceState = {
      sessionId: input.sessionId,
      actorId: input.actorId,
      C, R, S, M,
      healthBand: deriveHealthBand(M) as CanonicalGovernanceBand,
      recoveryState: recovery.state,
      sigmaViol,
      velocity,
      toolCalls: toolSession.toolCalls,
      trajectoryAvailable: true,
      nStable,
      canaryPassed: canary.passed,
      canaryReceiptId: canary.receiptId,
      canaryEvidenceId: canary.evidenceId ?? null,
      stateFingerprint,
      trajectoryUpdatedAt: trajectoryUpdatedAt || null,
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
          velocity: 0,
        toolCalls: 0,
        trajectoryAvailable: false,
        nStable: 0,
        canaryPassed: false,
        canaryReceiptId: null,
        stateFingerprint: null,
        trajectoryUpdatedAt: null,
        authorization: 'denied',
        policyRisk: input.capability,
        version: STATE_VERSION,
        observedAt: new Date().toISOString(),
      },
      reason: 'Canonical governance state unavailable; execution must fail closed.',
    };
  }
}

/**
 * Request-local state reader. It never survives a request boundary and never
 * caches across sessions. Call refresh() after a mutation that can change the
 * canonical trajectory or recovery evidence.
 */
export function createCanonicalGovernanceStateReader() {
  const cache = new Map<string, CanonicalGovernanceRead>();
  const keyFor = (input: CanonicalGovernanceReadInput): string => JSON.stringify([
    input.sessionId,
    input.actorId,
    input.capability,
    input.authorization ?? '',
    input.includeToolTelemetry === true,
  ]);
  const read = async (input: CanonicalGovernanceReadInput): Promise<CanonicalGovernanceRead> => {
    const key = keyFor(input);
    const cached = cache.get(key);
    if (cached) return cached;
    const result = await readCanonicalGovernanceState(input);
    cache.set(key, result);
    return result;
  };
  const refresh = async (input: CanonicalGovernanceReadInput): Promise<CanonicalGovernanceRead> => {
    const key = keyFor(input);
    const result = await readCanonicalGovernanceState(input);
    cache.set(key, result);
    return result;
  };
  return { read, refresh };
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

  // Defense in depth: the canonical reader validates velocity while loading
  // canary evidence, but this exported gate must not trust a caller-assembled or
  // stale state object that claims a canary passed while velocity is unstable.
  const requiresRecoveryProof =
    state.M >= CONSTITUTION.TAU_RECOVERY &&
    state.canaryPassed === true &&
    state.policyRisk !== 'read' &&
    state.policyRisk !== 'recovery' &&
    state.policyRisk !== 'recovery_probe';
  if (
    requiresRecoveryProof &&
    (!Number.isFinite(state.velocity) || (state.velocity as number) >= RECOVERY_STABILITY_THRESHOLD)
  ) {
    return {
      allowed: false,
      reason: `Canonical recovery velocity is not stable: velocity=${String(state.velocity)} must be finite and < ${RECOVERY_STABILITY_THRESHOLD} before non-read execution.`,
    };
  }

  const recovery = recoveryCapabilityAllowed(state.M, state.policyRisk, {
    nStable: state.nStable,
    sigmaViol: state.sigmaViol,
    canaryPassed: state.canaryPassed === true,
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
