import { describe, expect, it } from 'vitest';
import {
  deriveReservePolicy,
  deriveReserveRisk,
  planReserveAwareBasin,
  reserveAwareTaskTarget,
  selectBasinFromTaskPosterior,
} from '../lib/research/reserve_aware_basin_policy';

const stable = {
  velocity: 0,
  n_stable: 3,
  sigma_viol: 0,
  last_m: 1 / 3,
  attack_pressure: 0,
  drift_dir: 'stable',
};

const stressed = {
  velocity: 0.15,
  n_stable: 0,
  sigma_viol: 0.25,
  last_m: 0.1,
  attack_pressure: 1,
  drift_dir: 'away_C',
};

describe('reserve-aware basin policy (research-only)', () => {
  it('derives low reserve risk from a stable trajectory and higher risk from stress', () => {
    const stableRisk = deriveReserveRisk(stable);
    const stressedRisk = deriveReserveRisk(stressed);
    expect(stableRisk.score).toBe(0);
    expect(stressedRisk.score).toBeGreaterThan(stableRisk.score);
    expect(stressedRisk.attack).toBe(1);
    expect(stressedRisk.sigma).toBe(1);
    expect(stressedRisk.velocity).toBe(1);
    expect(stressedRisk.drift).toBe(1);
    expect(stressedRisk.recovery).toBe(1);
  });

  it('raises the reserve floor when trajectory risk increases', () => {
    const state: [number, number, number] = [1 / 3, 1 / 3, 1 / 3];
    const stablePolicy = deriveReservePolicy(state, stable);
    const stressedPolicy = deriveReservePolicy(state, stressed);
    expect(stablePolicy.reserveFloor).toBeGreaterThan(0.05);
    expect(stressedPolicy.reserveFloor).toBeGreaterThan(stablePolicy.reserveFloor);
    expect(stressedPolicy.reserveDeficit).toBe(0);
    expect(stressedPolicy.reason).toEqual([
      'attack_pressure', 'sigma_viol', 'velocity', 'persistent_drift', 'recovery_band',
    ]);
  });

  it('uses current task evidence for basin selection and falls back to neutral under ambiguity', () => {
    const analytical = selectBasinFromTaskPosterior({ analytical: 0.8, collaborative: 0.1, exploratory: 0.1 });
    expect(analytical.basin).toBe('analytical');
    expect(analytical.fallbackToNeutral).toBe(false);

    const ambiguous = selectBasinFromTaskPosterior({ analytical: 0.4, collaborative: 0.35, exploratory: 0.25 });
    expect(ambiguous.basin).toBe('neutral');
    expect(ambiguous.fallbackToNeutral).toBe(true);
    expect(ambiguous.weights).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('keeps the reserve-aware one-hot target above the hard floor', () => {
    const target = reserveAwareTaskTarget([1, 0, 0], 0.07);
    expect(target).toEqual([0.86, 0.07, 0.07]);
    expect(target.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(Math.min(...target)).toBeGreaterThan(0.05);
  });

  it('plans a task-first analytical basin while increasing reserve under stress', () => {
    const plan = planReserveAwareBasin(
      [1 / 3, 1 / 3, 1 / 3],
      { analytical: 0.9, collaborative: 0.05, exploratory: 0.05 },
      stressed,
      { stepSize: 0.2, gain: 1 },
    );
    expect(plan.selection.basin).toBe('analytical');
    expect(plan.selection.fallbackToNeutral).toBe(false);
    expect(plan.target[0]).toBeGreaterThan(plan.target[1]);
    expect(plan.target[1]).toBeGreaterThan(0.05);
    expect(plan.target[2]).toBeGreaterThan(0.05);
    expect(plan.direction.reduce((sum, value) => sum + value, 0)).toBeCloseTo(0, 12);
    expect(plan.proposedState.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
    expect(Math.min(...plan.proposedState)).toBeGreaterThanOrEqual(plan.reserve.reserveFloor - 1e-9);
  });

  it('does not let trajectory protection silently change a confident task basin', () => {
    const plan = planReserveAwareBasin(
      [0.7, 0.2, 0.1],
      { analytical: 0.9, collaborative: 0.05, exploratory: 0.05 },
      stressed,
    );
    expect(plan.selection.basin).toBe('analytical');
    expect(plan.selection.weights).toEqual([0.9, 0.05, 0.05]);
  });

  it('rejects invalid task posteriors and trajectory values', () => {
    expect(() => selectBasinFromTaskPosterior({ analytical: 0.5, collaborative: 0.5, exploratory: 0.5 })).toThrow(/sum to one/);
    expect(() => deriveReserveRisk({ ...stable, attack_pressure: 2 })).toThrow(/attack_pressure/);
  });
});
