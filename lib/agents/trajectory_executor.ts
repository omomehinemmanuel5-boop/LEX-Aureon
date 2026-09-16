import crypto from 'crypto';
import { executeGovernedToolStructured } from './constitutional_tool_executor';
import {
  authorizeTrajectoryAction,
  reconcileTrajectoryOutcome,
  type TrajectoryAction,
  type TrajectoryOutcome,
  type TrajectoryState,
} from './trajectory_governance';
import {
  checkpointRun,
  completeRunAction,
  reserveRunAction,
  type RunLease,
  RunGovernanceError,
} from './autonomous_run_supervisor';

export interface GovernedToolExecutionResult {
  result: string;
  approved: boolean;
  decision: string;
  receiptId?: string | null;
}

export interface GovernedTrajectoryExecution {
  state: TrajectoryState;
  result: string;
  action: TrajectoryAction;
  governance: GovernedToolExecutionResult;
}

export interface AutonomousRunContext {
  lease: RunLease;
  idempotencyKey: string;
  expectedCheckpointVersion: number;
  riskCost: number;
}

/**
 * Enforces trajectory authorization before entering the existing per-tool
 * constitutional executor. An autonomous run adds a durable reservation before
 * the side effect and a checkpoint after it. Replays are suppressed rather
 * than executing an external side effect twice.
 */
export async function executeGovernedTrajectoryAction(
  state: TrajectoryState,
  action: TrajectoryAction,
  args: Record<string, unknown>,
  toolFn: (args: Record<string, unknown>) => Promise<string>,
  sessionId: string,
  taskContext?: string,
  runContext?: AutonomousRunContext,
): Promise<GovernedTrajectoryExecution> {
  const trajectoryDecision = authorizeTrajectoryAction(state, action);
  if (!trajectoryDecision.approved) {
    const deniedState = { ...state, driftScore: trajectoryDecision.driftScore };
    const result = `Trajectory denied: ${trajectoryDecision.reason}`;
    return {
      state: deniedState,
      action,
      result,
      governance: { result, approved: false, decision: 'TRAJECTORY_DENIED', receiptId: null },
    };
  }

  if (runContext) {
    const argsHash = crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 32);
    const reservation = await reserveRunAction(
      runContext.lease,
      runContext.idempotencyKey,
      action.toolName,
      argsHash,
      runContext.riskCost,
    );
    if (reservation.replay) {
      const result = 'Autonomous action replay suppressed; reconcile the prior result before retrying.';
      return {
        state,
        action,
        result,
        governance: { result, approved: false, decision: 'RUN_ACTION_REPLAY', receiptId: null },
      };
    }
  }

  let execution: Awaited<ReturnType<typeof executeGovernedToolStructured>>;
  try {
    execution = await executeGovernedToolStructured(
      action.toolName,
      args,
      toolFn,
      sessionId,
      taskContext ?? action.declaredIntent,
    );
  } catch (error) {
    if (runContext) {
      await completeRunAction(
        runContext.lease,
        runContext.idempotencyKey,
        false,
        crypto.createHash('sha256').update(String(error)).digest('hex'),
      ).catch(() => undefined);
    }
    throw error;
  }

  const outcome: TrajectoryOutcome = {
    actionId: action.actionId,
    success: execution.approved,
    actualEffect: execution.result,
  };
  const nextState = reconcileTrajectoryOutcome(state, outcome);

  if (runContext) {
    await completeRunAction(
      runContext.lease,
      runContext.idempotencyKey,
      execution.approved,
      crypto.createHash('sha256').update(execution.result).digest('hex'),
      execution.receiptId ?? undefined,
    );
    try {
      await checkpointRun(
        runContext.lease,
        { trajectoryState: nextState },
        runContext.expectedCheckpointVersion,
      );
    } catch (error) {
      const result = `${execution.result}\nRUN PAUSED: checkpoint failed; action result is durably marked and replay is suppressed.`;
      return {
        state: { ...nextState, locked: true },
        action,
        result,
        governance: {
          result,
          approved: false,
          decision: error instanceof RunGovernanceError ? `RUN_${error.code.toUpperCase()}` : 'RUN_CHECKPOINT_FAILED',
          receiptId: execution.receiptId,
        },
      };
    }
  }

  const governance: GovernedToolExecutionResult = {
    result: execution.result,
    approved: execution.approved,
    decision: execution.decision,
    receiptId: execution.receiptId,
  };
  return { state: nextState, result: execution.result, action, governance };
}

/** Deterministic action identity helper for adapters that construct plans dynamically. */
export function trajectoryActionId(toolName: string, ordinal: number): string {
  return crypto.createHash('sha256').update(`${ordinal}:${toolName}`).digest('hex').slice(0, 16);
}
