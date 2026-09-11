import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeGovernedTool, toolFn, definitions, validateApiKey, validateAndConsumeKey } = vi.hoisted(() => ({
  executeGovernedTool: vi.fn(),
  toolFn: vi.fn(async () => 'TOOL_RESULT'),
  validateApiKey: vi.fn(async () => ({ valid: true, key: {} })),
  validateAndConsumeKey: vi.fn(async () => ({ valid: true, key: {} })),
  definitions: [
    { name: 'run_governance', description: 'govern', parameters: { type: 'object' } },
    { name: 'get_constitutional_state', description: 'state', parameters: { type: 'object' } },
    { name: 'read_file', description: 'read', parameters: { type: 'object' } },
  ],
}));

vi.mock('next/server', () => ({
  NextResponse: class MockNextResponse {
    status = 200;
    body: unknown;
    constructor(body: unknown = null, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(body: unknown) {
      const response = new MockNextResponse(body);
      return response;
    }
  },
}));

vi.mock('@/lib/api_keys', () => ({
  validateAndConsumeKey,
  validateApiKey,
}));

vi.mock('../lib/lex_crs_agent/tools', () => ({
  TOOL_DEFINITIONS: definitions,
  TOOL_REGISTRY: {
    run_governance: toolFn,
    get_constitutional_state: toolFn,
    read_file: toolFn,
  },
}));

vi.mock('../lib/lex_crs_agent/tools/patch_file', () => ({
  PATCH_FILE_DEFINITION: { name: 'patch_file', description: 'patch', inputSchema: { type: 'object' } },
  patch_file: toolFn,
}));

vi.mock('../lib/agents/constitutional_tool_executor', () => ({
  executeGovernedTool,
}));

// fix (2026-09-06): route.ts now checks getTrajectoryState(sessionId) before
// every dispatch (trajectory-aware routing). This test is specifically about
// the BARE per-call dispatch boundary — no trajectory involved — so mock
// the store to always report "no active trajectory," matching this test's
// actual scenario, rather than letting it fall through to a real (Turso)
// DB call this test doesn't otherwise set up.
vi.mock('../lib/agents/trajectory_session_store', () => ({
  getTrajectoryState: vi.fn(async () => undefined),
  setTrajectoryState: vi.fn(async () => {}),
  clearTrajectoryState: vi.fn(async () => {}),
  isTrajectoryActive: () => false,
}));

import { POST } from '../app/api/mcp/route';

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // validateAndConsumeKey is mocked to always resolve { valid: true }
      // above, so the actual value here is irrelevant — it just needs to
      // be present, since /api/mcp now rejects any tools/call request
      // with no API key before it ever reaches executeGovernedTool.
      'x-lex-api-key': 'test-key',
    },
    body: JSON.stringify(body),
  });
}

describe('MCP constitutional dispatch boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateApiKey.mockResolvedValue({ valid: true, key: {} });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key: {} });
    executeGovernedTool.mockResolvedValue('approved:    true\\ncache_hit:   false\\nTOOL_RESULT');
  });

  it('routes every exposed tool call through the constitutional executor', async () => {
    const tools = [
      ['run_governance', { prompt: 'test' }],
      ['get_constitutional_state', { session_id: 'mine' }],
    ] as const;

    for (const [name, args] of tools) {
      const response = await POST(request({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args },
        id: name,
      }));
      expect(response.status).toBe(200);
    }

    expect(executeGovernedTool).toHaveBeenCalledTimes(tools.length);
    expect(executeGovernedTool.mock.calls.map((call) => call[0])).toEqual([
      'run_governance',
      'get_constitutional_state',
    ]);
  });

  it('does not expose or execute infrastructure tools for public API keys', async () => {
    const listResponse = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1,
    }));
    const listed = (listResponse.body as unknown as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(listed.map(tool => tool.name)).toEqual(['run_governance', 'get_constitutional_state']);

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '.env' } },
      id: 2,
    }));

    expect(response.status).toBe(200);
    expect((response.body as unknown as { error: { code: number } }).error.code).toBe(-32601);
    expect(executeGovernedTool).not.toHaveBeenCalled();
  });

  it('namespaces public session IDs by the authenticated key', async () => {
    await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_constitutional_state', arguments: { session_id: 'shared-label' } },
      id: 3,
    }));

    const scopedArgs = executeGovernedTool.mock.calls[0]?.[1] as { session_id?: string };
    expect(scopedArgs.session_id).toBe('anonymous:shared-label');
  });

  it('does not invoke the executor for an unknown tool', async () => {
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'unknown_tool', arguments: {} },
      id: 1,
    }));

    expect(response.status).toBe(200);
    expect(executeGovernedTool).not.toHaveBeenCalled();
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
  });

  it('rejects malformed tool parameters before quota consumption or execution', async () => {
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'run_governance', arguments: [] },
      id: 4,
    }));

    expect(response.status).toBe(200);
    expect((response.body as unknown as { error: { code: number } }).error.code).toBe(-32602);
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
    expect(executeGovernedTool).not.toHaveBeenCalled();
  });

  it('does not debit quota for capability-denied calls', async () => {
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '.env' } },
      id: 5,
    }));

    expect((response.body as unknown as { error: { code: number } }).error.code).toBe(-32601);
    expect(validateApiKey).toHaveBeenCalledTimes(1);
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON-RPC envelopes before authentication', async () => {
    const response = await POST(request({
      jsonrpc: '1.0',
      method: 'tools/call',
      id: 6,
    }));

    expect((response.body as unknown as { error: { code: number } }).error.code).toBe(-32600);
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
  });
});
