import { beforeEach, describe, expect, it, vi } from 'vitest';

const { canonicalMcpPost } = vi.hoisted(() => ({
  canonicalMcpPost: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: HeadersInit }) => new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    }),
  },
}));
vi.mock('@/app/api/mcp/route', () => ({ POST: canonicalMcpPost }));

import { GET, POST } from '../app/api/tool-proxy/route';

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/tool-proxy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  canonicalMcpPost.mockResolvedValue(new Response(JSON.stringify({
    jsonrpc: '2.0',
    result: { content: [{ type: 'text', text: 'canonical result' }] },
    id: 'canonical-id',
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
});

describe('/api/tool-proxy canonical compatibility adapter', () => {
  it('delegates one legacy request to the canonical MCP route', async () => {
    const response = await POST(request({
      tool_name: 'read_file',
      arguments: { path: 'README.md' },
      session_id: 'client-session',
      task_context: 'Read the README',
      turn: 2,
    }, { authorization: 'Bearer api-key' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ jsonrpc: '2.0' });
    expect(canonicalMcpPost).toHaveBeenCalledOnce();

    const canonicalRequest = canonicalMcpPost.mock.calls[0][0] as Request;
    expect(canonicalRequest.url).toBe('http://localhost/api/mcp');
    expect(canonicalRequest.headers.get('authorization')).toBe('Bearer api-key');
    expect(canonicalRequest.headers.get('content-length')).toBeNull();
    expect(await canonicalRequest.json()).toMatchObject({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'read_file',
        arguments: {
          path: 'README.md',
          session_id: 'client-session',
          task_context: 'Read the README',
          turn: 2,
        },
      },
    });
  });

  it('does not implement a second authentication or governance path', async () => {
    await POST(request({
      tool_name: 'write_file',
      arguments: { path: 'x', content: 'y' },
      session_id: 'session',
    }, { 'x-lex-api-key': 'key' }));

    expect(canonicalMcpPost).toHaveBeenCalledOnce();
    expect(canonicalMcpPost.mock.calls[0][0].headers.get('x-lex-api-key')).toBe('key');
  });

  it('rejects the removed remote-forwarding mode instead of silently ignoring it', async () => {
    const response = await POST(request({
      tool_name: 'read_file',
      arguments: {},
      session_id: 'session',
      target_mcp_url: 'https://tools.example.com/mcp',
    }));

    expect(response.status).toBe(410);
    expect(canonicalMcpPost).not.toHaveBeenCalled();
    expect((await response.json()).canonical_endpoint).toBe('/api/mcp');
  });

  it.each([
    [{ tool_name: '', arguments: {}, session_id: 'session' }, 'tool_name'],
    [{ tool_name: 'read_file', arguments: [], session_id: 'session' }, 'arguments'],
    [{ tool_name: 'read_file', arguments: {}, session_id: '' }, 'session_id'],
    [{ tool_name: 'read_file', arguments: {}, session_id: 'session', turn: 1.5 }, 'turn'],
  ])('rejects malformed legacy input (%s)', async (body, field) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(field);
    expect(canonicalMcpPost).not.toHaveBeenCalled();
  });

  it('propagates canonical MCP status and body while enforcing no-store', async () => {
    canonicalMcpPost.mockResolvedValueOnce(new Response(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Unauthorized' },
      id: 'id',
    }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'public' } }));

    const response = await POST(request({
      tool_name: 'read_file',
      arguments: {},
      session_id: 'session',
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).error.code).toBe(-32001);
  });

  it('advertises the canonical endpoint', async () => {
    const response = await GET();
    const payload = await response.json();
    expect(payload).toMatchObject({ deprecated: true, canonical_endpoint: '/api/mcp' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});
