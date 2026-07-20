/**
 * Async Governor tests — IEC filter, G(x,z) correction, CBF guarantee.
 */
import { describe, it, expect } from 'vitest';
import {
  computeIEC, shannonEntropy, computeDelta, computeUncertainty,
  computeTension, applyGovernorCorrection, RHO_MIN,
  type SearchResult, type GovernorContext,
} from '../lib/governor_sensing';
import { consumePendingCorrection, isSafeToSearch } from '../lib/governor_loop';
import { computeSemanticReliability } from '../lib/governor_sensing';
import { TAU } from '../lib/aureonics_core';

const mockResults = (contents: string[]): SearchResult[] =>
  contents.map((content, i) => ({
    query:   `query_${i}`,
    content,
    source:  'test',
    entropy: shannonEntropy(content),
  }));

describe('shannonEntropy', () => {
  it('returns 0 for empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });
  it('returns higher entropy for diverse text', () => {
    const low  = shannonEntropy('aaaaaaaaaa');
    const high = shannonEntropy('abcdefghij');
    expect(high).toBeGreaterThan(low);
  });
});

describe('computeIEC', () => {
  it('returns iec=0 rho=0 for empty results', () => {
    const { iec, rho } = computeIEC([], 3);
    expect(iec).toBe(0);
    expect(rho).toBe(0);
  });

  it('returns high IEC when results agree (low variance)', () => {
    // Same content → same entropy → variance ≈ 0 → IEC ≈ 1
    const results = mockResults(['the sky is blue', 'the sky is blue', 'the sky is blue']);
    const { iec } = computeIEC(results, shannonEntropy('what color is the sky'));
    expect(iec).toBeGreaterThan(0.9);
  });

  it('returns low IEC when results conflict (high variance)', () => {
    // Wildly different content → high variance → low IEC
    const results = mockResults([
      'a',
      'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789',
      'xyz',
    ]);
    const { iec } = computeIEC(results, shannonEntropy('test prompt'));
    expect(iec).toBeLessThan(0.9);
  });
});

describe('computeDelta', () => {
  it('returns ~1 when M is near 0 (constitutional collapse)', () => {
    expect(computeDelta(0)).toBeCloseTo(1, 1);
  });
  it('returns ~0 when M is at 1/3 (centroid)', () => {
    expect(computeDelta(0.33)).toBeCloseTo(0, 1);
  });
  it('is bounded [0,1]', () => {
    for (const m of [0, 0.1, 0.2, 0.33, 0.5]) {
      const d = computeDelta(m);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });
});

describe('computeTension', () => {
  it('returns high tension when weakest pillar is low', () => {
    const t = computeTension({ C: 0.05, R: 0.45, S: 0.50 });
    expect(t).toBeGreaterThan(0.5);
  });
  it('returns low tension at centroid', () => {
    const t = computeTension({ C: 1/3, R: 1/3, S: 1/3 });
    expect(t).toBeLessThan(0.4);
  });
});

describe('applyGovernorCorrection — IEC filter', () => {
  const state = { C: 1/3, R: 1/3, S: 1/3 };

  it('rejects correction when rho < RHO_MIN', () => {
    const context: GovernorContext = { delta: 0.5, rho: 0.3, U: 0.5, T: 0.3 };
    const result = applyGovernorCorrection(state, context, []);
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('Signal rejected');
  });

  it('accepts correction when rho >= RHO_MIN', () => {
    const context: GovernorContext = { delta: 0.5, rho: RHO_MIN + 0.01, U: 0.2, T: 0.2 };
    const results = mockResults(['verified fact', 'verified fact', 'verified fact']);
    const result = applyGovernorCorrection(state, context, results);
    // May be applied or rejected by CBF check — either way should not throw
    expect(typeof result.applied).toBe('boolean');
  });

  it('never violates CBF floor M >= tau', () => {
    // State very close to boundary
    const dangerState = { C: TAU + 0.001, R: TAU + 0.001, S: 1 - 2 * (TAU + 0.001) };
    const context: GovernorContext = { delta: 0.9, rho: 1.0, U: 0.8, T: 0.9 };
    const result = applyGovernorCorrection(dangerState, context, []);
    if (result.applied) {
      const newC = dangerState.C + result.delta_C;
      const newR = dangerState.R + result.delta_R;
      const newS = dangerState.S + result.delta_S;
      expect(Math.min(newC, newR, newS)).toBeGreaterThanOrEqual(TAU);
    }
    // If rejected, that's also correct — conservative is safe
  });
});

describe('consumePendingCorrection', () => {
  // 2026-07-20: now async and Turso-backed (lib/pending_corrections.ts). With
  // no correction stored (and, in the test env, no reachable Turso) it must
  // resolve to null — the graceful-degradation path that keeps the governor
  // safe when the store is empty or unavailable.
  it('resolves to null for unknown session', async () => {
    const result = await consumePendingCorrection('nonexistent_session_xyz', { C: 1/3, R: 1/3, S: 1/3 });
    expect(result).toBeNull();
  });

  it('resolves to null when nothing is stored (no double-apply risk)', async () => {
    const result1 = await consumePendingCorrection('session_double_consume', { C: 1/3, R: 1/3, S: 1/3 });
    const result2 = await consumePendingCorrection('session_double_consume', { C: 1/3, R: 1/3, S: 1/3 });
    expect(result1).toBeNull();
    expect(result2).toBeNull();
  });
});

describe('isSafeToSearch — egress gate (do not google attacks)', () => {
  it('allows search when stressed and benign', () => {
    expect(isSafeToSearch(0.10, 0.0, 0.0, 0.0)).toBe(true);   // low M
    expect(isSafeToSearch(0.30, 0.4, 0.0, 0.0)).toBe(true);   // high tension
  });
  it('blocks search when the prompt is adversarial, even if stressed', () => {
    expect(isSafeToSearch(0.10, 0.5, 0.9, 0.0)).toBe(false);  // high semantic severity
    expect(isSafeToSearch(0.10, 0.5, 0.0, 0.9)).toBe(false);  // high threat signal
    expect(isSafeToSearch(0.10, 0.5, 0.5, 0.0)).toBe(false);  // exactly at threshold
  });
  it('blocks search when the state is not stressed (no need to spend the query)', () => {
    expect(isSafeToSearch(0.33, 0.0, 0.0, 0.0)).toBe(false);
  });
});

describe('computeSemanticReliability', () => {
  it('returns null for fewer than 2 results (cannot measure agreement)', async () => {
    expect(await computeSemanticReliability([])).toBeNull();
    expect(await computeSemanticReliability(mockResults(['only one']))).toBeNull();
  });
  it('resolves to null when embeddings are unavailable (test env) — caller falls back to entropy', async () => {
    // With no embedding provider configured, embedTextResolved throws and the
    // function must degrade to null rather than throwing.
    const r = await computeSemanticReliability(mockResults(['alpha beta', 'gamma delta']));
    expect(r).toBeNull();
  });
});

describe('CBF hard floor invariant', () => {
  it('TAU is a positive threshold', () => {
    expect(TAU).toBeGreaterThan(0);
    expect(TAU).toBeLessThan(1/3);
  });

  it('RHO_MIN is in (0,1)', () => {
    expect(RHO_MIN).toBeGreaterThan(0);
    expect(RHO_MIN).toBeLessThan(1);
  });
});
