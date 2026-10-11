import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('../lib/db', () => ({ getClient: () => ({ execute }) }));

import { getGitHubCredentialForApprovedAction } from '../lib/agents/credential_broker';
import { withConsumedApproval } from '../lib/agents/approval_execution_context';
import { approvalArgsHash } from '../lib/approval_requests';

const actionArgs = {
  path: 'README.md', content: 'approved content', message: 'update', session_id: 'owner-a:s1',
};
const context = {
  requestId: 'e'.repeat(22), ownerId: 'owner-a', sessionId: 'owner-a:s1',
  toolName: 'write_file', argsHash: approvalArgsHash(actionArgs),
};

describe('credential broker one-tap approval context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GITHUB_TOKEN', 'unit-test-only-placeholder');
    execute.mockResolvedValue({ rows: [{ request_id: context.requestId }] });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns the existing server-side credential only for a matching consumed row and exact action', async () => {
    const result = await withConsumedApproval(context, () => getGitHubCredentialForApprovedAction({
      token: undefined, toolName: 'write_file', args: actionArgs,
    }));
    expect(result).toBe('unit-test-only-placeholder');
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      args: [context.requestId, context.ownerId, context.sessionId, context.toolName, context.argsHash, expect.any(Number)],
    }));
  });

  it('rejects mismatched arguments, tool names, or missing consumed rows', async () => {
    await expect(withConsumedApproval(context, () => getGitHubCredentialForApprovedAction({
      token: undefined, toolName: 'write_file', args: { ...actionArgs, content: 'tampered' },
    }))).rejects.toThrow('no exact, consumed Lex approval');
    await expect(withConsumedApproval(context, () => getGitHubCredentialForApprovedAction({
      token: undefined, toolName: 'dispatch_workflow', args: actionArgs,
    }))).rejects.toThrow('no exact, consumed Lex approval');
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(withConsumedApproval(context, () => getGitHubCredentialForApprovedAction({
      token: undefined, toolName: 'write_file', args: actionArgs,
    }))).rejects.toThrow('could not be verified');
  });
});
