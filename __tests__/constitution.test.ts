import { describe, test, expect } from 'vitest';
import { CONSTITUTION, assertSimplex } from '../lib/constitution';

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

  test('TAU_GOVERNOR is 0.08', () => {
    expect(CONSTITUTION.TAU_GOVERNOR).toBe(0.08);
  });

  test('SIMPLEX_SUM is 1.0', () => {
    expect(CONSTITUTION.SIMPLEX_SUM).toBe(1.0);
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
