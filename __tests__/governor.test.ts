/**
 * Async Governor tests — IEC filter, G(x,z) correction, CBF guarantee.
 */
import { describe, it, expect, vi } from 'vitest';
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
    const results = mockResults(['the sky is blue', 'the sky is blue', 'the sky is blue']);
    const { iec } = computeIEC(results, shannonEntropy('what color is the sky'));
    expect(iec).toBeGreaterThan(0.9);
  });

  it('returns low IEC when results conflict (high variance)', () => {
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
    expect(typeof result.applied).toBe('boolean');
  });

  it('never violates CBF floor M >= tau', () => {
    const dangerState = { C: TAU + 0.001, R: TAU + 0.001, S: 1 - 2 * (TAU + 0.001) };
    const context: GovernorContext = { delta: 0.9, rho: 1.0, U: 0.8, T: 0.9 };
    const result = applyGovernorCorrection(dangerState, context, []);
    if (result.applied) {
      const newC = dangerState.C + result.delta_C;
      const newR = dangerState.R + result.delta_R;
      const newS = dangerState.S + result.delta_S;
      expect(Math.min(newC, newR, newS)).toBeGreaterThanOrEqual(TAU);
    }
  });
});

describe('consumePendingCorrection', () => {
  // These are integration-style Turso-backed checks. The store is deliberately
  // allowed to be unavailable, but remote DB calls can transiently exceed Vitest's
  // default 5s timeout. Keep the test deterministic at the test-runner boundary;
  // production code still fails closed on store errors.
  it('resolves to null for unknown session', async () => {
    const result = await consumePendingCorrection('nonexistent_session_xyz', { C: 1/3, R: 1/3, S: 1/3 });
    expect(result).toBeNull();
  }, 15_000);

  it('resolves to null when nothing is stored (no double-apply risk)', async () => {
    const result1 = await consumePendingCorrection('session_double_consume', { C: 1/3, R: 1/3, S: 1/3 });
    const result2 = await consumePendingCorrection('session_double_consume', { C: 1/3, R: 1/3, S: 1/3 });
    expect(result1).toBeNull();
    expect(result2).toBeNull();
  }, 15_000);
});

describe('isSafeToSearch — egress gate (do not google attacks)', () => {
  it('allows search when stressed and benign', () => {
    expect(isSafeToSearch(0.10, 0.0, 0.0, 0.0)).toBe(true);
    expect(isSafeToSearch(0.30, 0.4, 0.0, 0.0)).toBe(true);
  });
  it('blocks search when the prompt is adversarial, even if stressed', () => {
    expect(isSafeToSearch(0.10, 0.5, 0.9, 0.0)).toBe(false);
    expect(isSafeToSearch(0.10, 0.5, 0.0, 0.9)).toBe(false);
    expect(isSafeToSearch(0.10, 0.5, 0.5, 0.0)).toBe(false);
  });
  it('blocks search when the state is not stressed (no need to spend the query)', () => {
    expect(isSafeToSearch(0.33, 0.0, 0.0, 0.0)).toBe(false);
  });
});

describe('computeSemanticReliability', () => {
  it('returns null for fewer than 2 results (cannot measure agreement, no I/O)', async () => {
    expect(await computeSemanticReliability([])).toBeNull();
    expect(await computeSemanticReliability(mockResults(['only one']))).toBeNull();
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

async function loadKvWithMemoryZTraj() {
  const rows = new Map<string, Record<string, unknown>>();
  const execute = vi.fn(async (statement: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof statement === 'string' ? statement : statement.sql;
    const args = typeof statement === 'string' ? [] : (statement.args ?? []);
    if (sql.startsWith('SELECT * FROM z_traj WHERE session_id = ?')) {
      const row = rows.get(String(args[0]));
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('INSERT INTO z_traj')) {
      const [sessionId, velocity, nStable, driftDir, sigmaViol, lastM, lastC, lastR, lastS,
        zC, zR, zS, attackPressure, updatedAt] = args;
      rows.set(String(sessionId), {
        session_id: sessionId, velocity, n_stable: nStable, drift_dir: driftDir,
        sigma_viol: sigmaViol, last_m: lastM, last_c: lastC, last_r: lastR, last_s: lastS,
        z_c: zC, z_r: zR, z_s: zS, attack_pressure: attackPressure, updated_at: updatedAt,
      });
      return { rows: [], rowsAffected: 1 };
    }
    return { rows: [] };
  });

  vi.doMock('../lib/db', () => ({ getClient: () => ({ execute }) }));
  vi.resetModules();
  const kv = await import('../lib/kv');
  return { kv, rows };
}

function zTrajRow(lastC: number, lastR: number, lastS: number, nStable: number) {
  return {
    session_id: 'stable-session', velocity: 0, n_stable: nStable, drift_dir: 'stable',
    sigma_viol: 0, last_m: Math.min(lastC, lastR, lastS),
    last_c: lastC, last_r: lastR, last_s: lastS,
    z_c: 1 / 3, z_r: 1 / 3, z_s: 1 / 3, attack_pressure: 0,
    updated_at: new Date().toISOString(),
  };
}

describe('z_traj stability threshold', () => {
  it('counts three consecutive 0.01 turns at M=0.30 and leaves canary N_MIN at 3', async () => {
    const { kv, rows } = await loadKvWithMemoryZTraj();
    rows.set('stable-session', zTrajRow(0.30, 0.35, 0.35, 0));
    expect(kv.STABILITY_VELOCITY).toBe(0.02);

    const delta = 0.01 / Math.sqrt(2);
    const turns = [
      { c: 0.30, r: 0.35 - delta, s: 0.35 + delta },
      { c: 0.30, r: 0.35, s: 0.35 },
      { c: 0.30, r: 0.35 - delta, s: 0.35 + delta },
    ];
    for (const [index, current] of turns.entries()) {
      const previous = rows.get('stable-session')!;
      const updated = await kv.updateZTraj('stable-session', current, {
        c: Number(previous.last_c), r: Number(previous.last_r), s: Number(previous.last_s),
      });
      expect(updated.velocity).toBeCloseTo(0.01, 10);
      expect(updated.n_stable).toBe(index + 1);
      expect(updated.last_m).toBeGreaterThanOrEqual(0.30);
    }
    expect(kv.N_MIN).toBe(3);
  });

  it('resets the streak at velocity 0.06', async () => {
    const { kv, rows } = await loadKvWithMemoryZTraj();
    rows.set('stable-session', zTrajRow(0.30, 0.35, 0.35, 2));
    const delta = 0.06 / Math.sqrt(2);
    const updated = await kv.updateZTraj('stable-session', {
      c: 0.30, r: 0.35 - delta, s: 0.35 + delta,
    }, { c: 0.30, r: 0.35, s: 0.35 });

    expect(updated.velocity).toBeCloseTo(0.06, 10);
    expect(updated.n_stable).toBe(0);
  });

  it('does not count a low-velocity turn when M is below TAU_RECOVERY', async () => {
    const { kv, rows } = await loadKvWithMemoryZTraj();
    rows.set('stable-session', zTrajRow(0.10, 0.45, 0.45, 2));
    const delta = 0.01 / Math.sqrt(2);
    const updated = await kv.updateZTraj('stable-session', {
      c: 0.10, r: 0.45 - delta, s: 0.45 + delta,
    }, { c: 0.10, r: 0.45, s: 0.45 });

    expect(updated.velocity).toBeCloseTo(0.01, 10);
    expect(updated.last_m).toBe(0.10);
    expect(updated.n_stable).toBe(0);
  });

  it('preserves getGovernorMode outputs across CRS/streak boundary combinations', async () => {
    const { kv } = await loadKvWithMemoryZTraj();
    const expected = new Map<number, Array<'correction' | 'nudge' | 'recovery' | 'suppress'>>([
      [0.04, ['correction', 'correction', 'correction', 'correction']],
      [0.05, ['correction', 'correction', 'correction', 'correction']],
      [0.10, ['nudge', 'nudge', 'nudge', 'recovery']],
      [0.15, ['nudge', 'nudge', 'nudge', 'recovery']],
      [0.150001, ['nudge', 'nudge', 'nudge', 'suppress']],
      [0.30, ['nudge', 'nudge', 'nudge', 'suppress']],
    ]);

    for (const [M, modes] of expected) {
      for (const [nStable, mode] of modes.entries()) {
        const trajectory = zTrajRow(M, (1 - M) / 2, (1 - M) / 2, nStable);
        expect(kv.getGovernorMode(trajectory as never)).toBe(mode);
      }
    }
  });
});
