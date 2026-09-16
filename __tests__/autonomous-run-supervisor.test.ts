import { beforeEach, describe, expect, it, vi } from 'vitest';

const { batch, execute, transaction } = vi.hoisted(() => ({
  batch: vi.fn(async () => []),
  execute: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../lib/db', () => ({ getClient: () => ({ batch, execute, transaction }) }));

import {
  checkpointRun,
  createAutonomousRun,
  heartbeatRun,
  reserveRunAction,
  RunGovernanceError,
} from '../lib/agents/autonomous_run_supervisor';

const runRow = {
  run_id: 'run-1', owner_id: 'owner', session_id: 'session', status: 'active',
  checkpoint_json: '{}', checkpoint_version: 0, actions_used: 0,
  action_budget: 2, risk_used: 0, risk_budget: 2,
  lease_expires_at: Date.now() + 60_000, wall_deadline: Date.now() + 86_400_000,
};

describe('autonomous run supervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    batch.mockResolvedValue([]);
  });

  it('creates a run with a non-reusable secret lease and bounded budgets', async () => {
    execute.mockResolvedValueOnce({ rowsAffected: 1 });
    const created = await createAutonomousRun({ ownerId: 'owner', sessionId: 'session', actionBudget: 4, riskBudget: 3 });
    expect(created.run.runId).toMatch(/^run_/);
    expect(created.lease.leaseToken.length).toBeGreaterThan(20);
    expect(created.run.actionBudget).toBe(4);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ sql: expect.stringContaining('INSERT INTO autonomous_runs') }));
  });

  it('rejects a heartbeat when the lease update is not owned', async () => {
    execute.mockResolvedValueOnce({ rowsAffected: 0 });
    execute.mockResolvedValueOnce({ rows: [runRow] });
    await expect(heartbeatRun({ runId: 'run-1', leaseToken: 'wrong' }))
      .rejects.toMatchObject({ code: 'lease_rejected' });
  });

  it('reserves an action transactionally and suppresses duplicate reservations', async () => {
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [runRow] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowsAffected: 1 })
        .mockResolvedValueOnce({ rowsAffected: 1 }),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
    };
    transaction.mockResolvedValueOnce(tx);
    const first = await reserveRunAction({ runId: 'run-1', leaseToken: 'secret' }, 'id-1', 'write_file', 'hash', 1);
    expect(first.replay).toBe(false);
    expect(tx.commit).toHaveBeenCalledOnce();

    const replayTx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [runRow] })
        .mockResolvedValueOnce({ rows: [{ status: 'completed', tool_name: 'write_file', args_hash: 'hash' }] }),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
    };
    transaction.mockResolvedValueOnce(replayTx);
    const replay = await reserveRunAction({ runId: 'run-1', leaseToken: 'secret' }, 'id-1', 'write_file', 'hash', 1);
    expect(replay.replay).toBe(true);
    expect(replay.status).toBe('completed');
  });

  it('rejects an action that exceeds the risk budget before side effects', async () => {
    const tx = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [runRow] })
        .mockResolvedValueOnce({ rows: [] }),
      commit: vi.fn(), rollback: vi.fn(async () => undefined),
    };
    transaction.mockResolvedValueOnce(tx);
    await expect(reserveRunAction({ runId: 'run-1', leaseToken: 'secret' }, 'id-2', 'delete', 'hash', 3))
      .rejects.toMatchObject({ code: 'risk_budget_exhausted' });
    expect(tx.commit).not.toHaveBeenCalled();
  });

  it('rejects stale checkpoint versions to prevent lost progress', async () => {
    execute.mockResolvedValueOnce({ rowsAffected: 0 });
    await expect(checkpointRun({ runId: 'run-1', leaseToken: 'secret' }, { cursor: 'step-2' }, 0))
      .rejects.toMatchObject({ code: 'checkpoint_conflict' });
  });

  it('exposes typed governance errors for callers to pause and recover', () => {
    const error = new RunGovernanceError('lease_expired', 'expired');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('lease_expired');
  });
});
