import { describe, test, expect } from 'vitest';
import { CONSTITUTION, assertSimplex, projectCRSToConstitutionalSimplex } from '../lib/constitution';

describe('constitutional constants', () => {
  test('constants object is frozen', () => {
    expect(Object.isFrozen(CONSTITUTION)).toBe(true);
  });

  test('TAU_FLOOR is 0.05', () => {
    expect(CONSTITUTION.TAU_FLOOR).toBe(0.05);
  });

  test('TAU_RECOVERY is 0.15', () => {
    expect(CONSTITUTION.TAU_RECOVERY).toBe(0.15);
  });

  test('TAU_LYAPUNOV is 0.08', () => {
    expect(CONSTITUTION.TAU_LYAPUNOV).toBe(0.08);
  });

  test('SIMPLEX_SUM is 1.0', () => {
    expect(CONSTITUTION.SIMPLEX_SUM).toBe(1.0);
  });

  test('remaining frozen constants match the published constitutional contract', () => {
    expect(CONSTITUTION.N_MIN).toBe(3);
    expect(CONSTITUTION.RECOVERY_RATE).toBe(0.02);
    expect(CONSTITUTION.SIGMA_THRESHOLD).toBe(0.25);
    expect(CONSTITUTION.K0).toBe(0.3);
    expect(CONSTITUTION.EPSILON_K).toBe(0.01);
  });
});

describe('assertSimplex', () => {
  test('passes when C+R+S = 1', () => {
    expect(() => assertSimplex(0.4, 0.3, 0.3)).not.toThrow();
  });

  test('passes with tiny float drift within 1e-9', () => {
    expect(() => assertSimplex(0.333_333_333_3, 0.333_333_333_3, 0.333_333_333_4)).not.toThrow();
  });

  test('throws on violation', () => {
    expect(() => assertSimplex(0.5, 0.5, 0.5)).toThrow(/C\+R\+S/);
  });

  test('throws on under-sum', () => {
    expect(() => assertSimplex(0.1, 0.1, 0.1)).toThrow(/C\+R\+S/);
  });
});
describe('projectCRSToConstitutionalSimplex', () => {
  test('preserves C+R+S=1 and enforces the constitutional floor', () => {
    const projected = projectCRSToConstitutionalSimplex(0.01, 0.01, 0.98);

    expect(projected.c).toBeGreaterThanOrEqual(CONSTITUTION.TAU_FLOOR);
    expect(projected.r).toBeGreaterThanOrEqual(CONSTITUTION.TAU_FLOOR);
    expect(projected.s).toBeGreaterThanOrEqual(CONSTITUTION.TAU_FLOOR);
    expect(projected.c + projected.r + projected.s).toBeCloseTo(CONSTITUTION.SIMPLEX_SUM, 12);
  });

  test('leaves an interior simplex point unchanged within numerical tolerance', () => {
    const projected = projectCRSToConstitutionalSimplex(0.33, 0.33, 0.34);

    expect(projected.c).toBeCloseTo(0.33, 12);
    expect(projected.r).toBeCloseTo(0.33, 12);
    expect(projected.s).toBeCloseTo(0.34, 12);
  });
});
