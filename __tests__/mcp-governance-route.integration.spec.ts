import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeGovernedTool, toolFn, definitions } = vi.hoisted(() => ({
  executeGovernedTool: vi.fn(),
  toolFn: vi.fn(async () => 'TOOL_RESULT'),
  definitions: [
    { name: 'read_file', description: 'read', parameters: { type: 'object' } },
    { name: 'write_file', description: 'write', parameters: { type: 'object' } },
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
  validateAndConsumeKey: vi.fn(async () => ({ valid: true, key: {} })),
}));

vi.mock('../lib/lex_crs_agent/tools', () => ({
  TOOL_DEFINITIONS: definitions,
  TOOL_REGISTRY: {
    read_file: toolFn,
    write_file: toolFn,
  },
}));

vi.mock('../lib/lex_crs_agent/tools/patch_file', () => ({
  PATCH_FILE_DEFINITION: { name: 'patch_file', description: 'patch', inputSchema: { type: 'object' } },
  patch_file: toolFn,
}));

vi.mock('../lib/agents/constitutional_tool_executor', () => ({
  executeGovernedTool,
}));

import { POST } from '../app/api/mcp/route';

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('MCP constitutional dispatch boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeGovernedTool.mockResolvedValue('approved:    true\\ncache_hit:   false\\nTOOL_RESULT');
  });

  it('routes every exposed tool call through the constitutional executor', async () => {
    const tools = [
      ['read_file', { path: 'README.md' }],
      ['write_file', { path: 'a.ts', content: 'x' }],
      ['patch_file', { path: 'a.ts', patch: 'x' }],
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
      'read_file',
      'write_file',
      'patch_file',
    ]);
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
  });
});
