import { describe, expect, it } from 'vitest';
import { productionStateTransition, type ProductionTransitionInput } from '../lib/production_transition';
import { certifyProductionTransition } from '../lib/production_transition_certificate';

const input: ProductionTransitionInput = {
  state: { C: 0.3, R: 0.32, S: 0.38 },
  delta: { dc: 0.01, dr: -0.005, ds: 0.002 },
  postResponseDelta: { dc: -0.003, dr: 0.001, ds: 0.002 },
  activeLawDelta: null,
  semanticAttack: false,
  semanticSeverity: 0,
  advGain: 0.01,
  effectiveTheta: 1.5,
  threatSignal: 0.1,
  theta: 1.5,
};

describe('production transition certificate', () => {
  it('separates hard invariant evidence from unproven stability', () => {
    const result = productionStateTransition(input);
    const certificate = certifyProductionTransition(input, result);
    expect(certificate.hard_invariant_holds).toBe(true);
    expect(certificate.assumptions.finite_input).toBe(true);
    expect(certificate.assumptions.bounded_input).toBe(true);
    expect(certificate.assumptions.supported_floor).toBe(true);
    expect(certificate.stability_status).toBe('measured_not_proven');
    expect(Number.isFinite(certificate.lyapunov_delta)).toBe(true);
    expect(certificate.lyapunov_bound_holds).toBe(true);
    expect(certificate.lyapunov_change_bound).toBeGreaterThanOrEqual(Math.abs(certificate.lyapunov_delta));
  });

  it('marks an oversized input outside the analysis envelope', () => {
    const oversized = { ...input, delta: { dc: 6, dr: 0, ds: 0 } };
    const result = productionStateTransition(oversized);
    const certificate = certifyProductionTransition(oversized, result);
    expect(certificate.hard_invariant_holds).toBe(true);
    expect(certificate.assumptions.bounded_input).toBe(false);
  });
});
