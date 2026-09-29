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

  it('denies non-read execution when canonical M is stressed', () => {
    const gate = canonicalExecutionAllowed({
      sessionId: 's',
      actorId: 'a',
      C: 0.20,
      R: 0.10,
      S: 0.30,
      M: 0.10,
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
    expect(gate.reason).toContain('non-read capability suspended');
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
