import { describe, expect, it, vi } from 'vitest';

const { executeGovernedToolStructuredMock, writeTrajectoryReceiptMock } = vi.hoisted(() => ({
  executeGovernedToolStructuredMock: vi.fn(),
  writeTrajectoryReceiptMock: vi.fn(async () => {}),
}));

vi.mock('@/lib/agents/constitutional_tool_executor', () => ({
  executeGovernedToolStructured: executeGovernedToolStructuredMock,
}));
vi.mock('../lib/agents/trajectory_receipts', () => ({
  writeTrajectoryReceipt: writeTrajectoryReceiptMock,
}));

import { executeGovernedTrajectoryAction } from '@/lib/agents/trajectory_executor';
import { createTrajectoryPlan, createTrajectoryState } from '@/lib/agents/trajectory_governance';

const makePlan = () => createTrajectoryPlan({
  goal: 'inspect an approved file',
  authorizedScope: ['read_file'],
  riskCeiling: 'read',
  actions: [{ actionId: 'a1', toolName: 'read_file', declaredIntent: 'inspect README', risk: 'read' }],
});

describe('trajectory executor integration', () => {
  it('blocks a trajectory violation before tool execution and requests an audit receipt', async () => {
    const tool = vi.fn(async () => 'must not execute');
    const state = createTrajectoryState(makePlan());
    const action = { ...state.plan.actions[0], actionId: 'wrong-step' };
    const result = await executeGovernedTrajectoryAction(state, action, { path: 'README.md' }, tool, 'trajectory-test');

    expect(executeGovernedToolStructuredMock).not.toHaveBeenCalled();
    expect(tool).not.toHaveBeenCalled();
    expect(writeTrajectoryReceiptMock).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'trajectory-test',
      actionId: 'wrong-step',
      approved: false,
      decision: 'TRAJECTORY_DENIED',
    }));
    expect(result.result).toContain('Trajectory denied');
    expect(result.state.currentStep).toBe(0);
  });

  it('preserves a constitutional denial returned by the per-tool executor', async () => {
    executeGovernedToolStructuredMock.mockResolvedValueOnce({
      result: 'approved:    false\nreason: hard_blocked',
      approved: false,
      decision: 'HARD_BLOCKED',
      receiptId: 'test-receipt',
    });
    const tool = vi.fn(async () => 'unexpected execution');
    const state = createTrajectoryState(createTrajectoryPlan({
      goal: 'read a secret',
      authorizedScope: ['read_file'],
      riskCeiling: 'read',
      actions: [{ actionId: 'a1', toolName: 'read_file', declaredIntent: 'read a credential file', risk: 'read' }],
    }));
    const result = await executeGovernedTrajectoryAction(
      state,
      state.plan.actions[0],
      { path: '.env' },
      tool,
      'trajectory-test',
    );

    expect(executeGovernedToolStructuredMock).toHaveBeenCalled();
    expect(result.result).toContain('approved:    false');
    expect(tool).not.toHaveBeenCalled();
  });
});
