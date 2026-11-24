// Tests for docs/plan-approval-design.md.
//
// These tests are written before the implementation. They import lib/plan_approval,
// which does not exist yet, so the whole file fails until the build PR lands.
//
// The API used here is a proposal. The build PR must either match it or change
// these tests in the same PR, with the change reviewed.
//
// Proposed API:
//   createDraft({ ownerId, planId, branch, base, writes, pr?, nowMs? }) -> draft | throws PlanError
//   approvePlan({ draft, approverId, approvalRequestId, nowMs? })        -> plan | throws PlanError
//   executeWrite({ plan, index, path, op, content, measurement, recoveryState, nowMs? })
//                                                                       -> receipt | throws PlanError
// PlanError has a `code` field, one of the codes asserted below.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createDraft, approvePlan, executeWrite } from '../lib/plan_approval';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const NOW = 1_800_000_000_000;
const MIN = 60_000;
const OPERATOR = 'operator';

const okWrite = (index: number, path = 'docs/a.md', content = 'A') => ({
  index,
  path,
  op: 'create' as const,
  result_sha256: sha(content),
});

const okDraft = (overrides: Record<string, unknown> = {}) => ({
  ownerId: 'anyone',
  planId: `plan-${Math.random().toString(36).slice(2)}`,
  branch: 'fix/plan-test',
  base: 'main',
  writes: [okWrite(0)],
  nowMs: NOW,
  ...overrides,
});

const activePlan = (overrides: Record<string, unknown> = {}) => {
  const draft = createDraft(okDraft(overrides) as never);
  return approvePlan({ draft, approverId: OPERATOR, approvalRequestId: `req-${draft.planId}`, nowMs: NOW });
};

const execOpts = (plan: any, overrides: Record<string, unknown> = {}) => ({
  plan,
  index: 0,
  path: 'docs/a.md',
  op: 'create',
  content: 'A',
  measurement: 'task_context',
  recoveryState: 'VERIFIED',
  nowMs: NOW,
  ...overrides,
});

const expectCode = (fn: () => unknown, code: string) => {
  let caught: any;
  try { fn(); } catch (e) { caught = e; }
  expect(caught, `expected PlanError ${code}`).toBeDefined();
  expect(caught.code).toBe(code);
};

describe('plan creation: scope', () => {
  it('refuses a branch outside fix/* and govern/*', () => {
    expectCode(() => createDraft(okDraft({ branch: 'feature/x' }) as never), 'BRANCH_NOT_ALLOWED');
  });

  it('refuses a branch named main', () => {
    expectCode(() => createDraft(okDraft({ branch: 'main' }) as never), 'MAIN_REFUSED');
  });

  it('refuses a PR whose base is main', () => {
    expectCode(() => createDraft(okDraft({ pr: { draft: true, base: 'main', title_sha256: sha('t'), body_sha256: sha('b') } }) as never), 'MAIN_REFUSED');
  });

  it('refuses a path outside the tier 1 allowlist', () => {
    expectCode(() => createDraft(okDraft({ writes: [okWrite(0, 'secrets/.env')] }) as never), 'PATH_OUTSIDE_ALLOWLIST');
  });

  it('refuses tier 2 runtime paths lib/ and app/', () => {
    expectCode(() => createDraft(okDraft({ writes: [okWrite(0, 'lib/sovereign_kernel.ts')] }) as never), 'TIER2_PATH');
    expectCode(() => createDraft(okDraft({ writes: [okWrite(0, 'app/api/mcp/route.ts')] }) as never), 'TIER2_PATH');
  });

  it('refuses governance-layer paths even inside docs-looking names', () => {
    expectCode(() => createDraft(okDraft({ writes: [okWrite(0, 'lib/scoped_grants.ts')] }) as never), 'PATH_OUTSIDE_ALLOWLIST');
    expectCode(() => createDraft(okDraft({ writes: [okWrite(0, 'lib/rate_limit.ts')] }) as never), 'PATH_OUTSIDE_ALLOWLIST');
  });

  it('accepts docs/ and __tests__/ paths', () => {
    expect(() => createDraft(okDraft({ writes: [okWrite(0, 'docs/x.md'), okWrite(1, '__tests__/x.test.ts')] }) as never)).not.toThrow();
  });
});

describe('plan creation: limits', () => {
  it('refuses more than 20 writes', () => {
    const writes = Array.from({ length: 21 }, (_, i) => okWrite(i, `docs/${i}.md`, String(i)));
    expectCode(() => createDraft(okDraft({ writes }) as never), 'LIMIT_WRITES');
  });

  it('accepts exactly 20 writes', () => {
    const writes = Array.from({ length: 20 }, (_, i) => okWrite(i, `docs/${i}.md`, String(i)));
    expect(() => createDraft(okDraft({ writes }) as never)).not.toThrow();
  });

  it('refuses more than 10 files', () => {
    const writes = Array.from({ length: 11 }, (_, i) => okWrite(i, `docs/f${i}.md`, String(i)));
    expectCode(() => createDraft(okDraft({ writes }) as never), 'LIMIT_FILES');
  });

  it('refuses a lifetime over 60 minutes', () => {
    expectCode(() => createDraft(okDraft({ expiresInMinutes: 61 }) as never), 'LIFETIME_TOO_LONG');
  });
});

describe('approval', () => {
  it('anyone can draft a plan', () => {
    expect(() => createDraft(okDraft({ ownerId: 'agent-session-1' }) as never)).not.toThrow();
  });

  it('a draft cannot execute before the operator approves it', () => {
    const draft = createDraft(okDraft() as never);
    expectCode(() => executeWrite(execOpts(draft)), 'NOT_APPROVED');
  });

  it('only the operator can approve', () => {
    const draft = createDraft(okDraft() as never);
    expectCode(() => approvePlan({ draft, approverId: 'agent-session-1', approvalRequestId: 'r', nowMs: NOW }), 'NOT_OPERATOR');
  });

  it('an approval is single use', () => {
    const draft = createDraft(okDraft() as never);
    approvePlan({ draft, approverId: OPERATOR, approvalRequestId: 'r1', nowMs: NOW });
    expectCode(() => approvePlan({ draft, approverId: OPERATOR, approvalRequestId: 'r1', nowMs: NOW }), 'APPROVAL_REUSED');
  });
});

describe('execution', () => {
  it('a write with the wrong hash is refused and the plan is suspended', () => {
    const plan = activePlan();
    expectCode(() => executeWrite(execOpts(plan, { content: 'tampered' })), 'HASH_MISMATCH');
    expectCode(() => executeWrite(execOpts(plan)), 'PLAN_SUSPENDED');
  });

  it('a write out of order is refused', () => {
    const plan = activePlan({ writes: [okWrite(0, 'docs/a.md', 'A'), okWrite(1, 'docs/b.md', 'B')] });
    expectCode(() => executeWrite(execOpts(plan, { index: 1, path: 'docs/b.md', content: 'B' })), 'OUT_OF_ORDER');
  });

  it('a write after expires_at is refused', () => {
    const plan = activePlan({ expiresInMinutes: 60 });
    expectCode(() => executeWrite(execOpts(plan, { nowMs: NOW + 61 * MIN })), 'EXPIRED');
  });

  it('a write while recovery is not VERIFIED is refused', () => {
    const plan = activePlan();
    expectCode(() => executeWrite(execOpts(plan, { recoveryState: 'RESTORING' })), 'RECOVERY_NOT_VERIFIED');
    expectCode(() => executeWrite(execOpts(plan, { recoveryState: 'ALERT' })), 'RECOVERY_NOT_VERIFIED');
  });

  it('a fallback measurement blocks the plan at that step', () => {
    const plan = activePlan();
    expectCode(() => executeWrite(execOpts(plan, { measurement: 'fallback' })), 'FALLBACK_MEASUREMENT');
    expectCode(() => executeWrite(execOpts(plan)), 'PLAN_SUSPENDED');
  });

  it('a receipt with placeholder measurements is refused', () => {
    const plan = activePlan();
    expectCode(() => executeWrite(execOpts(plan, { measuredState: { c: 1, r: 1, s: 1, m: 1 } })), 'PLACEHOLDER_RECEIPT');
  });

  it('a successful write produces a receipt with real measurements and the commit sha', () => {
    const plan = activePlan();
    const receipt = executeWrite(execOpts(plan, { measuredState: { c: 0.42, r: 0.35, s: 0.22, m: 0.22 }, commitSha: 'abc123' }));
    expect(receipt.plan_id).toBe(plan.planId);
    expect(receipt.index).toBe(0);
    expect(receipt.result_sha256).toBe(sha('A'));
    expect(receipt.commit_sha).toBe('abc123');
    expect(receipt.measurement).toBe('task_context');
  });
});

describe('plan lifecycle', () => {
  it('a replayed plan_id is refused', () => {
    const first = activePlan({ planId: 'fixed-id' });
    expect(first.planId).toBe('fixed-id');
    expectCode(() => activePlan({ planId: 'fixed-id' }), 'PLAN_ID_REUSED');
  });

  it('a second active plan for the same owner is refused', () => {
    activePlan({ ownerId: 'owner-a' });
    expectCode(() => activePlan({ ownerId: 'owner-a' }), 'CONCURRENT_PLAN');
  });

  it('a failed step closes the plan; remaining writes need a new plan', () => {
    const plan = activePlan({ writes: [okWrite(0, 'docs/a.md', 'A'), okWrite(1, 'docs/b.md', 'B')] });
    expectCode(() => executeWrite(execOpts(plan, { content: 'bad' })), 'HASH_MISMATCH');
    expectCode(() => executeWrite(execOpts(plan, { index: 1, path: 'docs/b.md', content: 'B' })), 'PLAN_SUSPENDED');
  });
});
