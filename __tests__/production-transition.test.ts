import { describe, expect, it } from 'vitest';
import { lyapunovBarrierZ, TAU, Z_RECOVERY } from '../lib/aureonics_core';
import {
  isSimplexState,
  lyapunovDelta,
  productionStateTransition,
  productionTransitionPayload,
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
    const first = productionStateTransition(input);
    expect(first).toEqual(productionStateTransition(input));
    expect(productionTransitionPayload(input, first)).toBe(productionTransitionPayload(input, first));
  });

  it('rejects non-finite and out-of-range control inputs before mutation', () => {
    expect(() => productionStateTransition({ ...base, state: state(Number.NaN, 0.3, 0.7) })).toThrow(/state\.C must be finite/);
    expect(() => productionStateTransition({ ...base, state: state(0.3, 0.3, 0.4), semanticSeverity: 1.1 })).toThrow(/semanticSeverity must be in/);
    expect(() => productionStateTransition({ ...base, state: state(0.3, 0.3, 0.4), threatSignal: -0.1 })).toThrow(/threatSignal must be in/);
    expect(() => productionStateTransition({ ...base, state: state(0.3, 0.3, 0.4), theta: Number.POSITIVE_INFINITY })).toThrow(/theta must be finite/);
  });

  it('keeps the input object immutable and records projection movement', () => {
    const input = {
      ...base,
      state: state(0.06, 0.07, 0.87),
      activeLawDelta: { dc: -5, dr: 0, ds: 5 },
      semanticAttack: true,
      semanticSeverity: 1,
      threatSignal: 1,
    };
    const before = JSON.stringify(input);
    const result = productionStateTransition(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(isSimplexState(result.state, TAU, 1e-9)).toBe(true);
    expect(result.projectionMagnitude).toBeGreaterThan(0);
  });

  it('reports no projection movement when the raw state is already safe', () => {
    const result = productionStateTransition({ ...base, state: state(1 / 3, 1 / 3, 1 / 3) });
    expect(result.projectionTriggered).toBe(false);
    expect(result.projectionMagnitude).toBe(0);
    expect(result.rawState).toEqual(result.state);
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

  it('preserves hard invariants over a deterministic bounded-input horizon', () => {
    let seed = 20260918;
    let current = state(1 / 3, 1 / 3, 1 / 3);
    let maxProjection = 0;
    let lyapunovIncreases = 0;
    const next = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (let turn = 0; turn < 1000; turn++) {
      const dc = (next() - 0.5) * 0.04;
      const dr = (next() - 0.5) * 0.04;
      const ds = -dc - dr;
      const input = {
        ...base,
        state: current,
        delta: { dc, dr, ds },
        postResponseDelta: { dc: (next() - 0.5) * 0.02, dr: (next() - 0.5) * 0.02, ds: (next() - 0.5) * 0.02 },
        semanticAttack: next() > 0.8,
        semanticSeverity: next(),
        advGain: (next() - 0.5) * 0.04,
        threatSignal: next(),
      };
      const result = productionStateTransition(input);
      expect(isSimplexState(result.state, TAU, 1e-8)).toBe(true);
      expect(Object.values(result.state).every(Number.isFinite)).toBe(true);
      maxProjection = Math.max(maxProjection, result.projectionMagnitude);
      if (lyapunovDelta(current, result.state, Z_RECOVERY) > 0) lyapunovIncreases++;
      current = result.state;
    }
    expect(Number.isFinite(maxProjection)).toBe(true);
    expect(lyapunovIncreases).toBeGreaterThanOrEqual(0);
  });
});
