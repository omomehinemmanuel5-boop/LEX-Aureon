import { describe, expect, it } from 'vitest';
    import { simulateCbf, simulateCbfComparison } from '@/lib/cbf_simulation';
    import { cbfQPFilter, projectToSimplex } from '@/lib/aureonics_core';

    const EPSILON = 1e-7;

    describe('CBF simulator invariants', () => {
    it('is deterministic for the same seed and parameters', () => {
      const options = { seed: 42, steps: 40, dt: 0.1, cbfEnabled: true };
      expect(simulateCbf(options)).toEqual(simulateCbf(options));
    });

    it.each([1, 7, 42, 99, 2026])('keeps governed states in the simplex for seed %s', (seed) => {
      const result = simulateCbf({ seed, steps: 100, dt: 0.1, cbfEnabled: true });
      for (const step of result.trajectory) {
        expect(step.C).toBeGreaterThanOrEqual(result.tau_cbf - EPSILON);
        expect(step.R).toBeGreaterThanOrEqual(result.tau_cbf - EPSILON);
        expect(step.S).toBeGreaterThanOrEqual(result.tau_cbf - EPSILON);
        // Trajectory coordinates are intentionally serialized to six decimals.
      expect(step.C + step.R + step.S).toBeCloseTo(1, 5);
        expect(Number.isFinite(step.M)).toBe(true);
        expect(Number.isFinite(step.lyapunov_V)).toBe(true);
      }
      expect(result.invariance_violations).toBe(0);
      expect(result.safety_violated).toBe(false);
    });

    it('does not emit non-finite values under noisy counterfactual conditions', () => {
      const result = simulateCbf({ seed: 123, steps: 250, dt: 0.1, cbfEnabled: false });
      expect(result.trajectory.every(step =>
        [step.C, step.R, step.S, step.M, step.lyapunov_V, step.delta_V].every(Number.isFinite)
      )).toBe(true);
    });

    it('reports the governed and ungoverned arms from the same seed', () => {
      const comparison = simulateCbfComparison({ seed: 42, steps: 100, dt: 0.1 });
      expect(comparison.governed.seed).toBe(comparison.ungoverned.seed);
      expect(comparison.governed.steps).toBe(comparison.ungoverned.steps);
      expect(comparison.safety_guarantee_holds).toBe(!comparison.governed.safety_violated);
    });
    it('preserves control conservation and the hard floor at the CBF boundary', () => {
      const cases: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [
        [[0.05, 0.20, 0.75], [0.20, -0.10, -0.10], [-0.40, 0.25, 0.15]],
        [[0.051, 0.474, 0.475], [-0.30, 0.15, 0.15], [-0.20, 0.10, 0.10]],
        [[1 / 3, 1 / 3, 1 / 3], [0.50, -0.25, -0.25], [0.30, -0.10, -0.20]],
      ];
      for (const [x, f, desired] of cases) {
        const u = cbfQPFilter(x, f, desired, 0.05, 0.1);
        expect(u.every(Number.isFinite)).toBe(true);
        expect(u[0] + u[1] + u[2]).toBeCloseTo(0, 10);
        for (let i = 0; i < 3; i++) expect(x[i] + 0.1 * (f[i] + u[i])).toBeGreaterThanOrEqual(0.05 - EPSILON);
      }
    });
    it('makes floor-constrained simplex projection idempotent', () => {
      const projected = projectToSimplex([-0.4, 0.2, 1.2], 0.05);
      const projectedAgain = projectToSimplex(projected, 0.05);
      expect(projectedAgain).toEqual(projected);
    });
    it('preserves feasibility across a deterministic bounded stress set', () => {
      let seed = 8811;
      const next = () => {
        seed = (1103515245 * seed + 12345) >>> 0;
        return seed / 0xffffffff;
      };
      for (let n = 0; n < 500; n++) {
        const c = 0.05 + next() * 0.55;
        const r = 0.05 + next() * (0.90 - c);
        const x: [number, number, number] = [c, r, 1 - c - r];
        const f0 = (next() - 0.5) * 0.4;
        const f1 = (next() - 0.5) * 0.4;
        const f: [number, number, number] = [f0, f1, -f0 - f1];
        const u0 = (next() - 0.5) * 0.4;
        const u1 = (next() - 0.5) * 0.4;
        const u = cbfQPFilter(x, f, [u0, u1, -u0 - u1], 0.05, 0.1);
        expect(u.every(Number.isFinite)).toBe(true);
        expect(u[0] + u[1] + u[2]).toBeCloseTo(0, 9);
        for (let i = 0; i < 3; i++) expect(x[i] + 0.1 * (f[i] + u[i])).toBeGreaterThanOrEqual(0.05 - EPSILON);
      }
    });
    });
