import { describe, expect, it } from 'vitest';
import {
  getTrajectoryState, setTrajectoryState, clearTrajectoryState, isTrajectoryActive,
} from '../lib/agents/trajectory_session_store';
import { createTrajectoryPlan, createTrajectoryState } from '../lib/agents/trajectory_governance';

function planWithSteps(n: number) {
  return createTrajectoryPlan({
    goal: 'test',
    authorizedScope: ['read_file'],
    riskCeiling: 'read',
    actions: Array.from({ length: n }, (_, i) => ({
      actionId: `a${i}`, toolName: 'read_file', declaredIntent: 'x', risk: 'read' as const,
    })),
  });
}

describe('trajectory_session_store', () => {
  it('returns undefined for a session with no declared plan', () => {
    expect(getTrajectoryState('never-declared-session')).toBeUndefined();
    expect(isTrajectoryActive(undefined)).toBe(false);
  });

  it('stores and retrieves state by session id, isolated from other sessions', () => {
    const state = createTrajectoryState(planWithSteps(2));
    setTrajectoryState('session-a', state);
    expect(getTrajectoryState('session-a')).toBe(state);
    expect(getTrajectoryState('session-b')).toBeUndefined();
  });

  it('clearTrajectoryState removes only the targeted session', () => {
    setTrajectoryState('session-x', createTrajectoryState(planWithSteps(1)));
    setTrajectoryState('session-y', createTrajectoryState(planWithSteps(1)));
    clearTrajectoryState('session-x');
    expect(getTrajectoryState('session-x')).toBeUndefined();
    expect(getTrajectoryState('session-y')).toBeDefined();
  });

  it('isTrajectoryActive: true while steps remain and not locked', () => {
    const state = createTrajectoryState(planWithSteps(2));
    expect(isTrajectoryActive(state)).toBe(true);
  });

  it('isTrajectoryActive: false once currentStep reaches the action count', () => {
    const state = { ...createTrajectoryState(planWithSteps(1)), currentStep: 1 };
    expect(isTrajectoryActive(state)).toBe(false);
  });

  it('isTrajectoryActive: false when locked, even with steps remaining', () => {
    const state = { ...createTrajectoryState(planWithSteps(2)), locked: true };
    expect(isTrajectoryActive(state)).toBe(false);
  });
});
