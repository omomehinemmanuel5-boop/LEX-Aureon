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
    process.env.LEX_AGENTDOJO_SYNTHETIC_STATE = '1';
    dbExecute.mockRejectedValue(new Error('database unavailable'));

    const decision = await interceptToolCall({
      id: 'synthetic-1',
      name: 'list_files',
      arguments: {},
      session_id: 'synthetic-session',
      task_context: 'list the files in the working directory',
    });

    expect(decision.approved).toBe(true);
    delete process.env.LEX_AGENTDOJO_SYNTHETIC_STATE;
  });
});
