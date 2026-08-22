import { describe, expect, it } from 'vitest';
    import { simulateCbf, simulateCbfComparison } from '@/lib/cbf_simulation';

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
        expect(step.C + step.R + step.S).toBeCloseTo(1, 6);
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
    });
    