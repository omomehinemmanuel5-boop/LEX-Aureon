import { describe, expect, it, vi, beforeEach } from 'vitest';

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: dbExecute }),
}));

import {
  canonicalExecutionAllowed,
  readCanonicalGovernanceState,
} from '../lib/agents/canonical_governance_state';
import { recoveryCapabilityAllowed, deriveRecoveryState } from '../lib/agents/recovery_state';

describe('constitutional recovery policy', () => {
  it('preserves the 0.05 hard floor', () => {
    const gate = recoveryCapabilityAllowed(0.049, 'read', { nStable: 99, sigmaViol: 0, canaryPassed: true });
    expect(gate.allowed).toBe(false);
    expect(gate.state).toBe('QUARANTINED');
    expect(gate.reason).toContain('0.05');
  });

  it('keeps 0.05 through 0.149... in recovery-only mode', () => {
    for (const m of [0.05, 0.079, 0.08, 0.149]) {
      expect(recoveryCapabilityAllowed(m, 'read', { nStable: 0, sigmaViol: 1 }).allowed).toBe(true);
      expect(recoveryCapabilityAllowed(m, 'write', { nStable: 99, sigmaViol: 0, canaryPassed: true }).allowed).toBe(false);
    }
  });

  it('uses 0.15 as the minimum restoration threshold', () => {
    const before = recoveryCapabilityAllowed(0.1499, 'write', { nStable: 99, sigmaViol: 0, canaryPassed: true });
    const at = recoveryCapabilityAllowed(0.15, 'write', { nStable: 3, sigmaViol: 0, canaryPassed: true });
    expect(before.allowed).toBe(false);
    expect(at.allowed).toBe(true);
    expect(at.state).toBe('VERIFIED');
  });

  it('restores ordinary writes after verified evidence but keeps destructive actions gated until NORMAL', () => {
    const unverified = recoveryCapabilityAllowed(0.20, 'write', { nStable: 0, sigmaViol: 0, canaryPassed: false });
    const verified = recoveryCapabilityAllowed(0.20, 'write', { nStable: 3, sigmaViol: 0, canaryPassed: true });
    const destructive = recoveryCapabilityAllowed(0.20, 'destructive', { nStable: 3, sigmaViol: 0, canaryPassed: true });
    const destructiveNormal = recoveryCapabilityAllowed(0.25, 'destructive', { nStable: 3, sigmaViol: 0, canaryPassed: true });

    expect(unverified.allowed).toBe(false);
    expect(verified.allowed).toBe(true);
    expect(verified.state).toBe('VERIFIED');
    expect(destructive.allowed).toBe(false);
    expect(destructiveNormal.allowed).toBe(true);
    expect(destructiveNormal.state).toBe('NORMAL');
  });

  it('reaches NORMAL only at or above the optimal boundary with verified evidence', () => {
    expect(deriveRecoveryState(0.24, { nStable: 3, sigmaViol: 0, canaryPassed: true })).toBe('VERIFIED');
    expect(deriveRecoveryState(0.25, { nStable: 3, sigmaViol: 0, canaryPassed: true })).toBe('NORMAL');
  });
});

describe('canonical governance state', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('projects CRS and recovery state from z_traj rather than local tool scores', async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ last_c: 0.42, last_r: 0.18, last_s: 0.31, sigma_viol: 0.04, n_stable: 3, updated_at: '2026-10-10T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ sigma_viol: 0.12, tool_calls: 7 }] })
      .mockResolvedValueOnce({ rows: [{ canary_status: 'passed', receipt_id: 'canary-receipt' }] });

    const result = await readCanonicalGovernanceState({
      sessionId: 'canonical-session', actorId: 'agent-a', capability: 'read',
    });

    expect(result.available).toBe(true);
    expect(result.state).toMatchObject({
      C: 0.42, R: 0.18, S: 0.31, M: 0.18,
      sigmaViol: 0.12, toolCalls: 7, healthBand: 'ALERT',
      trajectoryAvailable: true,
      recoveryState: 'VERIFIED',
      canaryPassed: true,
      canaryReceiptId: 'canary-receipt',
    });
    expect(result.state.stateFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not infer a successful canary from M=0.333 and stable observations alone', async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ last_c: 1 / 3, last_r: 1 / 3, last_s: 1 / 3, sigma_viol: 0, n_stable: 3, updated_at: '2026-10-10T00:00:00.000Z' }] })
      .mockResolvedValueOnce({ rows: [{ sigma_viol: 0, tool_calls: 9 }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await readCanonicalGovernanceState({
      sessionId: 'unverified-optimal-session', actorId: 'agent-a', capability: 'write',
    });

    expect(result.available).toBe(true);
    expect(result.state.M).toBeCloseTo(1 / 3);
    expect(result.state.nStable).toBe(3);
    expect(result.state.canaryPassed).toBe(false);
    expect(result.state.recoveryState).toBe('RESTORING');
    expect(canonicalExecutionAllowed(result.state).allowed).toBe(false);
  });

  it('allows recovery reads below 0.15', () => {
    const gate = canonicalExecutionAllowed({
      sessionId: 's', actorId: 'a', C: 0.20, R: 0.07, S: 0.30, M: 0.07,
      healthBand: 'STRESSED', recoveryState: 'RECOVERING', sigmaViol: 0, toolCalls: 1,
      trajectoryAvailable: true, nStable: 0, authorization: 'authorized', policyRisk: 'read',
      version: 'test', observedAt: new Date().toISOString(),
    });
    expect(gate.allowed).toBe(true);
  });

  it('denies consequential execution below 0.15 even when M is above 0.08', () => {
    const gate = canonicalExecutionAllowed({
      sessionId: 's', actorId: 'a', C: 0.20, R: 0.10, S: 0.70, M: 0.10,
      healthBand: 'STRESSED', recoveryState: 'RECOVERING', sigmaViol: 0, toolCalls: 1,
      trajectoryAvailable: true, nStable: 3, authorization: 'authorized', policyRisk: 'write',
      version: 'test', observedAt: new Date().toISOString(),
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('0.15');
  });

  it('denies every capability below the 0.05 constitutional floor', () => {
    const gate = canonicalExecutionAllowed({
      sessionId: 's', actorId: 'a', C: 0.04, R: 0.40, S: 0.56, M: 0.04,
      healthBand: 'CRITICAL', recoveryState: 'QUARANTINED', sigmaViol: 0, toolCalls: 1,
      trajectoryAvailable: true, nStable: 99, authorization: 'authorized', policyRisk: 'read',
      version: 'test', observedAt: new Date().toISOString(),
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('τ_floor');
  });

  it('fails closed when the canonical state store is unavailable', async () => {
    dbExecute.mockRejectedValue(new Error('state store unavailable'));
    const result = await readCanonicalGovernanceState({
      sessionId: 'outage', actorId: 'agent-a', capability: 'read',
    });
    expect(result.available).toBe(false);
    expect(result.state.M).toBe(0);
    expect(result.state.recoveryState).toBe('QUARANTINED');
  });
});
