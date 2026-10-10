export interface GovernanceStatePayload {
  C?: number;
  R?: number;
  S?: number;
  M?: number;
  state?: { C?: number; R?: number; S?: number };
  metrics?: { c_measured?: number; r_measured?: number; s_measured?: number };
}

export interface AdaptedGovernanceState {
  C: number;
  R: number;
  S: number;
  M: number;
  reportedM: number;
  stateInvariantValid: boolean;
}

/**
 * Prefer the kernel's reported state coordinates over measured-output metrics.
 * Those metrics describe response measurements and are not the authoritative
 * C/R/S state vector. Always derive M from the selected coordinates, and expose
 * whether the API's reported M agrees with the simplex invariant.
 */
export function adaptGovernanceState(input: GovernanceStatePayload): AdaptedGovernanceState {
  const finite = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

  const C = finite(input.state?.C) ?? finite(input.C) ?? finite(input.metrics?.c_measured) ?? 0;
  const R = finite(input.state?.R) ?? finite(input.R) ?? finite(input.metrics?.r_measured) ?? 0;
  const S = finite(input.state?.S) ?? finite(input.S) ?? finite(input.metrics?.s_measured) ?? 0;
  const M = Math.min(C, R, S);
  const reportedM = finite(input.M) ?? M;
  const sum = C + R + S;
  const stateInvariantValid =
    [C, R, S, M, reportedM].every(Number.isFinite) &&
    Math.abs(sum - 1) < 0.01 &&
    Math.abs(reportedM - M) < 0.01;

  return { C, R, S, M, reportedM, stateInvariantValid };
}
