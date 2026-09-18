import { isSimplexState, lyapunovDelta, type ProductionState, type ProductionTransitionInput, type ProductionTransitionResult } from './production_transition';
import { TAU, THETA_MAX, THETA_MIN, Z_RECOVERY } from './aureonics_core';

export type StabilityEvidenceStatus = 'measured_not_proven';

export interface ProductionTransitionCertificate {
  hard_invariant_holds: boolean;
  raw_state_finite: boolean;
  committed_state_finite: boolean;
  simplex_holds: boolean;
  floor_holds: boolean;
  theta_bounded: boolean;
  lyapunov_delta: number;
  lyapunov_change_bound: number;
  lyapunov_bound_holds: boolean;
  descent_observed: boolean;
  stability_status: StabilityEvidenceStatus;
  assumptions: {
    bounded_input: boolean;
    finite_input: boolean;
    supported_floor: boolean;
  };
}

function finiteState(state: ProductionState): boolean {
  return Object.values(state).every(Number.isFinite);
}

function finiteInput(input: ProductionTransitionInput): boolean {
  const values = [
    ...Object.values(input.state),
    ...Object.values(input.delta),
    ...Object.values(input.postResponseDelta),
    ...(input.activeLawDelta ? Object.values(input.activeLawDelta) : []),
    input.semanticSeverity, input.advGain, input.effectiveTheta, input.threatSignal, input.theta,
  ];
  return values.every(Number.isFinite);
}

/**
 * Classifies one deployed transition without claiming a global descent theorem.
 * The bounded-input envelope is an engineering assumption for future analysis,
 * not a proof that the complete discrete composition is Lyapunov-descending.
 */
export function certifyProductionTransition(
  input: ProductionTransitionInput,
  result: ProductionTransitionResult,
  z: [number, number, number] = Z_RECOVERY,
): ProductionTransitionCertificate {
  const rawStateFinite = finiteState(result.rawState);
  const committedStateFinite = finiteState(result.state);
  const simplexHolds = isSimplexState(result.state, TAU, 1e-9);
  const floorHolds = result.state.C >= TAU - 1e-9 && result.state.R >= TAU - 1e-9 && result.state.S >= TAU - 1e-9;
  const thetaBounded = result.theta >= THETA_MIN && result.theta <= THETA_MAX;
  const delta = lyapunovDelta(input.state, result.state, z);
  const displacement = Math.hypot(
    result.state.C - input.state.C,
    result.state.R - input.state.R,
    result.state.S - input.state.S,
  );
  // On the floor-constrained simplex, the quadratic penalty is inactive and
  // ||∇V_z||₂ <= ||z||₂ / tau. The mean-value bound therefore applies along
  // the convex segment joining two valid committed states.
  const lyapunovChangeBound = (Math.hypot(...z) / TAU) * displacement;
  const boundedInput = [
    ...Object.values(input.delta),
    ...Object.values(input.postResponseDelta),
    ...(input.activeLawDelta ? Object.values(input.activeLawDelta) : []),
    input.advGain,
  ].every(value => Math.abs(value) <= 5);
  const supportedFloor = TAU > 0 && TAU < 1 / 3;
  return {
    hard_invariant_holds: committedStateFinite && simplexHolds && floorHolds && thetaBounded,
    raw_state_finite: rawStateFinite,
    committed_state_finite: committedStateFinite,
    simplex_holds: simplexHolds,
    floor_holds: floorHolds,
    theta_bounded: thetaBounded,
    lyapunov_delta: delta,
    lyapunov_change_bound: lyapunovChangeBound,
    lyapunov_bound_holds: Math.abs(delta) <= lyapunovChangeBound + 1e-9,
    descent_observed: Number.isFinite(delta) && delta <= 0,
    stability_status: 'measured_not_proven',
    assumptions: {
      bounded_input: boundedInput,
      finite_input: finiteInput(input),
      supported_floor: supportedFloor,
    },
  };
}
