import { describe, expect, it, vi, beforeEach } from 'vitest';

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: dbExecute }),
}));

import {
  canonicalExecutionAllowed,
  readCanonicalGovernanceState,
} from '../lib/agents/canonical_governance_state';

describe('canonical governance state', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('projects CRS and health from z_traj rather than local tool scores', async () => {
    dbExecute
      .mockResolvedValueOnce({
        rows: [{
          session_id: 'canonical-session',
          last_c: 0.42,
          last_r: 0.18,
          last_s: 0.31,
          last_m: 0.18,
          sigma_viol: 0.04,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ sigma_viol: 0.12, tool_calls: 7 }],
      });

    const result = await readCanonicalGovernanceState({
      sessionId: 'canonical-session',
      actorId: 'agent-a',
      capability: 'read',
    });

    expect(result.available).toBe(true);
    expect(result.state).toMatchObject({
      C: 0.42,
      R: 0.18,
      S: 0.31,
      M: 0.18,
      sigmaViol: 0.12,
      toolCalls: 7,
      healthBand: 'ALERT',
      trajectoryAvailable: true,
    });
  });

  it('denies non-read execution when canonical M is in STRESSED health', () => {
    const gate = canonicalExecutionAllowed({
      sessionId: 's',
      actorId: 'a',
      C: 0.20,
      R: 0.07,
      S: 0.30,
      M: 0.07,
      healthBand: 'STRESSED',
      sigmaViol: 0,
      toolCalls: 1,
      trajectoryAvailable: true,
      authorization: 'approval_required',
      policyRisk: 'write',
      version: 'test',
      observedAt: new Date().toISOString(),
    });

    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('STRESSED/CRITICAL health');
  });

  it('denies every capability below the constitutional floor', () => {
    const gate = canonicalExecutionAllowed({
      sessionId: 's',
      actorId: 'a',
      C: 0.04,
      R: 0.40,
      S: 0.56,
      M: 0.04,
      healthBand: 'CRITICAL',
      sigmaViol: 0,
      toolCalls: 1,
      trajectoryAvailable: true,
      authorization: 'authorized',
      policyRisk: 'read',
      version: 'test',
      observedAt: new Date().toISOString(),
    });

    expect(gate.allowed).toBe(false);
    expect(gate.reason).toContain('τ_floor');
  });

  it('allows read-only bootstrap while denying consequential execution when z_traj is uninitialized', async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ sigma_viol: 0, tool_calls: 0 }] });

    const result = await readCanonicalGovernanceState({
      sessionId: 'uninitialized',
      actorId: 'agent-a',
      capability: 'read',
    });

    expect(result.available).toBe(true);
    expect(result.state.M).toBe(0);
    expect(result.state.healthBand).toBe('CRITICAL');
    expect(result.state.trajectoryAvailable).toBe(false);
    expect(result.reason).toContain('read-only diagnostics remain available');

    const readGate = canonicalExecutionAllowed(result.state);
    expect(readGate.allowed).toBe(true);

    const writeState = { ...result.state, policyRisk: 'write' as const };
    const writeGate = canonicalExecutionAllowed(writeState);
    expect(writeGate.allowed).toBe(false);
    expect(writeGate.reason).toContain('consequential capability execution is suspended');
  });

  it('fails closed when the canonical state store is unavailable', async () => {
    dbExecute.mockRejectedValue(new Error('state store unavailable'));

    const result = await readCanonicalGovernanceState({
      sessionId: 'outage',
      actorId: 'agent-a',
      capability: 'read',
    });

    expect(result.available).toBe(false);
    expect(result.state.M).toBe(0);
    expect(result.state.healthBand).toBe('CRITICAL');
  });
});