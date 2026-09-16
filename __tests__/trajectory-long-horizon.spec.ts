import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeGovernedToolStructured, reserveRunAction, completeRunAction, checkpointRun } = vi.hoisted(() => ({
  executeGovernedToolStructured: vi.fn(),
  reserveRunAction: vi.fn(),
  completeRunAction: vi.fn(),
  checkpointRun: vi.fn(),
}));

vi.mock('@/lib/agents/constitutional_tool_executor', () => ({ executeGovernedToolStructured }));
vi.mock('@/lib/agents/autonomous_run_supervisor', () => ({
  reserveRunAction,
  completeRunAction,
  checkpointRun,
  RunGovernanceError: class RunGovernanceError extends Error { code = 'checkpoint_conflict'; },
}));

import { executeGovernedTrajectoryAction } from '@/lib/agents/trajectory_executor';
import { createTrajectoryPlan, createTrajectoryState } from '@/lib/agents/trajectory_governance';

const plan = createTrajectoryPlan({
  goal: 'read approved file', authorizedScope: ['read_file'], riskCeiling: 'read',
  actions: [{ actionId: 'a1', toolName: 'read_file', declaredIntent: 'inspect README', risk: 'read' }],
});
const context = {
  lease: { runId: 'run-1', leaseToken: 'secret' },
  idempotencyKey: 'action-1', expectedCheckpointVersion: 0, riskCost: 1,
};

describe('long-horizon trajectory execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reserveRunAction.mockResolvedValue({ replay: false, status: 'reserved' });
    completeRunAction.mockResolvedValue(undefined);
    checkpointRun.mockResolvedValue(undefined);
    executeGovernedToolStructured.mockResolvedValue({
      result: 'READ_OK', approved: true, decision: 'APPROVED', receiptId: 'receipt-1',
    });
  });

  it('durably reserves, completes, and checkpoints an action', async () => {
    const state = createTrajectoryState(plan);
    const result = await executeGovernedTrajectoryAction(
      state, plan.actions[0], { path: 'README.md' }, vi.fn(), 'session', undefined, context,
    );
    expect(reserveRunAction).toHaveBeenCalledOnce();
    expect(completeRunAction).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }), 'action-1', true, expect.any(String), 'receipt-1');
    expect(checkpointRun).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }), { trajectoryState: result.state }, 0);
    expect(result.governance.approved).toBe(true);
  });

  it('does not execute a replayed action', async () => {
    reserveRunAction.mockResolvedValueOnce({ replay: true, status: 'completed' });
    const tool = vi.fn();
    const result = await executeGovernedTrajectoryAction(
      createTrajectoryState(plan), plan.actions[0], { path: 'README.md' }, tool, 'session', undefined, context,
    );
    expect(result.governance.decision).toBe('RUN_ACTION_REPLAY');
    expect(executeGovernedToolStructured).not.toHaveBeenCalled();
    expect(tool).not.toHaveBeenCalled();
  });
});
