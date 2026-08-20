import crypto from 'crypto';
import { executeGovernedTool } from './constitutional_tool_executor';
import {
  authorizeTrajectoryAction,
  reconcileTrajectoryOutcome,
  type TrajectoryAction,
  type TrajectoryOutcome,
  type TrajectoryState,
} from './trajectory_governance';

export interface GovernedTrajectoryExecution {
  state: TrajectoryState;
  result: string;
  action: TrajectoryAction;
}

/**
 * Enforces trajectory authorization before entering the existing per-tool
 * constitutional executor. The trajectory gate can only add a denial; it
 * cannot authorize around the existing tool interceptor.
 */
export async function executeGovernedTrajectoryAction(
  state: TrajectoryState,
  action: TrajectoryAction,
  args: Record<string, unknown>,
  toolFn: (args: Record<string, unknown>) => Promise<string>,
  sessionId: string,
  taskContext?: string,
): Promise<GovernedTrajectoryExecution> {
  const trajectoryDecision = authorizeTrajectoryAction(state, action);
  if (!trajectoryDecision.approved) {
    const deniedState = {
      ...state,
      driftScore: trajectoryDecision.driftScore,
    };
    return {
      state: deniedState,
      action,
      result: `Trajectory denied: ${trajectoryDecision.reason}`,
    };
  }

  const result = await executeGovernedTool(
    action.toolName,
    args,
    toolFn,
    sessionId,
    taskContext ?? action.declaredIntent,
  );

  const outcome: TrajectoryOutcome = {
    actionId: action.actionId,
    success: !result.includes('approved:    false'),
    actualEffect: result,
  };

  const nextState = reconcileTrajectoryOutcome(state, outcome);
  return { state: nextState, result, action };
}

/** Deterministic action identity helper for adapters that construct plans dynamically. */
export function trajectoryActionId(toolName: string, ordinal: number): string {
  return crypto.createHash('sha256').update(`${ordinal}:${toolName}`).digest('hex').slice(0, 16);
}
