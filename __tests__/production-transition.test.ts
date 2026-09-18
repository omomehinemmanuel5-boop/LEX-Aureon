import { describe, expect, it } from 'vitest';
import { lyapunovBarrierZ, TAU, Z_RECOVERY } from '../lib/aureonics_core';
import {
  isSimplexState,
  lyapunovDelta,
  productionStateTransition,
  type ProductionState,
} from '../lib/production_transition';

const base = {
  delta: { dc: 0.02, dr: -0.01, ds: 0.015 },
  postResponseDelta: { dc: -0.01, dr: 0.005, ds: 0.003 },
  activeLawDelta: null,
  semanticAttack: false,
  semanticSeverity: 0,
  advGain: 0.01,
  effectiveTheta: 1.5,
  threatSignal: 0,
  theta: 1.5,
};

function state(c: number, r: number, s: number): ProductionState {
  return { C: c, R: r, S: s };
}

describe('authoritative production CRS transition', () => {
  it('preserves simplex and floor invariants under benign and adversarial inputs', () => {
    const cases = [
      state(1 / 3, 1 / 3, 1 / 3),
      state(0.05, 0.20, 0.75),
      state(0.08, 0.46, 0.46),
      state(0.20, 0.20, 0.60),
    ];

    for (const initial of cases) {
      const result = productionStateTransition({
        ...base,
        state: initial,
        activeLawDelta: { dc: -0.5, dr: 0, ds: 0.5 },
        semanticAttack: true,
        semanticSeverity: 1,
        threatSignal: 1,
      });
      expect(isSimplexState(result.state, TAU, 1e-9)).toBe(true);
      expect(Number.isFinite(result.projectionMagnitude)).toBe(true);
    }
  });

  it('is deterministic and replayable from the same receipt inputs', () => {
    const input = {
      ...base,
      state: state(0.27, 0.31, 0.42),
      activeLawDelta: { dc: -0.2, dr: 0.1, ds: 0.1 },
      semanticAttack: true,
      semanticSeverity: 0.82,
      threatSignal: 0.4,
    };
    expect(productionStateTransition(input)).toEqual(productionStateTransition(input));
  });

  it('reports the exact deployed Vz delta from previous and next states', () => {
    const previous = state(0.27, 0.31, 0.42);
    const result = productionStateTransition({ ...base, state: previous });
    const delta = lyapunovDelta(previous, result.state, Z_RECOVERY);
    expect(delta).toBeCloseTo(
      lyapunovBarrierZ([result.state.C, result.state.R, result.state.S], Z_RECOVERY) -
        lyapunovBarrierZ([previous.C, previous.R, previous.S], Z_RECOVERY),
      12,
    );
  });

  it('records whether projection was required by a below-floor raw state', () => {
    const result = productionStateTransition({
      ...base,
      state: state(0.06, 0.07, 0.87),
      activeLawDelta: { dc: -5, dr: 0, ds: 5 },
      semanticAttack: true,
      semanticSeverity: 1,
      threatSignal: 1,
    });
    expect(result.projectionTriggered).toBe(true);
    expect(result.state.C).toBeGreaterThanOrEqual(TAU - 1e-9);
    expect(result.state.R).toBeGreaterThanOrEqual(TAU - 1e-9);
    expect(result.state.S).toBeGreaterThanOrEqual(TAU - 1e-9);
  });
});
