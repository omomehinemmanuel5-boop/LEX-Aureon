import { describe, expect, it, vi } from 'vitest';

const { transaction, execute } = vi.hoisted(() => ({
  transaction: vi.fn(),
  execute: vi.fn(),
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({ transaction, execute }),
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
  tool_name: 'write_file',
  args_hash: 'args-hash',
  decision: 'APPROVED_HIGH',
  crs: { C: 0.9, R: 0.9, S: 0.9, M: 0.9, risk_level: 'HIGH' as const },
  reason: 'approved',
  sigma_viol: state.sigma_viol,
};

describe('transactional governance commit', () => {
  it('commits state and receipt together', async () => {
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 }),
      commit: vi.fn().mockResolvedValue(undefined),
      rollback: vi.fn().mockResolvedValue(undefined),
    };
    transaction.mockResolvedValueOnce(tx);

    const committed = await commitGovernanceDecision(state, 4, receipt);

    expect(tx.execute).toHaveBeenCalledTimes(3);
    expect(tx.commit).toHaveBeenCalledOnce();
    expect(tx.rollback).not.toHaveBeenCalled();
    expect(committed.state_version).toBe(5);
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
});
