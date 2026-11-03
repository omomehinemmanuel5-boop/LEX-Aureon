import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlLog, commit } = vi.hoisted(() => ({
  sqlLog: [] as string[],
  commit: vi.fn(async (state: { sigma_viol: number }) => ({ ...state })),
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({
    execute: async ({ sql }: { sql: string }) => {
      sqlLog.push(sql);
      if (sql.includes('z_traj')) return { rows: [{ last_m: 0.9 }] };
      if (sql.includes('tool_sessions')) return { rows: [] };
      return { rows: [] };
    },
  }),
}));

vi.mock('../lib/agents/governance_commit', () => ({
  commitGovernanceDecision: commit,
  GovernanceCommitConflict: class GovernanceCommitConflict extends Error {},
}));

vi.mock('../lib/agents/tool_crs', () => ({
  measureToolCRS: async () => ({
    C: 0.1, R: 0.1, S: 0.1, M: 0.9,
    risk_level: 'ULTRA_LOW',
    unclassified: false,
    injection: false,
  }),
}));

import {
  interceptToolCall,
  interceptToolCallDeferred,
  commitDeferredInterceptorDecision,
} from '../lib/agents/tool_interceptor';

const input = {
  id: 'call-1',
  name: 'read_file',
  arguments: { path: 'README.md' },
  session_id: 'owner:mcp-0123456789ab',
  actor_id: 'api_key:owner',
  task_context: 'test',
};

describe('deferred interceptor commit', () => {
  beforeEach(() => {
    commit.mockClear();
    sqlLog.length = 0;
  });

  it('evaluates an approved call without writing any telemetry', async () => {
    const decision = await interceptToolCallDeferred(input);
    expect(decision.approved).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(sqlLog.some(sql => /INSERT|UPDATE/i.test(sql))).toBe(false);
  });

  it('commits an approved deferred decision exactly once when the caller commits it', async () => {
    const decision = await interceptToolCallDeferred(input);
    const committed = await commitDeferredInterceptorDecision(decision);
    expect(committed.approved).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('drops an approved decision that the caller never commits, with no state write', async () => {
    await interceptToolCallDeferred(input);
    expect(commit).not.toHaveBeenCalled();
  });

  it('passes a denied decision through without any commit', async () => {
    const denied = {
      approved: false,
      decision: 'DENIED_BLOCKED' as const,
      reason: 'test denial',
      crs: { C: 0, R: 0, S: 0, M: 0, risk_level: 'BLOCKED' as const },
      receipt_id: 'TCR-TEST',
      sigma_viol: 1,
      health_band: 'LOCKED' as const,
    };
    const result = await commitDeferredInterceptorDecision(denied);
    expect(result).toEqual(denied);
    expect(commit).not.toHaveBeenCalled();
  });

  it('refuses an approved decision that has no pending commit', async () => {
    const forged = {
      approved: true,
      decision: 'APPROVED' as const,
      reason: 'forged',
      crs: { C: 0, R: 0, S: 0, M: 0, risk_level: 'ULTRA_LOW' as const },
      receipt_id: 'TCR-FORGED',
      sigma_viol: 0,
      health_band: 'OPTIMAL' as const,
    };
    const result = await commitDeferredInterceptorDecision(forged);
    expect(result.approved).toBe(false);
    expect(commit).not.toHaveBeenCalled();
  });

  it('keeps the immediate interceptToolCall path committing on approval', async () => {
    const decision = await interceptToolCall(input);
    expect(decision.approved).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
