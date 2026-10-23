import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONSTITUTION } from '../lib/constitution';
import { recoveryCapabilityAllowed } from '../lib/agents/recovery_state';
import {
  classifyDatabaseOperation,
  createGovernanceApprovalToken,
  verifyGovernanceApprovalToken,
} from '../lib/agents/tool_governance_gateway';

const validEvidence = {
  canaryPassed: true,
  nStable: CONSTITUTION.N_MIN,
  sigmaViol: CONSTITUTION.SIGMA_THRESHOLD,
};

describe('security invariant harness', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('binds a signed approval to actor, session, tool, and exact arguments', () => {
    vi.stubEnv('LEX_APPROVAL_SIGNING_SECRET', 'test-only-signing-secret');
    const action = {
      actorId: 'actor-a',
      sessionId: 'session-a',
      toolName: 'patch_file',
      args: { path: 'README.md', old_str: 'a', new_str: 'b' },
      nowMs: 1_800_000_000_000,
      approvalId: 'test-approval-binding',
    };
    const token = createGovernanceApprovalToken(action);

    expect(verifyGovernanceApprovalToken({ token, ...action }).valid).toBe(true);
    expect(verifyGovernanceApprovalToken({ token, ...action, actorId: 'actor-b' }).valid).toBe(false);
    expect(verifyGovernanceApprovalToken({ token, ...action, sessionId: 'session-b' }).valid).toBe(false);
    expect(verifyGovernanceApprovalToken({ token, ...action, toolName: 'delete_file' }).valid).toBe(false);
    expect(verifyGovernanceApprovalToken({
      token, ...action, args: { ...action.args, new_str: 'changed' },
    }).valid).toBe(false);
  });

  it('classifies ambiguous or multi-statement SQL conservatively', () => {
    expect(classifyDatabaseOperation('SELECT * FROM receipts')).toBe('read');
    expect(classifyDatabaseOperation('WITH rows AS (SELECT 1) SELECT * FROM rows')).toBe('read');
    expect(classifyDatabaseOperation('UPDATE receipts SET status = \'changed\'')).toBe('write');
    expect(classifyDatabaseOperation('SELECT 1; DELETE FROM receipts')).toBe('invalid');
    expect(classifyDatabaseOperation('')).toBe('invalid');
  });

  it('never grants ordinary write authority below the configured recovery threshold', () => {
    const belowRecovery = Math.max(
      0,
      (CONSTITUTION.TAU_FLOOR + CONSTITUTION.TAU_RECOVERY) / 2,
    );
    const result = recoveryCapabilityAllowed(belowRecovery, 'write', validEvidence);
    expect(result.allowed).toBe(false);
    expect(recoveryCapabilityAllowed(belowRecovery, 'read', validEvidence).allowed).toBe(true);
    expect(recoveryCapabilityAllowed(belowRecovery, 'recovery', validEvidence).allowed).toBe(true);
  });

  it('requires verified evidence for writes and NORMAL state for destructive capabilities', () => {
    const m = Math.max(CONSTITUTION.TAU_RECOVERY, 0.25);
    expect(recoveryCapabilityAllowed(m, 'write', {
      canaryPassed: false, nStable: CONSTITUTION.N_MIN, sigmaViol: 0,
    }).allowed).toBe(false);
    expect(recoveryCapabilityAllowed(m, 'write', validEvidence).allowed).toBe(true);
    expect(recoveryCapabilityAllowed(Math.min(m, 0.249), 'destructive', validEvidence).allowed).toBe(false);
    expect(recoveryCapabilityAllowed(Math.max(m, 0.25), 'destructive', validEvidence).allowed).toBe(true);
  });

  it('preserves recovery safety invariants across 100 seeded trajectories (1,000 states)', () => {
    // Fixed LCG: no crypto randomness, wall clock, or external side effects.
    let state = 0x4c4558;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x1_0000_0000;
    };
    const capabilities = ['read', 'recovery', 'write', 'external', 'destructive'] as const;

    for (let trajectory = 0; trajectory < 100; trajectory += 1) {
      let crs = [random(), random(), random()];
      const initialTotal = crs.reduce((sum, value) => sum + value, 0);
      crs = crs.map(value => value / initialTotal);

      for (let step = 0; step < 10; step += 1) {
        const raw = crs.map(value => Math.max(1e-6, value + (random() - 0.5) * 0.25));
        const total = raw.reduce((sum, value) => sum + value, 0);
        crs = raw.map(value => value / total);
        const [c, r, s] = crs;
        const m = Math.min(c, r, s);
        const caseLabel = `seed=0x4c4558 trajectory=${trajectory} step=${step}`;

        expect(c + r + s, `${caseLabel} simplex sum`).toBeCloseTo(1, 12);
        expect(m, `${caseLabel} CRS non-negative`).toBeGreaterThanOrEqual(0);

        const evidence = {
          canaryPassed: random() >= 0.5,
          nStable: Math.floor(random() * (CONSTITUTION.N_MIN + 3)),
          sigmaViol: random() * Math.max(CONSTITUTION.SIGMA_THRESHOLD * 2, 0.001),
        };
        const capability = capabilities[Math.floor(random() * capabilities.length)];
        const decision = recoveryCapabilityAllowed(m, capability, evidence);

        if (m < CONSTITUTION.TAU_FLOOR) {
          expect(decision.allowed, `${caseLabel} M=${m} capability=${capability}`).toBe(false);
        }
        if (capability === 'write' || capability === 'external' || capability === 'destructive') {
          if (m < CONSTITUTION.TAU_RECOVERY) {
            expect(decision.allowed, `${caseLabel} below recovery threshold`).toBe(false);
          }
          if (m >= CONSTITUTION.TAU_RECOVERY) {
            const evidenceComplete = evidence.canaryPassed
              && evidence.nStable >= CONSTITUTION.N_MIN
              && evidence.sigmaViol <= CONSTITUTION.SIGMA_THRESHOLD;
            if (!evidenceComplete) {
              expect(decision.allowed, `${caseLabel} missing recovery evidence`).toBe(false);
            }
          }
        }
        if (capability === 'destructive' && decision.allowed) {
          expect(decision.state, `${caseLabel} destructive state`).toBe('NORMAL');
        }
      }
    }
  });

});
