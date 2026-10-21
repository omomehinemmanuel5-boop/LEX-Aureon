import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readCanonicalGovernanceState, canonicalExecutionAllowed, interceptToolCall, consumeApprovalRequest, approvalArgsHash } = vi.hoisted(() => ({
  readCanonicalGovernanceState: vi.fn(),
  canonicalExecutionAllowed: vi.fn(),
  interceptToolCall: vi.fn(),
  consumeApprovalRequest: vi.fn(),
  approvalArgsHash: vi.fn(() => 'bound-hash'),
}));
vi.mock('../lib/agents/canonical_governance_state', () => ({ readCanonicalGovernanceState, canonicalExecutionAllowed }));
vi.mock('../lib/agents/tool_interceptor', () => ({ interceptToolCall }));
vi.mock('../lib/approval_requests', () => ({ consumeApprovalRequest, approvalArgsHash }));

import { executeGovernedToolStructured } from '../lib/agents/constitutional_tool_executor';
import { currentConsumedApproval } from '../lib/agents/approval_execution_context';

const state = {
  sessionId: 'owner-a:session', actorId: 'api_key:owner-a',
  C: 1, R: 1, S: 1, M: 1, healthBand: 'OPTIMAL', recoveryState: 'NORMAL',
  sigmaViol: 0, toolCalls: 2, trajectoryAvailable: true, nStable: 3,
  canaryPassed: true, canaryReceiptId: 'canary', stateFingerprint: 'fingerprint',
  trajectoryUpdatedAt: '2026-10-11T00:00:00.000Z', authorization: 'approval_required',
  policyRisk: 'write', version: 'test', observedAt: '2026-10-11T00:00:00.000Z',
} as const;

describe('one-tap approval executor integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readCanonicalGovernanceState.mockResolvedValue({ available: true, state });
    canonicalExecutionAllowed.mockReturnValue({ allowed: true });
    interceptToolCall.mockResolvedValue({
      approved: true, decision: 'APPROVED', reason: 'okay', receipt_id: 'receipt',
      crs: { C: 1, R: 1, S: 1, M: 1, risk_level: 'LOW' }, health_band: 'OPTIMAL', sigma_viol: 0,
    });
    consumeApprovalRequest.mockResolvedValue({ consumed: true, reason: 'consumed once' });
  });

  it('consumes the exact owner-bound request after health checks and strips its ID before the handler', async () => {
    const args = { path: 'README.md', content: 'hello', message: 'update', session_id: state.sessionId, approval_request_id: 'a'.repeat(22) };
    const handler = vi.fn(async (handlerArgs: Record<string, unknown>) => {
      expect(handlerArgs.approval_request_id).toBeUndefined();
      expect(currentConsumedApproval()).toMatchObject({
        requestId: 'a'.repeat(22), ownerId: 'owner-a', sessionId: state.sessionId,
        toolName: 'write_file', argsHash: 'bound-hash',
      });
      return 'WRITE_COMPLETE';
    });
    const result = await executeGovernedToolStructured(
      'write_file', args, handler, state.sessionId, undefined, state.actorId,
      undefined, 'owner-a', 'owner-a',
    );
    expect(consumeApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'a'.repeat(22), ownerId: 'owner-a', sessionId: state.sessionId,
      toolName: 'write_file', args,
    }));
    expect(handler).toHaveBeenCalledOnce();
    expect(result.approved).toBe(true);
    expect(result.policy?.decision).toBe('allow');
    expect(currentConsumedApproval()).toBeUndefined();
  }, 15_000);

  it.each([
    ['create_branch', { branch: 'fix/exact-approval', from_branch: 'main' }],
    ['open_pr', { head: 'fix/exact-approval', base: 'main', title: 'Exact approval', body: 'Reviewed' }],
  ])('%s executes once only after exact approval consumption', async (toolName, actionArgs) => {
    consumeApprovalRequest
      .mockResolvedValueOnce({ consumed: true, reason: 'approved exact action' })
      .mockResolvedValueOnce({ consumed: false, reason: 'already used' });
    const handler = vi.fn(async (handlerArgs: Record<string, unknown>) => {
      expect(handlerArgs.approval_request_id).toBeUndefined();
      return 'GITHUB_ACTION_COMPLETE';
    });
    const args = { ...actionArgs, session_id: state.sessionId, approval_request_id: 'd'.repeat(22) };
    const first = await executeGovernedToolStructured(
      toolName, args, handler, state.sessionId, undefined, state.actorId,
      undefined, 'owner-a', 'owner-a',
    );
    expect(first.approved).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    const replay = await executeGovernedToolStructured(
      toolName, args, handler, state.sessionId, undefined, state.actorId,
      undefined, 'owner-a', 'owner-a',
    );
    expect(replay.approved).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
  }, 15_000);

  it.each([
    ['create_branch', { branch: 'fix/not-approved', from_branch: 'main' }],
    ['open_pr', { head: 'fix/not-approved', base: 'main', title: 'Not approved', body: '' }],
  ])('%s never executes with a pending or expired request', async (toolName, actionArgs) => {
    consumeApprovalRequest.mockResolvedValue({ consumed: false, reason: 'Approval request is pending or expired.' });
    const handler = vi.fn(async () => 'SHOULD_NOT_RUN');
    const result = await executeGovernedToolStructured(
      toolName,
      { ...actionArgs, session_id: state.sessionId, approval_request_id: 'e'.repeat(22) },
      handler, state.sessionId, undefined, state.actorId, undefined, 'owner-a', 'owner-a',
    );
    expect(result.approved).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  }, 15_000);

  it('does not consume an approved request when canonical session health fails', async () => {
    canonicalExecutionAllowed.mockReturnValue({ allowed: false, reason: 'recovery evidence missing' });
    const handler = vi.fn(async () => 'SHOULD_NOT_RUN');
    const result = await executeGovernedToolStructured(
      'write_file', { path: 'README.md', approval_request_id: 'b'.repeat(22) }, handler,
      state.sessionId, undefined, state.actorId, undefined, 'owner-a', 'owner-a',
    );
    expect(result.approved).toBe(false);
    expect(consumeApprovalRequest).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not invoke the handler when the atomic consumption loses a replay or race', async () => {
    consumeApprovalRequest.mockResolvedValueOnce({ consumed: false, reason: 'already used' });
    const handler = vi.fn(async () => 'SHOULD_NOT_RUN');
    const result = await executeGovernedToolStructured(
      'write_file', { path: 'README.md', approval_request_id: 'c'.repeat(22) }, handler,
      state.sessionId, undefined, state.actorId, undefined, 'owner-a', 'owner-a',
    );
    expect(result.approved).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});
