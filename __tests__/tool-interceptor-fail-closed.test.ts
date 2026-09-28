import { describe, expect, it, vi } from 'vitest';

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: dbExecute }),
}));

import { interceptToolCall } from '../lib/agents/tool_interceptor';

describe('tool interceptor dependency failures', () => {
  it('denies authorization when constitutional state cannot be loaded', async () => {
    dbExecute.mockRejectedValue(new Error('database unavailable'));

    const decision = await interceptToolCall({
      id: 'outage-1',
      name: 'write_file',
      arguments: { path: 'README.md', content: 'blocked' },
      session_id: 'outage-session',
      task_context: 'apply the approved documentation patch',
    });

    expect(decision.approved).toBe(false);
    expect(decision.decision).toBe('DENIED_BLOCKED');
    expect(decision.reason).toContain('state unavailable');
    expect(decision.warning).toContain('fail-closed');
  });

  it('allows isolated synthetic state only outside production', async () => {
    const previousSynthetic = process.env.LEX_AGENTDOJO_SYNTHETIC_STATE;
    vi.stubEnv('NODE_ENV', 'test');
    process.env.LEX_AGENTDOJO_SYNTHETIC_STATE = '1';
    try {
      dbExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rowsAffected: 1 });

      const decision = await interceptToolCall({
        id: 'synthetic-1',
        name: 'list_files',
        arguments: {},
        session_id: 'synthetic-session',
        task_context: 'list the files in the working directory',
      });

      expect(decision.approved).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      if (previousSynthetic === undefined) delete process.env.LEX_AGENTDOJO_SYNTHETIC_STATE;
      else process.env.LEX_AGENTDOJO_SYNTHETIC_STATE = previousSynthetic;
    }
  });

  it('denies when tool-session state cannot be read instead of assuming a clean session', async () => {
    dbExecute
      .mockResolvedValueOnce({ rows: [{ last_m: 1.0 }] })
      .mockRejectedValueOnce(new Error('tool session store unavailable'))
      .mockRejectedValueOnce(new Error('receipt store unavailable'));

    const decision = await interceptToolCall({
      id: 'session-outage',
      name: 'read_file',
      arguments: { path: 'README.md' },
      session_id: 'session-outage',
    });

    expect(decision.approved).toBe(false);
    expect(decision.decision).toBe('DENIED_LOCKED');
    expect(decision.reason).toContain('Tool-session governance state unavailable');
    expect(decision.warning).toContain('receipt could not be persisted');
  });
});
