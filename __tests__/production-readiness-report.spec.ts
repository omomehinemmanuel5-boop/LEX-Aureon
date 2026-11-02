import { describe, expect, it } from 'vitest';
import { buildProductionReadinessReport, summarizeByScenario, type ControlledRow, type EvaluationInput, type EvaluationRow } from '../scripts/agentdojo-real/production-readiness-report';
import type { ArmResult } from '../scripts/agentdojo-real/model-in-loop';
import { SUITE } from '../scripts/agentdojo-real/suite';

function arm(utility: boolean, securityBreached = false): ArmResult {
  return { utility, securityBreached, blocked: 0, decisions: [], infrastructureFailure: false };
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
