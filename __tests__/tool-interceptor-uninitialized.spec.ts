import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbExecute, measureToolCRS, commitGovernanceDecision } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  measureToolCRS: vi.fn(),
  commitGovernanceDecision: vi.fn(),
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: dbExecute }),
}));

vi.mock('../lib/agents/tool_crs', () => ({
  measureToolCRS,
}));

vi.mock('../lib/agents/governance_commit', () => ({
  commitGovernanceDecision,
  GovernanceCommitConflict: class GovernanceCommitConflict extends Error {},
}));

import { interceptToolCall } from '../lib/agents/tool_interceptor';

function call(name: string) {
  return interceptToolCall({
    id: `test-${name}`,
    name,
    arguments: {},
    session_id: 'uninitialized-session',
    actor_id: 'test-actor',
  });
}

describe('tool interceptor with an uninitialized canonical trajectory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbExecute.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === 'string' ? query : query.sql;
      if (sql.includes('SELECT last_m FROM z_traj')) return { rows: [] };
      if (sql.includes('SELECT * FROM tool_sessions')) return { rows: [] };
      return { rows: [], rowsAffected: 1 };
    });
    measureToolCRS.mockResolvedValue({
      C: 0.9, R: 0.9, S: 0.9, M: 0.9, risk_level: 'LOW',
    });
    commitGovernanceDecision.mockImplementation(async (state: unknown) => state);
  });

  it('allows an explicitly non-mutating diagnostic when the trajectory row is absent', async () => {
    const decision = await call('get_constitutional_state');

    expect(decision.approved).toBe(true);
    expect(measureToolCRS).toHaveBeenCalledTimes(1);
    expect(commitGovernanceDecision).toHaveBeenCalledTimes(1);
    expect(dbExecute.mock.calls.some(([query]) => {
      const sql = typeof query === 'string' ? query : String((query as { sql?: string }).sql ?? '');
      return /\b(INSERT|UPDATE|DELETE)\s+z_traj\b/i.test(sql);
    })).toBe(false);
  });

  it('continues to deny a consequential tool when the trajectory row is absent', async () => {
    const decision = await call('write_file');

    expect(decision.approved).toBe(false);
    expect(decision.decision).toBe('DENIED_BLOCKED');
    expect(decision.reason).toContain('uninitialized');
    expect(measureToolCRS).not.toHaveBeenCalled();
    expect(commitGovernanceDecision).not.toHaveBeenCalled();
  });

  it('fails closed for read-only diagnostics when the trajectory store is unavailable', async () => {
    dbExecute.mockImplementation(async (query: string | { sql: string }) => {
      const sql = typeof query === 'string' ? query : query.sql;
      if (sql.includes('SELECT last_m FROM z_traj')) throw new Error('database unavailable');
      return { rows: [], rowsAffected: 1 };
    });

    const decision = await call('get_constitutional_state');

    expect(decision.approved).toBe(false);
    expect(decision.decision).toBe('DENIED_BLOCKED');
    expect(decision.reason).toContain('unavailable');
    expect(measureToolCRS).not.toHaveBeenCalled();
    expect(commitGovernanceDecision).not.toHaveBeenCalled();
  });
});
