import {
  authorizeTrajectoryAction,
  createTrajectoryPlan,
  createTrajectoryState,
  reconcileTrajectoryOutcome,
} from '@/lib/agents/trajectory_governance';

describe('trajectory governance', () => {
  const plan = createTrajectoryPlan({
    goal: 'inspect and update the approved documentation',
    authorizedScope: ['read_file', 'patch_file'],
    riskCeiling: 'write',
    actions: [
      { actionId: 'a1', toolName: 'read_file', declaredIntent: 'inspect README', risk: 'read' },
      { actionId: 'a2', toolName: 'patch_file', declaredIntent: 'apply approved documentation patch', risk: 'write' },
    ],
  });

  it('authorizes the declared next action', () => {
    const decision = authorizeTrajectoryAction(createTrajectoryState(plan), plan.actions[0]);
    expect(decision.approved).toBe(true);
  });

  it('rejects an action outside the declared scope', () => {
    const state = createTrajectoryState(plan);
    const decision = authorizeTrajectoryAction(state, {
      actionId: 'evil',
      toolName: 'delete_file',
      declaredIntent: 'delete data',
      risk: 'destructive',
    });
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe('risk_ceiling_exceeded');
  });

  it('rejects skipping ahead in the trajectory', () => {
    const state = createTrajectoryState(plan);
    const decision = authorizeTrajectoryAction(state, plan.actions[1]);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe('trajectory_step_mismatch');
  });

  it('advances only after outcome reconciliation', () => {
    const state = createTrajectoryState(plan);
    const next = reconcileTrajectoryOutcome(state, {
      actionId: 'a1',
      success: true,
      actualEffect: 'README inspected',
    });
    expect(next.currentStep).toBe(1);
    expect(next.completed).toEqual(['a1']);
    expect(next.locked).toBe(false);
  });

  it('locks on an unexpected outcome', () => {
    const state = createTrajectoryState(plan);
    const next = reconcileTrajectoryOutcome(state, {
      actionId: 'unexpected',
      success: true,
      actualEffect: 'unexpected mutation',
    });
    expect(next.locked).toBe(true);
  });
});
