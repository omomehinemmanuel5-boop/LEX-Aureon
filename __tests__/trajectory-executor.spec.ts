import { describe, expect, it, vi } from 'vitest';
import { executeGovernedTrajectoryAction } from '@/lib/agents/trajectory_executor';
import { createTrajectoryPlan, createTrajectoryState } from '@/lib/agents/trajectory_governance';

const makePlan = () => createTrajectoryPlan({
  goal: 'inspect an approved file',
  authorizedScope: ['read_file'],
  riskCeiling: 'read',
  actions: [{ actionId: 'a1', toolName: 'read_file', declaredIntent: 'inspect README', risk: 'read' }],
});

describe('trajectory executor integration', () => {
  it('blocks a trajectory violation before tool execution', async () => {
    const tool = vi.fn(async () => 'must not execute');
    const state = createTrajectoryState(makePlan());
    const action = { ...state.plan.actions[0], actionId: 'wrong-step' };
    const result = await executeGovernedTrajectoryAction(state, action, { path: 'README.md' }, tool, 'trajectory-test');
    expect(tool).not.toHaveBeenCalled();
    expect(result.result).toContain('Trajectory denied');
    expect(result.state.currentStep).toBe(0);
  });

  it('cannot bypass the per-tool constitutional denial', async () => {
    const tool = vi.fn(async () => 'unexpected execution');
    const state = createTrajectoryState(createTrajectoryPlan({
      goal: 'read a secret',
      authorizedScope: ['read_file'],
      riskCeiling: 'read',
      actions: [{ actionId: 'a1', toolName: 'read_file', declaredIntent: 'read a credential file', risk: 'read' }],
    }));
    const result = await executeGovernedTrajectoryAction(state, state.plan.actions[0], { path: '.env' }, tool, 'trajectory-test');
    expect(result.result).toContain('approved:    false');
    expect(tool).not.toHaveBeenCalled();
  });
});
