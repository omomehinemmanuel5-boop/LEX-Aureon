import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  executeGovernedTool: vi.fn(),
  echo: vi.fn(),
}));

vi.mock('../lib/db', () => ({ getClient: () => ({ execute: async () => ({ rows: [], rowsAffected: 0 }) }) }));
vi.mock('../lib/agents/constitutional_tool_executor', () => ({
  executeGovernedTool: h.executeGovernedTool,
}));
vi.mock('../lib/lex_crs_agent/tools', () => ({
  TOOL_REGISTRY: { echo: h.echo },
}));

import { buildLoopTools } from '../lib/lex_crs_agent/loop';

describe('agent loop tool identity', () => {
  beforeEach(() => {
    h.executeGovernedTool.mockReset();
    h.executeGovernedTool.mockResolvedValue('ok');
    h.echo.mockReset();
  });

  it('uses the run context for session and actor, not model-supplied values', async () => {
    const tools = buildLoopTools({ sessionId: 'key_own:mcp-abc', actorId: 'api_key:key_own' });
    await tools.echo({
      session_id: 'key_victim:mcp-x',
      actor_id: 'api_key:key_victim',
      owner_id: 'key_victim',
      run_id: 'forged',
      task_context: 'ctx',
      msg: 'hi',
    });
    expect(h.executeGovernedTool).toHaveBeenCalledTimes(1);
    const [name, args, , sessionId, , actorId] = h.executeGovernedTool.mock.calls[0];
    expect(name).toBe('echo');
    expect(sessionId).toBe('key_own:mcp-abc');
    expect(actorId).toBe('api_key:key_own');
    expect(JSON.stringify(args)).not.toContain('key_victim');
    expect(JSON.stringify(args)).not.toContain('forged');
  });
});
