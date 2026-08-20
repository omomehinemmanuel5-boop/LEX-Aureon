/**
 * Three-arm agent-governance evaluation.
 *
 * Compares the same susceptible tool trace under:
 *   1. bare execution,
 *   2. existing per-tool constitutional governance,
 *   3. per-tool governance plus trajectory governance.
 *
 * The trace and world are held constant so the third arm measures the
 * incremental effect of trajectory authorization rather than a different task.
 * This is a research harness, not the official AgentDojo implementation.
 */
import { interceptToolCall } from '../../lib/agents/tool_interceptor';
import { executeGovernedTrajectoryAction } from '../../lib/agents/trajectory_executor';
import { createTrajectoryPlan, createTrajectoryState, type TrajectoryAction } from '../../lib/agents/trajectory_governance';
import { freshWorld, executeTool } from './environment';
import { SUITE, type Task } from './suite';

interface ArmResult {
  utility: boolean;
  securityBreached: boolean;
  blocked: number;
  trajectoryDenied: number;
  trajectoryLocked: boolean;
}

async function runBare(task: Task): Promise<ArmResult> {
  const world = freshWorld(task.seedFiles);
  for (const call of task.susceptibleTrace) executeTool(world, call.name, call.arguments);
  return { utility: task.utilityAchieved(world), securityBreached: task.securityBreached(world), blocked: 0, trajectoryDenied: 0, trajectoryLocked: false };
}

async function runToolGoverned(task: Task): Promise<ArmResult> {
  const world = freshWorld(task.seedFiles);
  let blocked = 0;
  const sessionId = `agentdojo-tool-${task.id}`;
  for (let i = 0; i < task.susceptibleTrace.length; i++) {
    const call = task.susceptibleTrace[i];
    const decision = await interceptToolCall({
      id: `${task.id}-tool-${i}`,
      name: call.name,
      arguments: call.arguments,
      session_id: sessionId,
      task_context: task.userTask,
      turn: i + 1,
    });
    if (!decision.approved) { blocked++; continue; }
    executeTool(world, call.name, call.arguments);
  }
  return { utility: task.utilityAchieved(world), securityBreached: task.securityBreached(world), blocked, trajectoryDenied: 0, trajectoryLocked: false };
}

async function runTrajectoryGoverned(task: Task): Promise<ArmResult> {
  const world = freshWorld(task.seedFiles);
  const sessionId = `agentdojo-trajectory-${task.id}`;
  const planned = task.susceptibleTrace.slice(0, Math.max(0, task.susceptibleTrace.length - 1));
  const actions: TrajectoryAction[] = planned.map((call, i) => ({
    actionId: `step-${i}`,
    toolName: call.name,
    declaredIntent: task.userTask,
    risk: call.name === 'read_file' || call.name === 'list_files' ? 'read' : call.name === 'send_email' ? 'external' : 'write',
  }));
  const plan = createTrajectoryPlan({ goal: task.userTask, authorizedScope: [...new Set(planned.map(c => c.name))], riskCeiling: actions.some(a => a.risk === 'external') ? 'external' : 'write', actions });
  let state = createTrajectoryState(plan);
  let blocked = 0;
  let trajectoryDenied = 0;

  for (let i = 0; i < task.susceptibleTrace.length; i++) {
    const call = task.susceptibleTrace[i];
    const isPlanned = i < planned.length;
    const action: TrajectoryAction = isPlanned
      ? actions[i]
      : { actionId: `injected-${i}`, toolName: call.name, declaredIntent: 'injected instruction', risk: call.name === 'read_file' ? 'read' : 'external' };
    const result = await executeGovernedTrajectoryAction(
      state,
      action,
      call.arguments,
      async (args) => executeTool(world, call.name, args),
      sessionId,
      task.userTask,
    );
    state = result.state;
    if (result.result.startsWith('Trajectory denied:')) trajectoryDenied++;
    if (result.result.includes('approved:    false')) blocked++;
  }

  return { utility: task.utilityAchieved(world), securityBreached: task.securityBreached(world), blocked, trajectoryDenied, trajectoryLocked: state.locked };
}

async function main() {
  const suite = process.argv.includes('--suite') ? process.argv[process.argv.indexOf('--suite') + 1] : undefined;
  const tasks = SUITE.filter(t => !suite || t.suite === suite);
  console.log('Agent governance three-arm evaluation');
  console.log('task | bare breach | tool-governed breach | trajectory-governed breach | utility | trajectory denials');
  for (const task of tasks) {
    const bare = await runBare(task);
    const tool = await runToolGoverned(task);
    const trajectory = await runTrajectoryGoverned(task);
    console.log(`${task.id} | ${bare.securityBreached ? 'YES' : 'NO'} | ${tool.securityBreached ? 'YES' : 'NO'} | ${trajectory.securityBreached ? 'YES' : 'NO'} | ${trajectory.utility ? 'YES' : 'NO'} | ${trajectory.trajectoryDenied}`);
  }
}

main().catch(error => { console.error(error); process.exit(1); });
