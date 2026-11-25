/**
 * Research-only reserve-aware basin policy.
 *
 * This module is intentionally not imported by the production kernel, PRAXIS,
 * recovery plane, approval/quarantine paths, or production routes.
 *
 * Responsibilities are deliberately separated:
 *   - current task posterior selects a desired basin;
 *   - z_traj derives reserve requirement and protective risk;
 *   - the hard floor remains an independent final safety invariant.
 *
 * This is a deterministic shadow/reference policy, not a production controller.
 */

import {
  AUREONICS_HARD_FLOOR,
  CRSVector,
  MutableCRSVector,
  projectToFloorSimplex,
  projectToSimplexTangent,
  taskPotentialMinimizer,
} from './aureonics_adaptive_basins';

export type ReserveBasin = 'analytical' | 'collaborative' | 'exploratory' | 'neutral';

export interface ReserveTrajectorySnapshot {
  velocity: number;
  n_stable: number;
  sigma_viol: number;
  last_m: number;
  attack_pressure: number;
  drift_dir: string;
}

export interface ReservePolicyOptions {
  hardFloor?: number;
  recoveryFloor?: number;
  baselineMargin?: number;
  riskMargin?: number;
  minimumMargin?: number;
  maximumMargin?: number;
  sigmaReference?: number;
  velocityReference?: number;
  stabilityCreditTurns?: number;
  attackWeight?: number;
  sigmaWeight?: number;
  velocityWeight?: number;
  driftWeight?: number;
  recoveryWeight?: number;
  stabilityCreditWeight?: number;
}

export interface ReservePolicyConfig {
  hardFloor: number;
  recoveryFloor: number;
  baselineMargin: number;
  riskMargin: number;
  minimumMargin: number;
  maximumMargin: number;
  sigmaReference: number;
  velocityReference: number;
  stabilityCreditTurns: number;
  attackWeight: number;
  sigmaWeight: number;
  velocityWeight: number;
  driftWeight: number;
  recoveryWeight: number;
  stabilityCreditWeight: number;
}

export interface ReserveRisk {
  score: number;
  attack: number;
  sigma: number;
  velocity: number;
  drift: number;
  recovery: number;
  stabilityCredit: number;
}

export interface ReservePolicyResult {
  risk: ReserveRisk;
  reserveMargin: number;
  reserveFloor: number;
  measuredMinimumReserve: number;
  reserveDeficit: number;
  reason: string[];
}

export interface TaskBasinPosterior {
  analytical: number;
  collaborative: number;
  exploratory: number;
}

export interface BasinSelection {
  basin: ReserveBasin;
  weights: MutableCRSVector;
  confidence: number;
  fallbackToNeutral: boolean;
}

export interface ReserveAwareBasinPlan {
  selection: BasinSelection;
  reserve: ReservePolicyResult;
  target: MutableCRSVector;
  direction: MutableCRSVector;
  proposedState: MutableCRSVector;
  reserveProjectionApplied: boolean;
}

export const DEFAULT_RESERVE_POLICY: ReservePolicyConfig = Object.freeze({
  hardFloor: AUREONICS_HARD_FLOOR,
  recoveryFloor: 0.15,
  baselineMargin: 0.01,
  riskMargin: 0.04,
  minimumMargin: 0,
  maximumMargin: 0.09,
  sigmaReference: 0.25,
  velocityReference: 0.15,
  stabilityCreditTurns: 3,
  attackWeight: 0.35,
  sigmaWeight: 0.25,
  velocityWeight: 0.15,
  driftWeight: 0.15,
  recoveryWeight: 0.15,
  stabilityCreditWeight: 0.10,
});

const NEUTRAL_WEIGHTS: MutableCRSVector = [1 / 3, 1 / 3, 1 / 3];
const BASIN_INDEX: Record<ReserveBasin, number | null> = {
  analytical: 0,
  collaborative: 1,
  exploratory: 2,
  neutral: null,
};

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function clip(value: number, low = 0, high = 1): number {
  return Math.max(low, Math.min(high, value));
}

function assertUnitInterval(value: number, name: string): void {
  assertFinite(value, name);
  if (value < 0 || value > 1) throw new RangeError(`${name} must be in [0, 1]`);
}

function assertTrajectory(snapshot: ReserveTrajectorySnapshot): void {
  assertFinite(snapshot.velocity, 'trajectory.velocity');
  assertFinite(snapshot.n_stable, 'trajectory.n_stable');
  assertFinite(snapshot.sigma_viol, 'trajectory.sigma_viol');
  assertFinite(snapshot.last_m, 'trajectory.last_m');
  assertUnitInterval(snapshot.attack_pressure, 'trajectory.attack_pressure');
  if (snapshot.velocity < 0 || snapshot.n_stable < 0 || snapshot.sigma_viol < 0) {
    throw new RangeError('trajectory velocity, n_stable, and sigma_viol must be non-negative');
  }
}

function resolveConfig(options: ReservePolicyOptions = {}): ReservePolicyConfig {
  const config: ReservePolicyConfig = { ...DEFAULT_RESERVE_POLICY, ...options };
  for (const [name, value] of Object.entries(config)) assertFinite(value as number, name);
  if (config.hardFloor < 0 || config.hardFloor >= 1 / 3) throw new RangeError('hardFloor must be in [0, 1/3)');
  if (config.recoveryFloor < config.hardFloor || config.recoveryFloor >= 1 / 3) {
    throw new RangeError('recoveryFloor must be at least hardFloor and less than 1/3');
  }
  if (config.baselineMargin < 0 || config.riskMargin < 0) throw new RangeError('reserve margins must be non-negative');
  if (config.minimumMargin < 0 || config.maximumMargin < config.minimumMargin) {
    throw new RangeError('reserve margin bounds are invalid');
  }
  if (config.hardFloor + config.maximumMargin >= 1 / 3) {
    throw new RangeError('hardFloor + maximumMargin must be less than 1/3');
  }
  if (config.sigmaReference <= 0 || config.velocityReference <= 0 || config.stabilityCreditTurns <= 0) {
    throw new RangeError('reserve references must be positive');
  }
  const weightTotal = config.attackWeight + config.sigmaWeight + config.velocityWeight
    + config.driftWeight + config.recoveryWeight;
  if (weightTotal <= 0 || config.stabilityCreditWeight < 0) throw new RangeError('reserve risk weights are invalid');
  return config;
}

export function deriveReserveRisk(
  snapshot: ReserveTrajectorySnapshot,
  options: ReservePolicyOptions = {},
): ReserveRisk {
  const config = resolveConfig(options);
  assertTrajectory(snapshot);
  const attack = snapshot.attack_pressure;
  const sigma = clip(snapshot.sigma_viol / config.sigmaReference);
  const velocity = clip(snapshot.velocity / config.velocityReference);
  const drift = /^away_(C|R|S)$/.test(snapshot.drift_dir) ? 1 : 0;
  const recovery = snapshot.last_m <= config.recoveryFloor ? 1 : 0;
  const stabilityCredit = clip(snapshot.n_stable / config.stabilityCreditTurns);
  const positiveWeightTotal = config.attackWeight + config.sigmaWeight + config.velocityWeight
    + config.driftWeight + config.recoveryWeight;
  const score = clip((
    config.attackWeight * attack
    + config.sigmaWeight * sigma
    + config.velocityWeight * velocity
    + config.driftWeight * drift
    + config.recoveryWeight * recovery
    - config.stabilityCreditWeight * stabilityCredit
  ) / positiveWeightTotal);
  return { score, attack, sigma, velocity, drift, recovery, stabilityCredit };
}

export function deriveReservePolicy(
  state: CRSVector,
  snapshot: ReserveTrajectorySnapshot,
  options: ReservePolicyOptions = {},
): ReservePolicyResult {
  const config = resolveConfig(options);
  if (state.length !== 3 || !state.every(Number.isFinite)) throw new RangeError('state must contain three finite values');
  if (Math.abs(state.reduce((sum, value) => sum + value, 0) - 1) > 1e-9) throw new RangeError('state must sum to one');
  const risk = deriveReserveRisk(snapshot, config);
  const reserveMargin = clip(
    config.baselineMargin + config.riskMargin * risk.score,
    config.minimumMargin,
    config.maximumMargin,
  );
  const reserveFloor = config.hardFloor + reserveMargin;
  const measuredMinimumReserve = Math.min(...state) - config.hardFloor;
  const reserveDeficit = Math.max(0, reserveFloor - Math.min(...state));
  const reason: string[] = [];
  if (risk.attack > 0) reason.push('attack_pressure');
  if (risk.sigma > 0) reason.push('sigma_viol');
  if (risk.velocity > 0) reason.push('velocity');
  if (risk.drift > 0) reason.push('persistent_drift');
  if (risk.recovery > 0) reason.push('recovery_band');
  if (risk.stabilityCredit > 0 && reason.length === 0) reason.push('stability_credit');
  return { risk, reserveMargin, reserveFloor, measuredMinimumReserve, reserveDeficit, reason };
}

export function selectBasinFromTaskPosterior(
  posterior: TaskBasinPosterior,
  confidenceThreshold = 0.5,
): BasinSelection {
  for (const [name, value] of Object.entries(posterior)) assertUnitInterval(value, `posterior.${name}`);
  const total = posterior.analytical + posterior.collaborative + posterior.exploratory;
  if (Math.abs(total - 1) > 1e-9) throw new RangeError('task posterior must sum to one');
  assertUnitInterval(confidenceThreshold, 'confidenceThreshold');
  const values = [posterior.analytical, posterior.collaborative, posterior.exploratory];
  const confidence = Math.max(...values);
  const winners = values.filter(value => Math.abs(value - confidence) <= 1e-12).length;
  if (confidence < confidenceThreshold || winners !== 1) {
    return { basin: 'neutral', weights: [...NEUTRAL_WEIGHTS], confidence, fallbackToNeutral: true };
  }
  const index = values.indexOf(confidence);
  const basin = (['analytical', 'collaborative', 'exploratory'] as const)[index];
  return { basin, weights: [...values] as MutableCRSVector, confidence, fallbackToNeutral: false };
}

export function reserveAwareTaskTarget(
  taskWeights: CRSVector,
  reserveFloor: number,
): MutableCRSVector {
  return taskPotentialMinimizer(taskWeights, reserveFloor);
}

export function reserveAwareDirection(
  state: CRSVector,
  target: CRSVector,
  gain = 1,
): MutableCRSVector {
  if (!Number.isFinite(gain) || gain <= 0) throw new RangeError('gain must be finite and positive');
  const raw: CRSVector = [target[0] - state[0], target[1] - state[1], target[2] - state[2]];
  return projectToSimplexTangent(raw).map(value => value * gain) as MutableCRSVector;
}

export function planReserveAwareBasin(
  state: CRSVector,
  posterior: TaskBasinPosterior,
  trajectory: ReserveTrajectorySnapshot,
  options: ReservePolicyOptions & { confidenceThreshold?: number; stepSize?: number; gain?: number } = {},
): ReserveAwareBasinPlan {
  const config = resolveConfig(options);
  const reserve = deriveReservePolicy(state, trajectory, config);
  const selection = selectBasinFromTaskPosterior(posterior, options.confidenceThreshold ?? 0.5);
  const target = reserveAwareTaskTarget(selection.weights, reserve.reserveFloor);
  const direction = reserveAwareDirection(state, target, options.gain ?? 1);
  const stepSize = options.stepSize ?? 0.25;
  if (!Number.isFinite(stepSize) || stepSize <= 0) throw new RangeError('stepSize must be finite and positive');
  const rawCandidate: CRSVector = [
    state[0] + stepSize * direction[0],
    state[1] + stepSize * direction[1],
    state[2] + stepSize * direction[2],
  ];
  const reserveProjectionApplied = Math.min(...rawCandidate) < reserve.reserveFloor - 1e-12;
  const projected = projectToFloorSimplex(rawCandidate, reserve.reserveFloor);
  return {
    selection,
    reserve,
    target,
    direction,
    proposedState: projected,
    reserveProjectionApplied,
  };
}

export function basinIndex(basin: ReserveBasin): number | null {
  return BASIN_INDEX[basin];
}
