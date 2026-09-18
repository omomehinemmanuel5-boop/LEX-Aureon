import { createHash } from 'crypto';
import { isSimplexState, productionStateTransition, productionTransitionPayload, PRODUCTION_TRANSITION_VERSION, type ProductionState, type ProductionTransitionInput, type ProductionTransitionResult } from './production_transition';
import { TAU, THETA_MAX, THETA_MIN, Z_RECOVERY, lyapunovBarrierZ } from './aureonics_core';

export interface PersistedTransitionReceipt {
  transition_version: string;
  transition_input: ProductionTransitionInput | string;
  transition_hash: string;
  projected_state: ProductionState;
  raw_state: ProductionState;
  projection_magnitude: number;
  epsilon_injected: boolean | number;
  suspension_triggered: boolean | number;
  lyapunov_v_before: number;
  lyapunov_v: number;
  delta_v: number;
  projection_triggered: boolean | number;
  lyapunov_status: 'measured_not_proven' | string;
}

export interface TransitionReceiptVerification {
  hash_valid: boolean;
  replay_matches: boolean;
  simplex_valid: boolean;
  floor_valid: boolean;
  theta_valid: boolean;
  lyapunov_consistent: boolean;
  lyapunov_status: 'measured_not_proven' | 'unknown';
  transition_version: string;
  errors: string[];
}

function stateMatches(a: ProductionState, b: ProductionState, tolerance = 1e-12): boolean {
  return Math.abs(a.C - b.C) <= tolerance && Math.abs(a.R - b.R) <= tolerance && Math.abs(a.S - b.S) <= tolerance;
}

function boolValue(value: boolean | number): boolean {
  return value === true || value === 1;
}

/** Verify a persisted receipt without database, network, clock, or LLM access. */
export function verifyProductionReceipt(receipt: PersistedTransitionReceipt): TransitionReceiptVerification {
  const errors: string[] = [];
  let input: ProductionTransitionInput;
  let replay: ProductionTransitionResult | null = null;
  try {
    input = typeof receipt.transition_input === 'string'
      ? JSON.parse(receipt.transition_input) as ProductionTransitionInput
      : receipt.transition_input;
    if (receipt.transition_version !== PRODUCTION_TRANSITION_VERSION) {
      errors.push(`unsupported transition version: ${receipt.transition_version}`);
    }
    replay = productionStateTransition(input);
  } catch (error) {
    errors.push(`replay failed: ${error instanceof Error ? error.message : String(error)}`);
    input = {} as ProductionTransitionInput;
  }

  const hashValid = replay !== null && createHash('sha256')
    .update(productionTransitionPayload(input, replay))
    .digest('hex') === receipt.transition_hash;
  if (!hashValid) errors.push('transition hash mismatch');

  const replayMatches = replay !== null && stateMatches(replay.state, receipt.projected_state)
    && stateMatches(replay.rawState, receipt.raw_state)
    && Math.abs(replay.projectionMagnitude - receipt.projection_magnitude) <= 1e-12
    && replay.projectionTriggered === boolValue(receipt.projection_triggered)
    && replay.epsilonInjected === boolValue(receipt.epsilon_injected)
    && replay.suspensionTriggered === boolValue(receipt.suspension_triggered);
  if (!replayMatches) errors.push('persisted transition result does not match replay');

  const simplexValid = isSimplexState(receipt.projected_state, TAU, 1e-9);
  if (!simplexValid) errors.push('projected state violates simplex or floor invariant');
  const floorValid = receipt.projected_state.C >= TAU - 1e-9 && receipt.projected_state.R >= TAU - 1e-9 && receipt.projected_state.S >= TAU - 1e-9;
  const thetaValid = replay !== null && replay.theta >= THETA_MIN && replay.theta <= THETA_MAX;
  const weights = input.lyapunovWeights ?? Z_RECOVERY;
  const expectedBefore = replay === null ? Number.NaN : lyapunovBarrierZ([input.state.C, input.state.R, input.state.S], weights);
  const expectedLyapunov = lyapunovBarrierZ([receipt.projected_state.C, receipt.projected_state.R, receipt.projected_state.S], weights);
  const lyapunovConsistent = Math.abs(receipt.lyapunov_v_before - expectedBefore) <= 1e-7 &&
    Math.abs(receipt.lyapunov_v - expectedLyapunov) <= 1e-7 &&
    Math.abs((receipt.lyapunov_v_before + receipt.delta_v) - receipt.lyapunov_v) <= 1e-7;
  if (!lyapunovConsistent) errors.push('Lyapunov before/after/delta fields are inconsistent');

  return {
    hash_valid: hashValid,
    replay_matches: replayMatches,
    simplex_valid: simplexValid,
    floor_valid: floorValid,
    theta_valid: thetaValid,
    lyapunov_consistent: lyapunovConsistent && Number.isFinite(expectedLyapunov),
    lyapunov_status: receipt.lyapunov_status === 'measured_not_proven' ? receipt.lyapunov_status : 'unknown',
    transition_version: receipt.transition_version,
    errors,
  };
}
