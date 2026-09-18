import {
  MIN_DELTA,
  SOFT_FLOOR,
  TAU,
  TARGET_MARGIN,
  THETA_BETA,
  THETA_ETA,
  THETA_MAX,
  THETA_MIN,
  calculateGovernorG,
  lyapunovBarrierZ,
  projectToSimplex,
} from './aureonics_core';

export type ProductionState = { C: number; R: number; S: number };
export type ProductionDelta = { dc: number; dr: number; ds: number };

export interface ProductionTransitionInput {
  state: ProductionState;
  delta: ProductionDelta;
  postResponseDelta: ProductionDelta;
  activeLawDelta?: ProductionDelta | null;
  semanticAttack: boolean;
  semanticSeverity: number;
  advGain: number;
  effectiveTheta: number;
  threatSignal: number;
  theta: number;
}

export interface ProductionTransitionResult {
  state: ProductionState;
  rawState: ProductionState;
  theta: number;
  projectionTriggered: boolean;
  projectionMagnitude: number;
  suspensionTriggered: boolean;
  epsilonInjected: boolean;
}

const NORMALIZATION_EPS = 1e-12;
const CENTER = 1 / 3;

function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function assertFiniteState(state: ProductionState, name: string): void {
  for (const key of ['C', 'R', 'S'] as const) assertFiniteNumber(state[key], `${name}.${key}`);
}

function assertFiniteDelta(delta: ProductionDelta, name: string): void {
  for (const key of ['dc', 'dr', 'ds'] as const) assertFiniteNumber(delta[key], `${name}.${key}`);
}

/** Validate the replay boundary before any state mutation or normalization. */
export function validateProductionTransitionInput(input: ProductionTransitionInput): void {
  assertFiniteState(input.state, 'state');
  assertFiniteDelta(input.delta, 'delta');
  assertFiniteDelta(input.postResponseDelta, 'postResponseDelta');
  if (input.activeLawDelta) assertFiniteDelta(input.activeLawDelta, 'activeLawDelta');
  for (const [name, value] of [
    ['semanticSeverity', input.semanticSeverity], ['advGain', input.advGain],
    ['effectiveTheta', input.effectiveTheta], ['threatSignal', input.threatSignal], ['theta', input.theta],
  ] as const) assertFiniteNumber(value, name);
  if (input.semanticSeverity < 0 || input.semanticSeverity > 1) throw new RangeError('semanticSeverity must be in [0, 1]');
  if (input.threatSignal < 0 || input.threatSignal > 1) throw new RangeError('threatSignal must be in [0, 1]');
  if (input.theta < THETA_MIN || input.theta > THETA_MAX) throw new RangeError(`theta must be in [${THETA_MIN}, ${THETA_MAX}]`);
}

function normalize(state: ProductionState): ProductionState {
  const total = state.C + state.R + state.S;
  return total > NORMALIZATION_EPS
    ? { C: state.C / total, R: state.R / total, S: state.S / total }
    : { ...state };
}

function add(state: ProductionState, delta: ProductionDelta): ProductionState {
  return { C: state.C + delta.dc, R: state.R + delta.dr, S: state.S + delta.ds };
}

function applyMinimumDelta(state: ProductionState, delta: ProductionDelta): ProductionState {
  const result = { ...state };
  for (const key of ['C', 'R', 'S'] as const) {
    const d = key === 'C' ? delta.dc : key === 'R' ? delta.dr : delta.ds;
    if (Math.abs(d) < MIN_DELTA) result[key] += d !== 0 ? Math.sign(d) * MIN_DELTA : MIN_DELTA;
  }
  return result;
}

function projectionMagnitude(before: ProductionState, after: ProductionState): number {
  return Math.sqrt(
    (after.C - before.C) ** 2 +
    (after.R - before.R) ** 2 +
    (after.S - before.S) ** 2,
  );
}

/**
 * The exact deterministic state transition used by SovereignKernel.runCycle().
 *
 * This function deliberately excludes LLM, database, time, and network effects.
 * It is the authoritative replay/proof boundary for the deployed CRS update.
 * Its ordering mirrors the live route: measured deltas, law impact, adversarial
 * gain, governor correction, semantic pressure, recentering, suspension,
 * epsilon injection, high-severity pressure, threat signal, then floor projection.
 */
export function productionStateTransition(input: ProductionTransitionInput): ProductionTransitionResult {
  validateProductionTransitionInput(input);
  const severity = input.semanticSeverity;
  const threat = input.threatSignal;
  let state = applyMinimumDelta(add(input.state, input.delta), input.delta);
  state = add(state, input.postResponseDelta);

  if (input.activeLawDelta) {
    state = normalize(add(state, {
      dc: input.activeLawDelta.dc * severity,
      dr: input.activeLawDelta.dr * severity,
      ds: input.activeLawDelta.ds * severity,
    }));
  }

  state.S += input.advGain;

  const initialMargin = Math.min(state.C, state.R, state.S) - TAU;
  if (initialMargin < TARGET_MARGIN) {
    const governor = calculateGovernorG([state.C, state.R, state.S], input.effectiveTheta);
    const scalar = TARGET_MARGIN - initialMargin;
    state = add(state, { dc: governor[0] * scalar, dr: governor[1] * scalar, ds: governor[2] * scalar });
  }

  let theta = input.theta;
  const initialM = Math.min(state.C, state.R, state.S);
  if (initialM < 0.08) theta = Math.min(THETA_MAX, theta * (1 + THETA_ETA));
  else if (initialM > 0.20) theta = Math.max(THETA_MIN, theta * (1 - THETA_BETA));

  if (input.semanticAttack) {
    const pressure = 0.08 * severity;
    state = add(state, { dc: -pressure, dr: -pressure * 0.6, ds: pressure * 1.6 });
  }

  const margin = Math.min(state.C, state.R, state.S);
  const biasStrength = 0.1 + 0.3 * (1 - margin);
  state = {
    C: state.C + biasStrength * (CENTER - state.C),
    R: state.R + biasStrength * (CENTER - state.R),
    S: state.S + biasStrength * (CENTER - state.S),
  };
  state = normalize(state);

  let suspensionTriggered = false;
  if (severity < 0.7) {
    const m = Math.min(state.C, state.R, state.S);
    if (m < SOFT_FLOOR) {
      const lift = (SOFT_FLOOR - m) * 0.5;
      state = normalize({ C: state.C + lift / 3, R: state.R + lift / 3, S: state.S + lift / 3 });
      suspensionTriggered = true;
    }
  }

  let epsilonInjected = false;
  const afterSuspensionM = Math.min(state.C, state.R, state.S);
  if (afterSuspensionM < 0.15) {
    const epsilon = 0.01 * (0.15 - afterSuspensionM);
    state = { C: state.C + epsilon, R: state.R + epsilon, S: state.S + epsilon };
    const total = state.C + state.R + state.S;
    state.C /= total;
    state.R /= total;
    state.S = 1 - state.C - state.R;
    epsilonInjected = true;
  }

  if (severity >= 0.7) {
    state = add(state, { dc: -0.20, dr: -0.10, ds: 0.30 });
  }

  if (threat > 0) {
    const pressure = 0.30 * threat;
    state = add(state, { dc: -pressure * 0.55, dr: -pressure * 0.30, ds: pressure * 0.85 });
  }

  const rawState = { ...state };
  const preProjectionBelowFloor = Math.min(state.C, state.R, state.S) < TAU;
  const projected = preProjectionBelowFloor
    ? projectToSimplex([state.C, state.R, state.S])
    : [state.C, state.R, state.S] as [number, number, number];
  state = { C: projected[0], R: projected[1], S: projected[2] };

  return {
    state,
    rawState,
    theta,
    projectionTriggered: preProjectionBelowFloor,
    projectionMagnitude: projectionMagnitude(rawState, state),
    suspensionTriggered,
    epsilonInjected,
  };
}

export function isSimplexState(state: ProductionState, floor = TAU, tolerance = 1e-9): boolean {
  return Math.abs(state.C + state.R + state.S - 1) <= tolerance &&
    state.C >= floor - tolerance && state.R >= floor - tolerance && state.S >= floor - tolerance;
}

export function lyapunovDelta(
  previous: ProductionState,
  next: ProductionState,
  z: [number, number, number],
): number {
  const candidate = (state: ProductionState) => lyapunovBarrierZ([state.C, state.R, state.S], z);
  return candidate(next) - candidate(previous);
}

/** Stable, JSON-serializable payload used for receipt hashing and replay. */
export function productionTransitionPayload(
  input: ProductionTransitionInput,
  result: ProductionTransitionResult,
): string {
  return JSON.stringify({ version: PRODUCTION_TRANSITION_VERSION, input, result });
}
export const PRODUCTION_TRANSITION_VERSION = 'production-transition-v1';
