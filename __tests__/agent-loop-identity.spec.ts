import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  executeGovernedToolStructured: vi.fn(),
  echo: vi.fn(),
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
  runZTrajMigrations: async () => undefined,
}));
vi.mock('../lib/agents/constitutional_tool_executor', () => ({
  executeGovernedToolStructured: h.executeGovernedToolStructured,
}));
vi.mock('../lib/lex_crs_agent/tools', () => ({
  TOOL_REGISTRY: { echo: h.echo },
}));

import { buildLoopTools } from '../lib/lex_crs_agent/loop';

describe('agent loop tool identity', () => {
  beforeEach(() => {
    h.executeGovernedToolStructured.mockReset();
    h.executeGovernedToolStructured.mockResolvedValue({ result: 'ok', approved: true, decision: 'APPROVED', receiptId: 'R1' });
    h.echo.mockReset();
  });

  it('uses the run context for session and actor, not model-supplied values', async () => {
    const tools = buildLoopTools({ sessionId: 'key_own:mcp-abc', actorId: 'api_key:key_own', ownerId: 'key_own', runId: 'run-1' });
    await tools.echo({
      session_id: 'key_victim:mcp-x',
      actor_id: 'api_key:key_victim',
      owner_id: 'key_victim',
      run_id: 'forged',
      task_context: 'ctx',
      msg: 'hi',
    });
    expect(h.executeGovernedToolStructured).toHaveBeenCalledTimes(1);
    const [name, args, , sessionId, , actorId] = h.executeGovernedToolStructured.mock.calls[0];
    expect(name).toBe('echo');
    expect(sessionId).toBe('key_own:mcp-abc');
    expect(actorId).toBe('api_key:key_own');
    expect(JSON.stringify(args)).not.toContain('key_victim');
    expect(JSON.stringify(args)).not.toContain('forged');
  });

  it('stops a run without calling the model when the client has already aborted', async () => {
    const callLLM = vi.fn();
    vi.doMock('../lib/lex_crs_agent/router', () => ({ callLLM }));
    const controller = new AbortController();
    controller.abort();
    const { runAgentLoop } = await import('../lib/lex_crs_agent/loop');
    const result = await runAgentLoop('task', undefined, undefined, {
      sessionId: 'key_own:mcp-abc',
      actorId: 'api_key:key_own',
      ownerId: 'key_own',
      runId: 'run-1',
      signal: controller.signal,
    });
    expect(result.stop_reason).toBe('cancelled');
    expect(callLLM).not.toHaveBeenCalled();
    expect(h.executeGovernedToolStructured).not.toHaveBeenCalled();
  });

  it('records a denied tool call with its decision and receipt, without changing the text the model sees', async () => {
    h.executeGovernedToolStructured.mockResolvedValue({ result: 'denied by policy', approved: false, decision: 'DENIED_BLOCKED', receiptId: 'R2' });
    const records: Array<Record<string, unknown>> = [];
    const tools = buildLoopTools({ sessionId: 'key_own:mcp-abc', actorId: 'api_key:key_own', ownerId: 'key_own', runId: 'run-1' }, records as never);
    const text = await tools.echo({ msg: 'hi' });
    expect(text).toBe('denied by policy');
    expect(records).toEqual([{ tool: 'echo', approved: false, decision: 'DENIED_BLOCKED', receipt_id: 'R2' }]);
  });
});
