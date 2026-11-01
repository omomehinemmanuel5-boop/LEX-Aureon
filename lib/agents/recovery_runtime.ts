import { getZTraj, recordZTrajObservation } from '../kv';
import { getClient } from '../db';
import {
  TARGET_MARGIN,
  calculateZAwareGovernorG,
} from '../aureonics_core';
import { CONSTITUTION } from '../constitution';
import { RECOVERY_STABILITY_THRESHOLD } from './recovery_state';
import { getCachedKernel } from '../kernel_cache';
import { readCanonicalGovernanceState } from './canonical_governance_state';

const MAX_RECOVERY_STEP = 0.08;

export const RECOVERY_MIN_OBSERVATION_INTERVAL_MS = 5_000;
export const RECOVERY_ONE_BREACH_OBSERVATION_INTERVAL_MS = 10_000;
export const RECOVERY_MULTIPLE_BREACH_OBSERVATION_INTERVAL_MS = 15_000;

export interface RecoveryEpisodeCanaryRow {
  canary_status: string;
  n_stable: number;
  issued_at?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
  reason?: string | null;
}
export interface RecoveryEpisodeReceiptRow {
  receipt_id: string;
  created_at: string;
  state_snapshot?: string | null;
}

/** Derive episode breaches and clean-reset events only from durable server records. */
export function deriveRecoveryBreachCount(
  canaryRows: RecoveryEpisodeCanaryRow[],
  receiptRows: RecoveryEpisodeReceiptRow[],
  nMin = CONSTITUTION.N_MIN,
): number {
  type Event =
    | { at: number; kind: 'canary'; nStable: number; expiresAt: number }
    | { at: number; kind: 'breach' }
    | { at: number; kind: 'observation'; snapshot: Record<string, unknown> };
  const events: Event[] = [];
  for (const row of canaryRows) {
    if (row.canary_status !== 'passed' && row.canary_status !== 'invalidated') continue;
    const at = Date.parse(String(row.issued_at ?? row.created_at ?? ''));
    if (Number.isFinite(at)) events.push({
      at, kind: 'canary', nStable: Number(row.n_stable),
      expiresAt: row.expires_at && Number.isFinite(Date.parse(row.expires_at)) ? Date.parse(row.expires_at) : Number.NEGATIVE_INFINITY,
    });
  }
  const breachReceiptTimes: number[] = [];
  for (const row of receiptRows) {
    const at = Date.parse(row.created_at);
    if (!Number.isFinite(at)) continue;
    if (row.receipt_id.startsWith('recovery-canary-breach-')) {
      events.push({ at, kind: 'breach' });
      breachReceiptTimes.push(at);
      continue;
    }
    if (!row.state_snapshot) continue;
    try {
      const parsed = JSON.parse(row.state_snapshot) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        events.push({ at, kind: 'observation', snapshot: parsed as Record<string, unknown> });
      }
    } catch {
      // An unreadable snapshot cannot count as a clean observation.
    }
  }
  // A legacy invalidation may lack its corresponding breach receipt. Pair
  // timestamped rows with their receipt; if an audit receipt is missing, count
  // the unpaired invalidation at the present boundary so history loss cannot
  // shorten the dwell interval.
  const invalidatedRows = canaryRows.filter(row => row.canary_status === 'invalidated');
  let markerPairedReceipts = 0;
  let legacyInvalidations = 0;
  for (const row of invalidatedRows) {
    const marker = String(row.reason ?? '').match(/\[invalidated_at=(.*?)\]/);
    if (!marker) {
      legacyInvalidations += 1;
      continue;
    }
    const invalidatedAt = Date.parse(marker[1]);
    if (!Number.isFinite(invalidatedAt)
      || !breachReceiptTimes.some(at => Math.abs(at - invalidatedAt) <= 120_000)) {
      events.push({ at: Number.isFinite(invalidatedAt) ? invalidatedAt : Number.MAX_SAFE_INTEGER, kind: 'breach' });
    } else {
      markerPairedReceipts += 1;
    }
  }
  const receiptsAvailableForLegacy = Math.max(0, breachReceiptTimes.length - markerPairedReceipts);
  const missingLegacyReceipts = Math.max(0, legacyInvalidations - receiptsAvailableForLegacy);
  for (let i = 0; i < missingLegacyReceipts; i += 1) {
    events.push({ at: Number.MAX_SAFE_INTEGER, kind: 'breach' });
  }
  const order: Record<Event['kind'], number> = { canary: 0, observation: 1, breach: 2 };
  events.sort((a, b) => a.at - b.at || order[a.kind] - order[b.kind]);
  let pending: { lastN: number; cleanCount: number; expiresAt: number } | null = null;
  let resetAt = Number.NEGATIVE_INFINITY;
  const breachTimes: number[] = [];
  for (const event of events) {
    if (event.kind === 'canary') {
      pending = Number.isFinite(event.nStable) ? { lastN: event.nStable, cleanCount: 0, expiresAt: event.expiresAt } : null;
      continue;
    }
    if (event.kind === 'breach') {
      breachTimes.push(event.at);
      pending = null;
      continue;
    }
    if (!pending) continue;
    if (event.at > pending.expiresAt) { pending = null; continue; }
    const nStable = Number(event.snapshot.n_stable);
    const sigma = Number(event.snapshot.sigma_viol);
    const m = Number(event.snapshot.last_m
      ?? Math.min(Number(event.snapshot.last_c), Number(event.snapshot.last_r), Number(event.snapshot.last_s)));
    if (!Number.isFinite(nStable) || !Number.isFinite(sigma) || !Number.isFinite(m)
      || sigma !== 0 || m < CONSTITUTION.TAU_RECOVERY || nStable < pending.lastN) {
      pending = null;
      continue;
    }
    if (nStable > pending.lastN) {
      // n_stable increments only for observations below RECOVERY_STABILITY_THRESHOLD
      // and with M in the recovery band; its increase is the persisted velocity proof.
      pending.cleanCount += nStable - pending.lastN;
      pending.lastN = nStable;
      if (pending.cleanCount >= nMin) {
        resetAt = event.at;
        pending = null;
      }
    }
  }
  return breachTimes.filter(at => at > resetAt).length;
}

export function recoveryObservationIntervalMs(breachCount: number): number {
  if (!Number.isFinite(breachCount) || breachCount >= 2) return RECOVERY_MULTIPLE_BREACH_OBSERVATION_INTERVAL_MS;
  if (breachCount >= 1) return RECOVERY_ONE_BREACH_OBSERVATION_INTERVAL_MS;
  return RECOVERY_MIN_OBSERVATION_INTERVAL_MS;
}

async function readRecoveryEpisodeBreachCount(sessionId: string): Promise<number> {
  try {
    const [canaries, receipts] = await Promise.all([
      getClient().execute({
        sql: 'SELECT canary_status, n_stable, issued_at, expires_at, created_at, reason FROM recovery_canary_evidence WHERE session_id = ? ORDER BY id ASC',
        args: [sessionId],
      }),
      getClient().execute({
        sql: 'SELECT receipt_id, created_at, state_snapshot FROM tool_receipts WHERE session_id = ? ORDER BY id ASC LIMIT 10000',
        args: [sessionId],
      }),
    ]);
    if (receipts.rows.length >= 10_000) return 2;
    return deriveRecoveryBreachCount(
      canaries.rows as unknown as RecoveryEpisodeCanaryRow[],
      receipts.rows as unknown as RecoveryEpisodeReceiptRow[],
    );
  } catch {
    return 2;
  }
}


/**
 * Advance recovery only while its measurable prerequisites are genuinely unmet.
 * Once an exact-snapshot canary has passed, never mutate the measured state as
 * a side effect of requesting approval or retrying a governed action.
 */
export function shouldAdvanceRecoveryPlane(state: {
  trajectoryAvailable: boolean;
  M: number;
  nStable: number;
  velocity?: number;
  canaryPassed?: boolean;
}): boolean {
  return state.trajectoryAvailable
    && state.M >= CONSTITUTION.TAU_FLOOR
    && state.canaryPassed !== true
    // A high-velocity snapshot cannot pass canary validation. Keep the safe
    // recovery pulse active until a stationary baseline and dwell observations
    // bring velocity below the same threshold used by the canary gate.
    && (state.M < CONSTITUTION.TAU_RECOVERY
      || state.nStable < CONSTITUTION.N_MIN
      || typeof state.velocity !== 'number'
      || !Number.isFinite(state.velocity)
      || state.velocity >= RECOVERY_STABILITY_THRESHOLD);
}

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
  // Quarantine is an immediate hard stop. Do not let the observation dwell
  // timer mask a below-floor state as merely RESTORING.
  if (M < CONSTITUTION.TAU_FLOOR) {
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

  const observationIntervalMs = recoveryObservationIntervalMs(await readRecoveryEpisodeBreachCount(sessionId));
  const elapsedSinceWriteMs = Date.now() - Date.parse(current.updated_at);
  if (!Number.isFinite(elapsedSinceWriteMs)) {
    return {
      advanced: false, stabilized: false, state: 'RESTORING',
      M: Math.min(current.last_c, current.last_r, current.last_s),
      nStable: current.n_stable, velocity: current.velocity,
      reason: 'Trajectory timestamp is invalid; recovery pulse was not applied.',
    };
  }
  if (elapsedSinceWriteMs < observationIntervalMs) {
    return {
      advanced: false, stabilized: false, state: 'RESTORING',
      M: Math.min(current.last_c, current.last_r, current.last_s),
      nStable: current.n_stable, velocity: current.velocity,
      reason: `Recovery pulse interval has not elapsed; wait ${Math.ceil((observationIntervalMs - elapsedSinceWriteMs) / 1000)} more second(s).`,
    };
  }

  if (M >= CONSTITUTION.TAU_RECOVERY) {
    // A stationary sample is not evidence of stability if the preceding
    // trajectory was still moving. First write a zero-velocity baseline
    // without incrementing n_stable, then require a real dwell interval
    // between subsequent stable observations.
    const elapsedMs = Date.now() - Date.parse(current.updated_at);
    const wasMoving = current.velocity >= RECOVERY_STABILITY_THRESHOLD;
    if (!wasMoving && (!Number.isFinite(elapsedMs) || elapsedMs < observationIntervalMs)) {
      return {
        advanced: false,
        stabilized: false,
        state: 'RESTORING',
        M,
        nStable: current.n_stable,
        velocity: current.velocity,
        reason: !Number.isFinite(elapsedMs)
          ? 'Trajectory timestamp is invalid; no stability observation was counted.'
          : `Recovery observation interval has not elapsed; wait ${Math.ceil((observationIntervalMs - elapsedMs) / 1000)} more second(s).`,
      };
    }
    const observationCommitted = await recordZTrajObservation(
      sessionId,
      {
        last_c: current.last_c,
        last_r: current.last_r,
        last_s: current.last_s,
        sigma_viol: current.sigma_viol,
        updated_at: current.updated_at,
      },
      { c: current.last_c, r: current.last_r, s: current.last_s },
      !wasMoving,
    );
    if (!observationCommitted) {
      return {
        advanced: false,
        stabilized: false,
        state: 'RESTORING',
        M,
        nStable: current.n_stable,
        velocity: current.velocity,
        reason: 'Canonical trajectory changed during recovery observation; compare-and-set rejected the stale sample. Re-read state before retrying.',
      };
    }
    // The CAS succeeded against this exact CRS sample, so align this
    // instance's warm kernel cache with the persisted canonical trajectory.
    const kernel = getCachedKernel(sessionId, { C: current.last_c, R: current.last_r, S: current.last_s });
    kernel.state = { C: current.last_c, R: current.last_r, S: current.last_s };
    const canonical = await readCanonicalGovernanceState({
      sessionId,
      actorId: 'recovery-plane',
      capability: 'read',
    });
    const nextStable = wasMoving ? 0 : current.n_stable + 1;
    const reason = wasMoving
      ? `A zero-velocity baseline was recorded, but the prior velocity ${current.velocity.toFixed(4)} exceeded the stability threshold ${RECOVERY_STABILITY_THRESHOLD}; wait at least ${observationIntervalMs / 1000}s before counting the next observation.`
      : canonical.available && canonical.state.sigmaViol !== 0
        ? `Stable recovery observation recorded (${nextStable}/${CONSTITUTION.N_MIN}); canonical sigma_viol=${String(canonical.state.sigmaViol)} must be exactly 0 before canary verification. Continue healthy observations until residual stress decays to zero.`
        : canonical.available && canonical.state.canaryPassed
          ? 'Stable recovery observation recorded; exact-snapshot canary evidence is current.'
          : `Stable recovery observation recorded (${nextStable}/${CONSTITUTION.N_MIN}); the server evaluates the canonical canary predicate automatically when all prerequisites pass. Consequential execution still requires ordinary authorization.`;
    return {
      advanced: true,
      stabilized: nextStable >= CONSTITUTION.N_MIN,
      state: canonical.available ? canonical.state.recoveryState : 'RESTORING',
      M,
      nStable: canonical.available ? canonical.state.nStable : nextStable,
      velocity: 0,
      reason,
    };
  }
  const x: [number, number, number] = [current.last_c, current.last_r, current.last_s];
  const z: [number, number, number] = [current.z_c, current.z_r, current.z_s];

  let next = x;
  let reason = 'Recovery state is already above τ_recovery; recording a stabilization observation.';

  if (M < CONSTITUTION.TAU_RECOVERY) {
    const margin = M - CONSTITUTION.TAU_FLOOR;
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
        const allowed = (x[i] - CONSTITUTION.TAU_FLOOR) / -delta[i];
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

  // Persist the bounded correction with compare-and-set against the exact
  // trajectory sample read above. Concurrent pulses against the same sample
  // cannot both win; a stale writer must re-read instead of overwriting newer CRS.
  const committed = await recordZTrajObservation(
    sessionId,
    {
      last_c: current.last_c,
      last_r: current.last_r,
      last_s: current.last_s,
      sigma_viol: current.sigma_viol,
      updated_at: current.updated_at,
    },
    { c: next[0], r: next[1], s: next[2] },
    false,
  );
  if (!committed) {
    return {
      advanced: false,
      stabilized: false,
      state: 'RESTORING',
      M,
      nStable: current.n_stable,
      velocity: current.velocity,
      reason: 'Canonical trajectory changed during recovery correction; compare-and-set rejected the stale pulse. Re-read state before retrying.',
    };
  }

  const updated = await getZTraj(sessionId);
  if (!updated) {
    return {
      advanced: false,
      stabilized: false,
      state: 'RESTORING',
      M,
      nStable: current.n_stable,
      velocity: current.velocity,
      reason: 'Recovery correction committed but the canonical trajectory could not be re-read; execution remains fail-closed.',
    };
  }
  // Update the warm cache only after the canonical compare-and-set succeeds.
  const kernel = getCachedKernel(sessionId, { C: updated.last_c, R: updated.last_r, S: updated.last_s });
  kernel.state = { C: updated.last_c, R: updated.last_r, S: updated.last_s };

  const updatedM = Math.min(updated.last_c, updated.last_r, updated.last_s);
  const stabilized = updated.velocity < RECOVERY_STABILITY_THRESHOLD;
  const canonical = await readCanonicalGovernanceState({
    sessionId,
    actorId: 'recovery-plane',
    capability: 'read',
  });
  const state = canonical.available ? canonical.state.recoveryState : 'RESTORING';
  const recoveryReason = state === 'RESTORING' && canonical.available
    ? canonical.state.nStable < CONSTITUTION.N_MIN
      ? `Recovery observation ${canonical.state.nStable}/${CONSTITUTION.N_MIN}; continue safe governed observations before canary verification.`
      : canonical.state.sigmaViol !== 0
        ? `Canonical sigma_viol=${String(canonical.state.sigmaViol)} must be exactly 0 before canary verification; continue healthy observations until residual stress decays to zero.`
        : 'Stability thresholds are met, but no passing canary is persisted for this exact state snapshot; run the operator-only run_recovery_canary probe.'
    : reason;

  return {
    advanced: true,
    stabilized,
    state,
    M: updatedM,
    nStable: canonical.available ? canonical.state.nStable : updated.n_stable,
    velocity: updated.velocity,
    reason: recoveryReason,
  };
}
