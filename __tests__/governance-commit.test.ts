import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transaction, execute, canonicalRead } = vi.hoisted(() => ({
  transaction: vi.fn(),
  execute: vi.fn(),
  canonicalRead: vi.fn(),
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({ transaction, execute }),
}));

vi.mock('../lib/agents/canonical_governance_state', () => ({
  readCanonicalGovernanceState: canonicalRead,
}));

import {
  commitGovernanceDecision,
  GovernanceCommitConflict,
} from '../lib/agents/governance_commit';

const state = {
  session_id: 'commit-session',
  sigma_viol: 0.2,
  n_stable: 1,
  locked: false,
  tool_calls: 2,
  state_version: 4,
  updated_at: '2026-09-16T09:00:00.000Z',
};

const receipt = {
  receipt_id: 'receipt-1',
  session_id: state.session_id,
  actor_id: 'api_key:caller-1',
  tool_name: 'write_file',
  args_hash: 'args-hash',
  decision: 'APPROVED_HIGH',
  crs: { C: 0.9, R: 0.9, S: 0.9, M: 0.9, risk_level: 'HIGH' as const },
  reason: 'approved',
  sigma_viol: state.sigma_viol,
  canary_receipt_id: 'canary-audit-id',
  state_snapshot: JSON.stringify({ C: 0.2, R: 0.3, S: 0.4, M: 0.2 }),
};

const currentStateVersion = 'canonical-governance-2026-10-10.1';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CANARY_MODE', 'invariant');
  canonicalRead.mockResolvedValue({
    available: true,
    state: {
      trajectoryAvailable: true,
      version: currentStateVersion,
      M: 0.2,
      sigmaViol: 0,
      nStable: 3,
    },
  });
  execute.mockResolvedValue({ rows: [{
    canary_status: 'passed',
    receipt_id: 'canary-audit-id',
    state_version: currentStateVersion,
    issued_at: new Date(Date.now() - 1_000).toISOString(),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    writes: 0,
  }] });
});

describe('transactional governance commit', () => {
  it('commits state and receipt together', async () => {
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowsAffected: 1 }),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    };
    transaction.mockResolvedValueOnce(tx);

    const committed = await commitGovernanceDecision(state, 4, receipt);

    expect(tx.execute).toHaveBeenCalledTimes(4);
    expect(tx.execute.mock.calls[3][0].args[2]).toBe('api_key:caller-1');
    expect(tx.execute.mock.calls[3][0].args[14]).toBeNull();
    expect(typeof tx.execute.mock.calls[3][0].args[15]).toBe('string');
    expect(tx.execute.mock.calls[3][0].args[17]).toBe('canary-audit-id');
    expect(tx.execute.mock.calls[3][0].args[18]).toContain('M');
    expect(tx.commit).toHaveBeenCalledOnce();
    expect(tx.rollback).not.toHaveBeenCalled();
    expect(committed.state_version).toBe(5);
  });

  it('records a valid canary ID but stores NULL for an expired canary', async () => {
    const makeTransaction = () => ({
      execute: vi.fn()
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowsAffected: 1 }),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    });

    const expiredTx = makeTransaction();
    execute.mockResolvedValueOnce({ rows: [{
      canary_status: 'passed',
      receipt_id: 'canary-audit-id',
      state_version: currentStateVersion,
      issued_at: new Date(Date.now() - 120_000).toISOString(),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      writes: 0,
    }] });
    transaction.mockResolvedValueOnce(expiredTx);
    await commitGovernanceDecision(state, 4, receipt);
    expect(expiredTx.execute.mock.calls[3][0].args[17]).toBeNull();

    const validTx = makeTransaction();
    execute.mockResolvedValueOnce({ rows: [{
      canary_status: 'passed',
      receipt_id: 'canary-audit-id',
      state_version: currentStateVersion,
      issued_at: new Date(Date.now() - 1_000).toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      writes: 0,
    }] });
    transaction.mockResolvedValueOnce(validTx);
    await commitGovernanceDecision(state, 4, receipt);
    expect(validTx.execute.mock.calls[3][0].args[17]).toBe('canary-audit-id');
  });

  it('rolls back and rejects a stale concurrent state version', async () => {
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rowsAffected: 0 })
        .mockResolvedValueOnce({ rowsAffected: 0 }),
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
    };
    transaction.mockResolvedValueOnce(tx);

    await expect(commitGovernanceDecision(state, 3, receipt))
      .rejects.toBeInstanceOf(GovernanceCommitConflict);

    expect(tx.commit).not.toHaveBeenCalled();
    expect(tx.rollback).toHaveBeenCalledOnce();
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it('rolls back when the receipt cannot be written', async () => {
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('receipt store unavailable')),
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
    };
    transaction.mockResolvedValueOnce(tx);

    await expect(commitGovernanceDecision(state, 4, receipt))
      .rejects.toThrow('receipt store unavailable');

    expect(tx.commit).not.toHaveBeenCalled();
    expect(tx.rollback).toHaveBeenCalledOnce();
  });

  it('does not permit actor-attributed state to commit without its receipt', async () => {
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error('actor receipt persistence failed')),
      commit: vi.fn(),
      rollback: vi.fn().mockResolvedValue(undefined),
    };
    transaction.mockResolvedValueOnce(tx);

    await expect(commitGovernanceDecision(state, 4, receipt))
      .rejects.toThrow('actor receipt persistence failed');
    expect(tx.commit).not.toHaveBeenCalled();
    expect(tx.rollback).toHaveBeenCalledOnce();
    expect(tx.execute.mock.calls[3][0].args[2]).toBe('api_key:caller-1');
  });
});
