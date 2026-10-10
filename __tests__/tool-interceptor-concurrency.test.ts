import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbExecute, commitMock, measureMock } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  commitMock: vi.fn(),
  measureMock: vi.fn(),
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: dbExecute }),
}));

vi.mock('../lib/agents/tool_crs', () => ({
  measureToolCRS: measureMock,
}));

vi.mock('../lib/agents/governance_commit', () => {
  class GovernanceCommitConflict extends Error {
    constructor(sessionId: string) {
      super(`Governance state changed concurrently for session ${sessionId}`);
      this.name = 'GovernanceCommitConflict';
    }
  }
  return {
    commitGovernanceDecision: commitMock,
    GovernanceCommitConflict,
    writeGovernanceReceipt: vi.fn(),
  };
});

import { interceptToolCall } from '../lib/agents/tool_interceptor';
import { GovernanceCommitConflict } from '../lib/agents/governance_commit';

let persistedVersion = 0;

describe('tool interceptor concurrent CAS conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistedVersion = 0;
    measureMock.mockResolvedValue({
      C: 0.9, R: 0.9, S: 0.9, M: 0.9,
      risk_level: 'ULTRA_LOW', unclassified: false,
    });
    dbExecute.mockImplementation(async ({ sql }: { sql: string }) => {
      if (sql.includes('SELECT last_m FROM z_traj')) {
        return { rows: [{ last_m: 1.0 }] };
      }
      if (sql.includes('SELECT * FROM tool_sessions')) {
        return {
          rows: [{
            session_id: 'concurrency-session',
            sigma_viol: 0,
            n_stable: 3,
            locked: 0,
            tool_calls: 0,
            state_version: persistedVersion,
            updated_at: new Date().toISOString(),
          }],
        };
      }
      return { rows: [] };
    });
  });

  it('reloads state and retries a pre-execution CAS conflict', async () => {
    commitMock
      .mockImplementationOnce(async () => {
        // Simulate another caller winning the state-version compare-and-swap.
        persistedVersion = 1;
        throw new GovernanceCommitConflict('concurrency-session');
      })
      .mockImplementationOnce(async (state: { state_version: number }, expectedVersion: number) => {
        persistedVersion = expectedVersion + 1;
        return { ...state, state_version: persistedVersion };
      });

    const decision = await interceptToolCall({
      id: 'concurrency-retry',
      name: 'read_file',
      arguments: { path: 'README.md' },
      session_id: 'concurrency-session',
      task_context: 'Read using read_file',
    });

    expect(decision.approved).toBe(true);
    expect(commitMock).toHaveBeenCalledTimes(2);
    expect(persistedVersion).toBe(2);
  });

  it('fails closed after the bounded retries are exhausted', async () => {
    commitMock.mockImplementation(async () => {
      throw new GovernanceCommitConflict('concurrency-session');
    });

    const decision = await interceptToolCall({
      id: 'concurrency-exhausted',
      name: 'read_file',
      arguments: { path: 'README.md' },
      session_id: 'concurrency-session',
      task_context: 'Read using read_file',
    });

    expect(decision.approved).toBe(false);
    expect(decision.decision).toBe('DENIED_LOCKED');
    expect(decision.reason).toContain('Concurrent governance decision detected');
    expect(commitMock).toHaveBeenCalledTimes(3);
  });
});
