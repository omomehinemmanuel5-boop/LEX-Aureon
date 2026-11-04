import { describe, expect, it } from 'vitest';
import { buildProductionReadinessReport, renderMarkdown, summarizeByScenario, type ControlledRow, type EvaluationInput, type EvaluationRow } from '../scripts/agentdojo-real/production-readiness-report';
import type { ArmResult } from '../scripts/agentdojo-real/model-in-loop';
import { SUITE } from '../scripts/agentdojo-real/suite';

function arm(utility: boolean, securityBreached = false): ArmResult {
  return {
    utility,
    securityBreached,
    blocked: 0,
    decisions: [],
    infrastructureFailure: false,
    syntheticApprovalCandidates: 0,
    syntheticApprovalsSimulated: 0,
    syntheticRejectionsSimulated: 0,
    utilityIfSyntheticApprovalGranted: utility,
    breachIfSyntheticApprovalGranted: securityBreached,
    utilityIfSyntheticApprovalRejected: utility,
    breachIfSyntheticApprovalRejected: securityBreached,
  };
}

function passingInput(): EvaluationInput {
  const rows: EvaluationRow[] = SUITE.flatMap(task => Array.from({ length: 5 }, (_, i) => ({
    task: task.id,
    suite: task.suite,
    repetition: i + 1,
    attackExpected: task.attackExpected !== false,
    attackOutcomeObservedInBare: false,
    bare: arm(true),
    baseline: arm(true),
    lex_tool: arm(true),
    lex_trajectory: arm(true),
  })));
  const controlledRows: ControlledRow[] = SUITE.map(task => {
    const attack = task.attackExpected !== false;
    return {
      task: task.id,
      suite: task.suite,
      attackExpected: attack,
      attackAttempted: attack,
      bare: arm(true, attack),
      baseline: arm(true),
      lex_tool: arm(true),
      lex_trajectory: arm(true),
    };
  });
  return {
    rows,
    controlledRows,
    approvalSimulation: {
      mode: 'synthetic_counterfactual',
      scope: 'isolated in-memory benchmark worlds only',
      branches: ['approved', 'rejected'],
    },
    backend: 'governance',
    model: 'fixture-model',
    suiteSize: SUITE.length,
    repetitionsPerScenario: 5,
  };
}

describe('production readiness scorecard', () => {
  it('passes only when all scenarios, attack attempts, benign controls, and model repetitions are represented', () => {
    const report = buildProductionReadinessReport(passingInput());
    expect(report.releaseDecision).toBe('BENCHMARK_GATES_PASSED');
    expect(report.evidence.suiteSize).toBe(SUITE.length);
    expect(report.evidence.controlledAttacks.attemptedAndConfirmed).toBe(SUITE.filter(task => task.attackExpected !== false).length);
    expect(report.evidence.modelPlanArms.lexTrajectory.scenarios).toBe(SUITE.length);
    expect(report.evidence.modelPlanArms.lexTrajectory.samples).toBe(SUITE.length * 5);
    expect(report.evidence.approvalSimulation.incompleteArmOutcomes).toBe(0);
  });

  it('fails closed if any evaluated arm omits an explicit synthetic approval or rejection outcome', () => {
    const input = passingInput();
    delete (input.rows![0].lex_trajectory as Partial<ArmResult>).breachIfSyntheticApprovalRejected;
    const report = buildProductionReadinessReport(input);
    expect(report.gates.find(item => item.name === 'Every evaluated arm has explicit synthetic approve/reject outcomes')?.pass).toBe(false);
    expect(report.evidence.approvalSimulation.incompleteArmOutcomes).toBeGreaterThan(0);
    expect(report.releaseDecision).toBe('BENCHMARK_GATES_FAILED');
  });

  it('fails closed if the input does not declare isolated approved and rejected branches', () => {
    const input = passingInput();
    input.approvalSimulation = { mode: 'synthetic_counterfactual', scope: 'production approval service', branches: ['approved'] };
    const report = buildProductionReadinessReport(input);
    expect(report.gates.find(item => item.name === 'Every evaluated arm has explicit synthetic approve/reject outcomes')?.pass).toBe(false);
    expect(report.releaseDecision).toBe('BENCHMARK_GATES_FAILED');
  });

  it('reports provider failures and retry attempts separately from parse failures', () => {
    const input = passingInput();
    input.rows!.push({
      task: SUITE[0].id,
      suite: SUITE[0].suite,
      repetition: 6,
      excluded: 'provider_failure',
      decision: { attempts: 3, providerFailure: { category: 'http_5xx', retryable: true, status: 503 } },
    });
    input.rows!.push({
      task: SUITE[0].id,
      suite: SUITE[0].suite,
      repetition: 7,
      excluded: 'parse_failure',
      decision: { attempts: 1 },
    });
    const report = buildProductionReadinessReport(input);
    expect(report.evidence.providerFailureRows).toBe(1);
    expect(report.evidence.providerFailureCategories).toEqual({ http_5xx: 1 });
    expect(report.evidence.parseFailureRows).toBe(1);
    expect(report.evidence.extraProviderRetryAttempts).toBe(2);
    const markdown = renderMarkdown(report);
    expect(markdown).toContain('Synthetic approval/rejection counterfactuals');
    expect(markdown).toContain('isolated in-memory benchmark worlds only');
    expect(markdown).toContain('| http_5xx | 1 |');
    expect(markdown).toContain('2 retries');
  });

  it('fails when an expected attack trace was not actually exercised in the bare arm', () => {
    const input = passingInput();
    const attack = input.controlledRows!.find(row => row.attackExpected);
    expect(attack).toBeDefined();
    attack!.attackAttempted = false;
    attack!.bare = arm(true, false);

    const report = buildProductionReadinessReport(input);
    const gate = report.gates.find(item => item.name === 'Every expected attack trace was deliberately exercised');
    expect(gate?.pass).toBe(false);
    expect(report.gates.find(item => item.name === 'No controlled attack succeeds in Lex trajectory arm')?.pass).toBe(false);
    expect(report.releaseDecision).toBe('BENCHMARK_GATES_FAILED');
  });

  it('fails the controlled-attack gate when a Lex trajectory result is missing', () => {
    const input = passingInput();
    const attack = input.controlledRows!.find(row => row.attackExpected);
    expect(attack).toBeDefined();
    delete attack!.lex_trajectory;

    const report = buildProductionReadinessReport(input);
    const gate = report.gates.find(item => item.name === 'No controlled attack succeeds in Lex trajectory arm');
    expect(gate?.pass).toBe(false);
    expect(report.evidence.controlledAttacks.invalidLexTrajectoryResults).toContain(attack!.task);
    expect(report.releaseDecision).toBe('BENCHMARK_GATES_FAILED');
  });

  it('fails the controlled-attack gate when a Lex trajectory result is malformed', () => {
    const input = passingInput();
    const attack = input.controlledRows!.find(row => row.attackExpected);
    expect(attack).toBeDefined();
    attack!.lex_trajectory = { utility: true, blocked: 0, decisions: [], infrastructureFailure: false };

    const report = buildProductionReadinessReport(input);
    const gate = report.gates.find(item => item.name === 'No controlled attack succeeds in Lex trajectory arm');
    expect(gate?.pass).toBe(false);
    expect(report.evidence.controlledAttacks.invalidLexTrajectoryResults).toContain(attack!.task);
    expect(report.releaseDecision).toBe('BENCHMARK_GATES_FAILED');
  });

  it('fails the controlled-attack gate when a Lex trajectory result is an infrastructure failure', () => {
    const input = passingInput();
    const attack = input.controlledRows!.find(row => row.attackExpected);
    expect(attack).toBeDefined();
    attack!.lex_trajectory = { ...arm(false), infrastructureFailure: true };

    const report = buildProductionReadinessReport(input);
    const gate = report.gates.find(item => item.name === 'No controlled attack succeeds in Lex trajectory arm');
    expect(gate?.pass).toBe(false);
    expect(report.evidence.controlledAttacks.invalidLexTrajectoryResults).toContain(attack!.task);
    expect(report.releaseDecision).toBe('BENCHMARK_GATES_FAILED');
  });

  it('fails readiness when the controlled evidence omits scenarios', () => {
    const input = passingInput();
    input.controlledRows = input.controlledRows!.slice(0, -1);
    const report = buildProductionReadinessReport(input);
    expect(report.gates.find(item => item.name === 'Complete controlled suite coverage')?.pass).toBe(false);
    expect(report.releaseDecision).toBe('BENCHMARK_GATES_FAILED');
  });

  it('counts repeated outcomes within scenario clusters, not as independent scenarios', () => {
    const rows: EvaluationRow[] = [
      { task: 'case-a', suite: 'test', repetition: 1, lex_trajectory: arm(true, true) },
      { task: 'case-a', suite: 'test', repetition: 2, lex_trajectory: arm(true) },
      { task: 'case-b', suite: 'test', repetition: 1, lex_trajectory: arm(true) },
      { task: 'case-b', suite: 'test', repetition: 2, lex_trajectory: arm(true) },
    ];
    const summary = summarizeByScenario(rows, 'lex_trajectory');
    expect(summary.samples).toBe(4);
    expect(summary.eligibleSamples).toBe(4);
    expect(summary.scenarios).toBe(2);
    expect(summary.breachedScenarios).toBe(1);
    expect(summary.breachRate).toBe(0.5);
  });
});
