import { describe, expect, it } from 'vitest';
import { lyapunovBarrierZ, TAU, Z_RECOVERY } from '../lib/aureonics_core';
import { productionStateTransition, productionTransitionPayload, type ProductionState, type ProductionTransitionInput } from '../lib/production_transition';
import { verifyProductionReceipt, type PersistedTransitionReceipt } from '../lib/production_receipt_verifier';
import { createHash } from 'crypto';

const input: ProductionTransitionInput = {
  state: { C: 0.27, R: 0.31, S: 0.42 },
  delta: { dc: 0.02, dr: -0.01, ds: 0.015 },
  postResponseDelta: { dc: -0.01, dr: 0.005, ds: 0.003 },
  activeLawDelta: { dc: -0.2, dr: 0.1, ds: 0.1 },
  semanticAttack: true,
  semanticSeverity: 0.82,
  advGain: 0.01,
  effectiveTheta: 1.5,
  threatSignal: 0.4,
  theta: 1.5,
};
function makeReceipt(): PersistedTransitionReceipt {
  const result = productionStateTransition(input);
  const previousV = lyapunovBarrierZ([input.state.C, input.state.R, input.state.S], Z_RECOVERY);
  const nextV = lyapunovBarrierZ([result.state.C, result.state.R, result.state.S], Z_RECOVERY);
  return {
    transition_version: 'production-transition-v1',
    transition_input: input,
    transition_hash: createHash('sha256').update(productionTransitionPayload(input, result)).digest('hex'),
    projected_state: result.state,
    raw_state: result.rawState,
    projection_magnitude: result.projectionMagnitude,
    projection_triggered: result.projectionTriggered,
    epsilon_injected: result.epsilonInjected,
    suspension_triggered: result.suspensionTriggered,
    lyapunov_v_before: previousV,
    lyapunov_v: nextV,
    delta_v: nextV - previousV,
    lyapunov_status: 'measured_not_proven',
  };
}
describe('production transition receipt verifier', () => {
  it('verifies a valid replay receipt without external dependencies', () => {
    const result = verifyProductionReceipt(makeReceipt());
    expect(result.hash_valid).toBe(true);
    expect(result.replay_matches).toBe(true);
    expect(result.simplex_valid).toBe(true);
    expect(result.floor_valid).toBe(true);
    expect(result.theta_valid).toBe(true);
    expect(result.lyapunov_consistent).toBe(true);
    expect(result.lyapunov_status).toBe('measured_not_proven');
    expect(result.errors).toEqual([]);
  });
  it('detects tampering with persisted transition evidence', () => {
    const receipt = makeReceipt();
    receipt.projected_state = { ...receipt.projected_state, C: TAU } as ProductionState;
    const result = verifyProductionReceipt(receipt);
    expect(result.hash_valid).toBe(true);
    expect(result.replay_matches).toBe(false);
    expect(result.errors).toContain('persisted transition result does not match replay');
  });
});
