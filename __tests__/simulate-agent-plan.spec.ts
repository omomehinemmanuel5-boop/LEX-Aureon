import { describe, expect, it } from 'vitest';
import { simulate_agent_plan } from '../lib/lex_crs_agent/tools';

describe('simulate_agent_plan exact counts and recovery semantics', () => {
  it('reports exactly 50 ordered actions for an exact 50-step input', async () => {
    const result = JSON.parse(await simulate_agent_plan({
      actions: Array.from({ length: 50 }, (_, index) => ({
        toolName: 'read_file',
        risk: 'read',
        target: `artifact-${index + 1}.md`,
      })),
    }));

    expect(result.action_count).toBe(50);
    expect(result.trajectory).toHaveLength(50);
    expect(result.trajectory.map((step: { step: number }) => step.step))
      .toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(result.decision).toBe('allow');
    expect(result.trajectory[49].step).toBe(50);
    expect(result.canonical_state_committed).toBe(false);
    expect(result.receipt_persisted).toBe(false);
  });

  it('does not infer recovery canary success from optimal M and absent evidence', async () => {
    const result = JSON.parse(await simulate_agent_plan({
      actions: [{ toolName: 'write_file', risk: 'write', target: 'README.md' }],
    }));

    expect(result.trajectory[0]).toMatchObject({
      policy_decision: 'deny',
      capability_allowed: false,
      recovery_state_before: 'RESTORING',
    });
    expect(result.trajectory[0].warning).toContain('run_recovery_canary');
    expect(result.recovery_evidence.source).toContain('never valid as production evidence');
    expect(result.canonical_state_committed).toBe(false);
  });

  it('treats supplied canary data as hypothetical, preserves action approval, and invalidates it after state change', async () => {
    const result = JSON.parse(await simulate_agent_plan({
      actions: [{ toolName: 'write_file', risk: 'write', target: 'README.md' }],
      recovery_evidence: { canary_passed: true, n_stable: 3, sigma_viol: 0 },
    }));

    expect(result.trajectory[0]).toMatchObject({
      policy_decision: 'approval_required',
      capability_allowed: true,
      recovery_state_before: 'NORMAL',
      recovery_state_after: 'RESTORING',
    });
    expect(result.decision).toBe('approval_required');
    expect(result.recovery_evidence.source).toContain('hypothetical input only');
    expect(result.receipt_persisted).toBe(false);
    expect(result.memory_persisted).toBe(false);
  });

  it('requires a fresh exact-snapshot canary before the next write after a simulated state change', async () => {
    const result = JSON.parse(await simulate_agent_plan({
      actions: [
        { toolName: 'write_file', risk: 'write', target: 'README.md' },
        { toolName: 'write_file', risk: 'write', target: 'docs/next.md' },
      ],
      recovery_evidence: { canary_passed: true, n_stable: 3, sigma_viol: 0 },
    }));

    expect(result.trajectory[0].policy_decision).toBe('approval_required');
    expect(result.trajectory[1].policy_decision).toBe('deny');
    expect(result.trajectory[1].capability_allowed).toBe(false);
    expect(result.trajectory[1].warning).toContain('run_recovery_canary');
    expect(result.recovery_evidence.effective_after_simulation.canary_passed).toBe(false);
  });
});
