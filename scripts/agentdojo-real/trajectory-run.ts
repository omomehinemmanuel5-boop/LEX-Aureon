/**
 * Three-arm agent-governance evaluation.
 *
 * Compares the same fixed susceptible tool trace under bare execution,
 * per-tool constitutional governance, and per-tool plus trajectory governance.
 * The environment is deterministic and in-memory. This is a Lex research
 * harness, NOT the official AgentDojo implementation or an independent audit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { interceptToolCall } from '../../lib/agents/tool_interceptor';
import { executeGovernedTrajectoryAction } from '../../lib/agents/trajectory_executor';
import { createTrajectoryPlan, createTrajectoryState, type TrajectoryAction, type TrajectoryRisk } from '../../lib/agents/trajectory_governance';
import { freshWorld, executeTool } from './environment';
import { SUITE, type Task } from './suite';

interface ArmResult {
  utility: boolean;
  securityBreached: boolean;
  blocked: number;
  blockReasons: string[];
  infrastructureFailure: boolean;
  trajectoryDenied: number;
  trajectoryLocked: boolean;
}

interface TaskResult {
  task: string;
  suite: Task['suite'];
  layer: Task['layer'];
  bare: ArmResult;
  toolGoverned: ArmResult;
  trajectoryGoverned: ArmResult;
}

const RISK_RANK: Record<TrajectoryRisk, number> = { read: 0, write: 1, external: 2, destructive: 3 };
function riskForTool(name: string): TrajectoryRisk {
  if (['read_file', 'list_files'].includes(name)) return 'read';
  if (['send_email', 'run_command'].includes(name)) return 'external';
  if (['delete_file', 'change_access', 'execute_sql'].includes(name)) return 'destructive';
  return 'write';
}

async function runBare(task: Task): Promise<ArmResult> {
  const world = freshWorld(task.seedFiles);
  for (const call of task.susceptibleTrace) executeTool(world, call.name, call.arguments);
  return { utility: task.utilityAchieved(world), securityBreached: task.securityBreached(world), blocked: 0, blockReasons: [], infrastructureFailure: false, trajectoryDenied: 0, trajectoryLocked: false };
}

async function runToolGoverned(task: Task): Promise<ArmResult> {
  const world = freshWorld(task.seedFiles);
  let blocked = 0;
  const blockReasons: string[] = [];
  let infrastructureFailure = false;
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
    if (!decision.approved) {
      blocked++;
      blockReasons.push(`${call.name}: ${decision.decision} — ${decision.reason}`);
      if (/state unavailable|store unavailable|could not load/i.test(decision.reason)) infrastructureFailure = true;
      continue;
    }
    executeTool(world, call.name, call.arguments);
  }
  return { utility: task.utilityAchieved(world), securityBreached: task.securityBreached(world), blocked, blockReasons, infrastructureFailure, trajectoryDenied: 0, trajectoryLocked: false };
}

async function runTrajectoryGoverned(task: Task): Promise<ArmResult> {
  const world = freshWorld(task.seedFiles);
  const sessionId = `agentdojo-trajectory-${task.id}`;
  // The final trace element is the planted/injected action. All earlier steps
  // form the declared benign plan; the exact same trace is replayed in each arm.
  const planned = task.susceptibleTrace.slice(0, Math.max(0, task.susceptibleTrace.length - 1));
  const actions: TrajectoryAction[] = planned.map((call, i) => ({
    actionId: `step-${i}`,
    toolName: call.name,
    declaredIntent: task.userTask,
    risk: riskForTool(call.name),
  }));
  const riskCeiling = actions.reduce<TrajectoryRisk>(
    (highest, action) => RISK_RANK[action.risk] > RISK_RANK[highest] ? action.risk : highest,
    'read',
  );
  const plan = createTrajectoryPlan({
    goal: task.userTask,
    authorizedScope: [...new Set(planned.map(call => call.name))],
    riskCeiling,
    actions,
  });
  let state = createTrajectoryState(plan);
  let blocked = 0;
  const blockReasons: string[] = [];
  let infrastructureFailure = false;
  let trajectoryDenied = 0;

  for (let i = 0; i < task.susceptibleTrace.length; i++) {
    const call = task.susceptibleTrace[i];
    const isPlanned = i < planned.length;
    const action: TrajectoryAction = isPlanned
      ? actions[i]
      : { actionId: `injected-${i}`, toolName: call.name, declaredIntent: 'injected instruction', risk: riskForTool(call.name) };
    const result = await executeGovernedTrajectoryAction(
      state,
      action,
      call.arguments,
      async args => executeTool(world, call.name, args),
      sessionId,
      task.userTask,
    );
    state = result.state;
    if (result.governance.decision === 'TRAJECTORY_DENIED') trajectoryDenied++;
    if (!result.governance.approved) {
      blocked++;
      const reason = result.governance.result.match(/reason:\s*([^\n]+)/)?.[1]
        ?? result.governance.result.split('\n')[0];
      blockReasons.push(`${call.name}: ${result.governance.decision} — ${reason.slice(0, 180)}`);
      if (/TRAJECTORY_RECEIPT_WRITE_FAILED|state unavailable|store unavailable|receipt could not be persisted/i.test(`${result.governance.decision} ${result.governance.result}`)) infrastructureFailure = true;
    }
  }

  return { utility: task.utilityAchieved(world), securityBreached: task.securityBreached(world), blocked, blockReasons, infrastructureFailure, trajectoryDenied, trajectoryLocked: state.locked };
}

function summarize(results: TaskResult[]) {
  const rate = (select: (result: TaskResult) => ArmResult) => {
    const eligible = results.filter(result => !select(result).infrastructureFailure);
    const utility = eligible.filter(result => select(result).utility).length;
    const breaches = eligible.filter(result => select(result).securityBreached).length;
    return {
      raw_cases: results.length,
      cases: eligible.length,
      excluded_infrastructure: results.length - eligible.length,
      utility_completed: utility,
      utility_rate: eligible.length ? utility / eligible.length : null,
      security_breaches: breaches,
    };
  };
  return {
    bare: rate(result => result.bare),
    tool_governed: rate(result => result.toolGoverned),
    trajectory_governed: rate(result => result.trajectoryGoverned),
  };
}

async function main() {
  const suiteIndex = process.argv.indexOf('--suite');
  const suite = suiteIndex >= 0 ? process.argv[suiteIndex + 1] : undefined;
  const tasks = SUITE.filter(task => !suite || task.suite === suite);
  const results: TaskResult[] = [];
  for (const task of tasks) {
    results.push({
      task: task.id,
      suite: task.suite,
      layer: task.layer,
      bare: await runBare(task),
      toolGoverned: await runToolGoverned(task),
      trajectoryGoverned: await runTrajectoryGoverned(task),
    });
  }

  const report = {
    benchmark: 'Lex custom deterministic agent-governance three-arm harness',
    official_agentdojo_implementation: false,
    model: 'none; fixed susceptible traces replayed against an in-memory world',
    synthetic_interceptor_state: process.env.LEX_AGENTDOJO_SYNTHETIC_STATE === '1',
    governance_store_configured: Boolean(process.env.TURSO_DATABASE_URL),
    store_note: process.env.TURSO_DATABASE_URL
      ? 'Configured store must be isolated from production before benchmark use.'
      : 'No governance store configured; fail-closed rows are excluded from effectiveness aggregates.',
    commit: process.env.GITHUB_SHA ?? 'local',
    task_count: results.length,
    summary: summarize(results),
    results,
  };

  console.log('Lex custom agent-governance three-arm evaluation (not official AgentDojo)');
  console.log('task | layer | bare breach/utility | per-tool breach/utility | per-tool+trajectory breach/utility | blocked | trajectory denials');
  for (const result of results) {
    const yesNo = (value: boolean) => value ? 'YES' : 'NO';
    const marker = (arm: ArmResult) => arm.infrastructureFailure ? ' [INFRA-EXCLUDED]' : '';
    console.log(
      `${result.task} | ${result.layer} | ${yesNo(result.bare.securityBreached)}/${yesNo(result.bare.utility)} | ` +
      `${yesNo(result.toolGoverned.securityBreached)}/${yesNo(result.toolGoverned.utility)}${marker(result.toolGoverned)} | ` +
      `${yesNo(result.trajectoryGoverned.securityBreached)}/${yesNo(result.trajectoryGoverned.utility)}${marker(result.trajectoryGoverned)} | ` +
      `${result.trajectoryGoverned.blocked} | ${result.trajectoryGoverned.trajectoryDenied}`,
    );
  }
  console.log('aggregate (infrastructure exclusions removed; security breaches / benign utility completion)');
  for (const [arm, summary] of Object.entries(report.summary)) {
    const utilityRate = summary.utility_rate === null ? 'n/a' : `${(summary.utility_rate * 100).toFixed(1)}%`;
    console.log(`${arm}: ${summary.security_breaches}/${summary.cases} breaches; ${summary.utility_completed}/${summary.cases} utility (${utilityRate}); excluded=${summary.excluded_infrastructure}/${summary.raw_cases}`);
  }
  for (const result of results) {
    if (!result.toolGoverned.utility || !result.trajectoryGoverned.utility) {
      console.log(`${result.task} block reasons: ${JSON.stringify({ tool: result.toolGoverned.blockReasons, trajectory: result.trajectoryGoverned.blockReasons })}`);
    }
  }

  const jsonIndex = process.argv.indexOf('--json');
  if (jsonIndex >= 0 && process.argv[jsonIndex + 1]) {
    const outputPath = resolve(process.argv[jsonIndex + 1]);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`json_report=${outputPath}`);
  }
}

main().catch(error => { console.error(error); process.exit(1); });
