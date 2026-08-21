/**
 * Agent trajectory governance.
 *
 * This layer sits above the existing constitutional tool interceptor. It does
 * not replace per-tool authorization; it adds trajectory-level invariants:
 * an action must belong to an authorized plan, remain inside its declared
 * scope/risk ceiling, and report an outcome that can be reconciled with the
 * declared action.
 */

import crypto from 'crypto';

export type TrajectoryRisk = 'read' | 'write' | 'external' | 'destructive';

export interface TrajectoryAction {
  actionId: string;
  toolName: string;
  declaredIntent: string;
  risk: TrajectoryRisk;
  target?: string;
}

export interface TrajectoryPlan {
  planId: string;
  goal: string;
  authorizedScope: string[];
  riskCeiling: TrajectoryRisk;
  actions: TrajectoryAction[];
}

export interface TrajectoryOutcome {
  actionId: string;
  success: boolean;
  actualEffect: string;
  beforeHash?: string;
  afterHash?: string;
}

export interface TrajectoryState {
  plan: TrajectoryPlan;
  currentStep: number;
  completed: string[];
  driftScore: number;
  locked: boolean;
}

const RISK_RANK: Record<TrajectoryRisk, number> = {
  read: 0,
  write: 1,
  external: 2,
  destructive: 3,
};

export function createTrajectoryPlan(input: Omit<TrajectoryPlan, 'planId'>): TrajectoryPlan {
  return {
    ...input,
    planId: `plan_${crypto.randomUUID()}`,
  };
}

export function createTrajectoryState(plan: TrajectoryPlan): TrajectoryState {
  return {
    plan,
    currentStep: 0,
    completed: [],
    driftScore: 0,
    locked: false,
  };
}

function scopeMatches(plan: TrajectoryPlan, action: TrajectoryAction): boolean {
  if (!plan.authorizedScope.length) return false;
  return plan.authorizedScope.some(scope =>
    action.toolName === scope || action.toolName.startsWith(`${scope}:`)
  );
}

export function authorizeTrajectoryAction(
  state: TrajectoryState,
  action: TrajectoryAction,
): { approved: boolean; reason: string; driftScore: number } {
  if (state.locked) {
    return { approved: false, reason: 'trajectory_locked', driftScore: state.driftScore };
  }

  if (RISK_RANK[action.risk] > RISK_RANK[state.plan.riskCeiling]) {
    return {
      approved: false,
      reason: 'risk_ceiling_exceeded',
      driftScore: state.driftScore + 0.25,
    };
  }

  if (!scopeMatches(state.plan, action)) {
    return {
      approved: false,
      reason: 'action_outside_authorized_scope',
      driftScore: state.driftScore + 0.25,
    };
  }

  const expected = state.plan.actions[state.currentStep];
  if (!expected || expected.actionId !== action.actionId || expected.toolName !== action.toolName) {
    return {
      approved: false,
      reason: 'trajectory_step_mismatch',
      driftScore: state.driftScore + 0.15,
    };
  }

  return { approved: true, reason: 'trajectory_authorized', driftScore: state.driftScore };
}

export function reconcileTrajectoryOutcome(
  state: TrajectoryState,
  outcome: TrajectoryOutcome,
): TrajectoryState {
  const expected = state.plan.actions[state.currentStep];
  if (!expected || expected.actionId !== outcome.actionId) {
    return { ...state, driftScore: state.driftScore + 0.25, locked: true };
  }

  const effectMatches = outcome.actualEffect.trim().length > 0;
  const nextDrift = state.driftScore + (effectMatches ? 0 : 0.15);
  const nextStep = state.currentStep + 1;
  const complete = nextStep >= state.plan.actions.length;

  return {
    ...state,
    currentStep: nextStep,
    completed: [...state.completed, outcome.actionId],
    driftScore: nextDrift,
    // fix (2026-08-21): `complete` used to be computed and then spread back
    // in with a locked value identical to the one already set two lines
    // above — dead code that implied distinct end-of-plan behavior without
    // providing any. A finished plan should not silently accept further
    // actions; locking explicitly here is defense-in-depth rather than
    // relying only on the incidental out-of-bounds `expected` check in
    // authorizeTrajectoryAction.
    locked: complete || !outcome.success || nextDrift >= 1,
  };
}
