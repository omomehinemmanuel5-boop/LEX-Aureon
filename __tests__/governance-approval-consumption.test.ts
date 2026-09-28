import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: dbExecute }),
}));

import {
  consumeGovernanceApprovalToken,
  createGovernanceApprovalToken,
} from '../lib/agents/tool_governance_gateway';

describe('governance approval consumption', () => {
  const action = {
    actorId: 'agent-1',
    sessionId: 'session-1',
    toolName: 'dispatch_workflow',
    args: { workflow: 'ci.yml' },
  };
  const nowMs = 1_700_000_000_000;

  beforeEach(() => {
    vi.stubEnv('LEX_APPROVAL_SIGNING_SECRET', 'consumption-test-secret');
    dbExecute.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('consumes a signed approval once and rejects the replay', async () => {
    const token = createGovernanceApprovalToken({ ...action, nowMs, approvalId: 'one-time-1' });
    dbExecute
      .mockResolvedValueOnce({ rowsAffected: 0 }) // CREATE TABLE
      .mockResolvedValueOnce({ rowsAffected: 0 }) // cleanup
      .mockResolvedValueOnce({ rowsAffected: 1 }); // first INSERT

    const first = await consumeGovernanceApprovalToken({ ...action, token, nowMs });
    expect(first.consumed).toBe(true);
    expect(first.approvalId).toBe('one-time-1');

    dbExecute
      .mockResolvedValueOnce({ rowsAffected: 0 })
      .mockResolvedValueOnce({ rowsAffected: 0 })
      .mockResolvedValueOnce({ rowsAffected: 0 }); // INSERT OR IGNORE loses race/replay
    const replay = await consumeGovernanceApprovalToken({ ...action, token, nowMs: nowMs + 1000 });
    expect(replay.consumed).toBe(false);
    expect(replay.reason).toContain('already been consumed');
  });

  it('fails closed when the consumption store is unavailable', async () => {
    const token = createGovernanceApprovalToken({ ...action, nowMs, approvalId: 'store-outage-1' });
    dbExecute.mockRejectedValue(new Error('database unavailable'));
    const result = await consumeGovernanceApprovalToken({ ...action, token, nowMs });
    expect(result.consumed).toBe(false);
    expect(result.reason).toContain('store unavailable');
  });
});
