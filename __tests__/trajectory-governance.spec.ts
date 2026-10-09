import { describe, expect, it } from 'vitest';
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
      risk: 'write',
    });
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe('action_outside_authorized_scope');
  });

  it('rejects every action when the authorized scope is empty', () => {
    const emptyScope = createTrajectoryPlan({
      ...plan,
      authorizedScope: [],
    });
    const decision = authorizeTrajectoryAction(
      createTrajectoryState(emptyScope),
      emptyScope.actions[0],
    );

    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe('action_outside_authorized_scope');
  });

  it('rejects actions after a trajectory has been explicitly locked', () => {
    const state = { ...createTrajectoryState(plan), locked: true };
    const decision = authorizeTrajectoryAction(state, plan.actions[0]);

    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe('trajectory_locked');
  });

  it('rejects expired plans before any action can execute', () => {
    const expired = { ...createTrajectoryState(plan), expiresAt: Date.now() - 1 };
    const decision = authorizeTrajectoryAction(expired, plan.actions[0]);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe('trajectory_expired');
  });

  it('rejects risk escalation beyond the plan ceiling', () => {
    const state = createTrajectoryState(plan);
    const decision = authorizeTrajectoryAction(state, {
      actionId: 'evil',
      toolName: 'patch_file',
      declaredIntent: 'perform destructive operation',
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

  it('adds drift when a successful action reports no observable effect', () => {
    const next = reconcileTrajectoryOutcome(createTrajectoryState(plan), {
      actionId: 'a1',
      success: true,
      actualEffect: '   ',
    });

    expect(next.currentStep).toBe(1);
    expect(next.driftScore).toBeCloseTo(0.15);
    expect(next.locked).toBe(false);
  });

  it('locks after a failed action and rejects subsequent actions', () => {
    const state = createTrajectoryState(plan);
    const failed = reconcileTrajectoryOutcome(state, {
      actionId: 'a1',
      success: false,
      actualEffect: 'tool execution failed',
    });
    expect(failed.locked).toBe(true);

    const decision = authorizeTrajectoryAction(failed, plan.actions[1]);
    expect(decision.approved).toBe(false);
    expect(decision.reason).toBe('trajectory_locked');
  });

  it('preserves the ordered trajectory across a successful multi-step run', () => {
    const afterFirst = reconcileTrajectoryOutcome(createTrajectoryState(plan), {
      actionId: 'a1',
      success: true,
      actualEffect: 'README inspected',
    });
    const secondDecision = authorizeTrajectoryAction(afterFirst, plan.actions[1]);
    expect(secondDecision.approved).toBe(true);

    const afterSecond = reconcileTrajectoryOutcome(afterFirst, {
      actionId: 'a2',
      success: true,
      actualEffect: 'approved documentation patch applied',
    });
    expect(afterSecond.currentStep).toBe(2);
    expect(afterSecond.completed).toEqual(['a1', 'a2']);
    expect(afterSecond.locked).toBe(false);
  });

  it('preserves ordering across a 50-step long-horizon run', () => {
    const longPlan = createTrajectoryPlan({
      goal: 'read 50 approved artifacts',
      authorizedScope: ['read_file'],
      riskCeiling: 'read',
      actions: Array.from({ length: 50 }, (_, i) => ({
        actionId: `step-${i}`, toolName: 'read_file', declaredIntent: `read artifact ${i}`, risk: 'read' as const,
      })),
    });
    let state = createTrajectoryState(longPlan);
    for (const action of longPlan.actions) {
      expect(authorizeTrajectoryAction(state, action).approved).toBe(true);
      state = reconcileTrajectoryOutcome(state, { actionId: action.actionId, success: true, actualEffect: 'READ_OK' });
    }
    expect(state.currentStep).toBe(50);
    expect(state.completed).toHaveLength(50);
    expect(state.locked).toBe(false);
  });

  it('survives a seeded 257-action mixed-read stress run without corruption or mismatch consumption', () => {
    let seed = 0x5eed1234;
    const nextRandom = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const tools = ['read_file', 'search_code', 'get_constitutional_state'] as const;
    const actions = Array.from({ length: 257 }, (_, index) => ({
      actionId: `seeded-${index}-${nextRandom().toString(16)}`,
      toolName: tools[nextRandom() % tools.length],
      declaredIntent: `read-only stress action ${index}`,
      risk: 'read' as const,
    }));
    const stressPlan = createTrajectoryPlan({
      goal: 'Seeded read-only trajectory stress test',
      authorizedScope: [...tools],
      riskCeiling: 'read',
      actions,
    });
    let state = createTrajectoryState(stressPlan);

    for (let index = 0; index < actions.length; index += 1) {
      const expected = actions[index];
      if (index % 7 === 0 && index + 1 < actions.length) {
        const skipped = authorizeTrajectoryAction(state, actions[index + 1]);
        expect(skipped.approved).toBe(false);
        expect(skipped.reason).toBe('trajectory_step_mismatch');
        expect(state.currentStep).toBe(index);
      }

      expect(authorizeTrajectoryAction(state, expected).approved).toBe(true);
      state = reconcileTrajectoryOutcome(state, {
        actionId: expected.actionId,
        success: true,
        actualEffect: `READ_OK:${index}`,
      });
    }

    expect(state.currentStep).toBe(257);
    expect(state.completed).toHaveLength(257);
    expect(new Set(state.completed).size).toBe(257);
    expect(state.driftScore).toBe(0);
    expect(state.locked).toBe(false);
  });
});
