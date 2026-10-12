import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, trajectory } = vi.hoisted(() => ({
  execute: vi.fn(),
  trajectory: { current: null as Record<string, unknown> | null },
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute }),
}));

vi.mock('../lib/env', () => ({ env: { AUDITOR_SECRET: 'test-signing-key' } }));

import { writeKernelReceipt } from '../lib/kernel_bridge';
import type { KernelCycleResult } from '../lib/sovereign_kernel';

type CRS = { C: number; R: number; S: number };

function cycleResult(state: CRS, rawState: CRS): KernelCycleResult {
  const semanticSignal = { attack_type: 'none' as const, severity: 0 };
  const governorSensing = {
    fired: false,
    correction_applied: false,
    basin_shift: 'none',
    rho: 0,
    reason: 'test',
    correction_magnitude: 0,
  };
  return {
    status: 'Success', response: 'ok', raw_output: 'raw', governed_output: 'governed',
    state, M: Math.min(state.C, state.R, state.S), health_band: 'OPTIMAL',
    temperature: 0.2, theta: 0.3, effective_theta: 0.3, attack_pressure: 0,
    adv_gain: 0, semantic_signal: semanticSignal, lyapunov_V: 0, delta_V: 0,
    stability_ratio: 1, max_deviation: 0, invariance_violations: 0,
    projection_magnitude: 0, epsilon_injected: false, suspension_triggered: false,
    governor_sensing: governorSensing,
    receipt: {
      timestamp_iso: new Date().toISOString(), input_hash: 'input', output_hash: 'output',
      pillar_snapshot: state, active_law: null, stability_margin: 0.3,
      constitutional: true, safety_projection_triggered: false, adv_gain: 0,
      raw_response: 'raw', governed_response: 'governed', projection_magnitude: 0,
      raw_state: rawState, projected_state: state, attack_pressure: 0,
      effective_theta: 0.3, health_band: 'OPTIMAL', theta: 0.3,
      lyapunov_V_before: 0, lyapunov_V: 0, delta_V: 0,
      lyapunov_status: 'measured_not_proven', stability_ratio: 1,
      epsilon_injected: false, suspension_triggered: false,
      semantic_signal: semanticSignal, prompt_threat_signal: 0, temperature: 0.2,
      invariance_violations: 0, governor_sensing: governorSensing,
      z_weights: [1 / 3, 1 / 3, 1 / 3], version: 'test', raw_provider: 'test',
      governed_provider: 'test', governed_source: 'governed',
      transition_version: 'test', transition_input: {} as never,
      transition_hash: 'transition', descent_guard_triggered: false,
      descent_guard_scale: 1,
    },
  } as unknown as KernelCycleResult;
}

function persistedTrajectory(crs: CRS, nStable = 0) {
  return {
    session_id: 'stability-session', velocity: 0, n_stable: nStable,
    drift_dir: 'stable', sigma_viol: 0, last_m: Math.min(crs.C, crs.R, crs.S),
    last_c: crs.C, last_r: crs.R, last_s: crs.S,
    z_c: 1 / 3, z_r: 1 / 3, z_s: 1 / 3,
    attack_pressure: 0, updated_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  trajectory.current = persistedTrajectory({ C: 0.333, R: 0.333, S: 0.334 });
  execute.mockImplementation(async (statement: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof statement === 'string' ? statement : statement.sql;
    const args = typeof statement === 'string' ? [] : (statement.args ?? []);
    if (/SELECT \* FROM z_traj WHERE session_id/.test(sql)) {
      return { rows: trajectory.current ? [trajectory.current] : [] };
    }
    if (/INSERT INTO z_traj/.test(sql)) {
      const [sessionId, velocity, nStable, driftDir, sigmaViol, lastM, lastC, lastR, lastS,
        zC, zR, zS, attackPressure, updatedAt] = args;
      trajectory.current = {
        session_id: sessionId, velocity, n_stable: nStable, drift_dir: driftDir,
        sigma_viol: sigmaViol, last_m: lastM, last_c: lastC, last_r: lastR, last_s: lastS,
        z_c: zC, z_r: zR, z_s: zS, attack_pressure: attackPressure, updated_at: updatedAt,
      };
      return { rows: [], rowsAffected: 1 };
    }
    if (sql.includes('SELECT lyp_detection_turn')) return { rows: [] };
    return { rows: [], rowsAffected: 1 };
  });
});

describe('writeKernelReceipt turn-to-turn stability baseline', () => {
  it('increments n_stable from zero to one and then two for near-identical governed turns', async () => {
    const firstGoverned = { C: 0.334, R: 0.333, S: 0.333 };
    const secondGoverned = { C: 0.335, R: 0.332, S: 0.333 };
    const deliberatelyDifferentRaw = { C: 0.1, R: 0.8, S: 0.1 };

    await writeKernelReceipt('stability-session', 1, cycleResult(firstGoverned, deliberatelyDifferentRaw));
    expect(trajectory.current?.n_stable).toBe(1);
    expect(trajectory.current?.velocity).toBeLessThan(0.02);

    await writeKernelReceipt('stability-session', 2, cycleResult(secondGoverned, deliberatelyDifferentRaw));
    expect(trajectory.current?.n_stable).toBe(2);
    expect(trajectory.current?.velocity).toBeLessThan(0.02);
  });

  it('resets n_stable to zero after a large governed-state jump', async () => {
    trajectory.current = persistedTrajectory({ C: 0.333, R: 0.333, S: 0.334 }, 2);

    await writeKernelReceipt('stability-session', 3, cycleResult(
      { C: 0.5, R: 0.25, S: 0.25 },
      { C: 0.333, R: 0.333, S: 0.334 },
    ));

    expect(trajectory.current?.velocity).toBeGreaterThanOrEqual(0.02);
    expect(trajectory.current?.n_stable).toBe(0);
  });

  it('uses persisted last CRS, rather than this turn raw_state, as the previous sample', async () => {
    const persisted = { C: 0.333, R: 0.333, S: 0.334 };
    const raw = { C: 0.9, R: 0.05, S: 0.05 };
    const governed = { C: 0.334, R: 0.333, S: 0.333 };
    trajectory.current = persistedTrajectory(persisted);

    await writeKernelReceipt('stability-session', 4, cycleResult(governed, raw));

    // This is the distance from the persisted previous turn and is below the
    // unchanged 0.02 limit; distance from raw_state would be far above it.
    const expectedVelocity = Math.sqrt(
      (governed.C - persisted.C) ** 2
      + (governed.R - persisted.R) ** 2
      + (governed.S - persisted.S) ** 2,
    );
    expect(trajectory.current?.velocity).toBeCloseTo(expectedVelocity, 12);
    expect(trajectory.current?.n_stable).toBe(1);
    expect(trajectory.current?.last_c).toBe(governed.C);
    expect(trajectory.current?.last_r).toBe(governed.R);
    expect(trajectory.current?.last_s).toBe(governed.S);
  });
});
