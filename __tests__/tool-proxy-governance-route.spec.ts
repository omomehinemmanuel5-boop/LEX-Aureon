import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { validateApiKey, validateAndConsumeKey, checkRateLimit, runZTrajMigrations, interceptToolCall, lookup, httpsRequest } = vi.hoisted(() => ({
  validateApiKey: vi.fn(),
  validateAndConsumeKey: vi.fn(),
  checkRateLimit: vi.fn(),
  runZTrajMigrations: vi.fn(),
  interceptToolCall: vi.fn(),
  lookup: vi.fn(),
  httpsRequest: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), {
      status: init?.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
  },
}));
vi.mock('@/lib/api_keys', () => ({ validateApiKey, validateAndConsumeKey }));
vi.mock('@/lib/rate_limit', () => ({
  getClientIp: () => '198.51.100.40',
  checkRateLimit,
}));
vi.mock('@/lib/db', () => ({ runZTrajMigrations }));
vi.mock('@/lib/agents/tool_interceptor', () => ({ interceptToolCall }));
vi.mock('node:dns/promises', () => ({ lookup }));
vi.mock('node:https', () => ({ request: httpsRequest }));

import { POST } from '../app/api/tool-proxy/route';

const approved = {
  approved: true,
  decision: 'APPROVED',
  reason: 'within scope',
  crs: { C: 0.9, R: 0.9, S: 0.9, M: 0.9, risk_level: 'LOW' as const },
  receipt_id: 'TCR-test',
  sigma_viol: 0,
  health_band: 'OPTIMAL' as const,
};

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/tool-proxy', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  tool_name: 'read_file',
  arguments: { path: 'README.md' },
  session_id: 'client-session',
};

function installHttpsResponse(payload: unknown = { result: { content: [] } }, statusCode = 200) {
  httpsRequest.mockImplementation((_options: unknown, callback: (response: EventEmitter & { statusCode?: number }) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      end: (body?: string) => void;
      setTimeout: (ms: number, callback: () => void) => void;
      destroy: (error?: Error) => void;
    };
    req.setTimeout = vi.fn();
    req.destroy = (error?: Error) => { if (error) req.emit('error', error); };
    req.end = () => {
      const response = new EventEmitter() as EventEmitter & { statusCode?: number; destroy: (error?: Error) => void };
      response.statusCode = statusCode;
      response.destroy = (error?: Error) => { if (error) response.emit('error', error); };
      process.nextTick(() => {
        callback(response);
        response.emit('data', Buffer.from(JSON.stringify(payload)));
        response.emit('end');
      });
    };
    return req;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MCP_OPERATOR_SECRET = 'operator-test-secret';
  delete process.env.TOOL_PROXY_ALLOWED_HOSTS;
  validateApiKey.mockResolvedValue({ valid: true, key: { id: 'key-123' } });
  validateAndConsumeKey.mockResolvedValue({ valid: true, key: { id: 'key-123' } });
  checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, retryAfter: 0 });
  runZTrajMigrations.mockResolvedValue(undefined);
  interceptToolCall.mockResolvedValue(approved);
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  installHttpsResponse();
});

afterEach(() => {
  delete process.env.MCP_OPERATOR_SECRET;
  delete process.env.TOOL_PROXY_ALLOWED_HOSTS;
});

describe('/api/tool-proxy governance boundary', () => {
  it('rejects unauthenticated requests before governance or execution', async () => {
    const response = await POST(request(baseBody));
    expect(response.status).toBe(401);
    expect(interceptToolCall).not.toHaveBeenCalled();
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
  });

  it('fails closed when admission storage is unavailable', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, retryAfter: 5, storageError: true });
    const response = await POST(request(baseBody, { 'x-lex-api-key': 'secret-key' }));
    expect(response.status).toBe(503);
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(interceptToolCall).not.toHaveBeenCalled();
  });

  it('rejects private-network targets without consuming credentials or calling governance', async () => {
    const response = await POST(request({
      ...baseBody,
      target_mcp_url: 'https://127.0.0.1/internal-mcp',
    }, { 'x-lex-operator-secret': 'operator-test-secret' }));
    expect(response.status).toBe(403);
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(interceptToolCall).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not perform outbound DNS resolution before caller authentication', async () => {
    process.env.TOOL_PROXY_ALLOWED_HOSTS = 'tools.example.com';
    const response = await POST(request({
      ...baseBody,
      target_mcp_url: 'https://tools.example.com/mcp',
    }));

    expect(response.status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
    expect(validateApiKey).not.toHaveBeenCalled();
  });

  it('requires an exact allowlisted public HTTPS host before forwarding', async () => {
    process.env.TOOL_PROXY_ALLOWED_HOSTS = 'tools.example.com';
    const response = await POST(request({
      ...baseBody,
      target_mcp_url: 'http://tools.example.com/mcp',
    }, { 'x-lex-operator-secret': 'operator-test-secret' }));
    expect(response.status).toBe(403);
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(interceptToolCall).not.toHaveBeenCalled();
  });

  it('rejects an allowlisted hostname if any DNS answer is private or reserved', async () => {
    process.env.TOOL_PROXY_ALLOWED_HOSTS = 'tools.example.com';
    lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.12', family: 4 },
    ]);
    const response = await POST(request({
      ...baseBody,
      target_mcp_url: 'https://tools.example.com/mcp',
    }, { 'x-lex-operator-secret': 'operator-test-secret' }));

    expect(response.status).toBe(403);
    expect(interceptToolCall).not.toHaveBeenCalled();
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it('consumes a valid API key and records its actor-scoped session', async () => {
    const response = await POST(request(baseBody, { 'x-lex-api-key': 'raw-key' }));
    const payload = await response.json() as { approved: boolean; execution_status: string };
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ approved: true, execution_status: 'not_requested' });
    expect(validateAndConsumeKey).toHaveBeenCalledWith('raw-key');
    expect(interceptToolCall).toHaveBeenCalledWith(expect.objectContaining({
      actor_id: 'api_key:key-123',
      session_id: 'api_key:key-123:client-session',
    }));
    expect(JSON.stringify(payload)).not.toContain('raw-key');
  });

  it('accepts the legacy x-api-key header alias', async () => {
    const response = await POST(request(baseBody, { 'x-api-key': 'legacy-key' }));
    expect(response.status).toBe(200);
    expect(validateApiKey).toHaveBeenCalledWith('legacy-key');
    expect(validateAndConsumeKey).toHaveBeenCalledWith('legacy-key');
  });

  it('pins the verified DNS address and reports timeout as an unknown outcome', async () => {
    process.env.TOOL_PROXY_ALLOWED_HOSTS = 'tools.example.com';
    httpsRequest.mockImplementation((options: { lookup: (hostname: string, opts: unknown, callback: (error: Error | null, address: string, family: number) => void) => void }) => {
      const req = new EventEmitter() as EventEmitter & {
        end: (body?: string) => void;
        setTimeout: (ms: number, callback: () => void) => void;
        destroy: (error?: Error) => void;
      };
      req.setTimeout = (_ms, callback) => callback();
      req.destroy = (error?: Error) => { if (error) req.emit('error', error); };
      req.end = () => {};
      options.lookup('tools.example.com', {}, (error, address, family) => {
        expect(error).toBeNull();
        expect(address).toBe('93.184.216.34');
        expect(family).toBe(4);
      });
      return req;
    });

    const response = await POST(request({
      ...baseBody,
      target_mcp_url: 'https://tools.example.com/mcp',
    }, { 'x-lex-operator-secret': 'operator-test-secret' }));
    const payload = await response.json() as { approved: boolean; execution_status: string; execution_error: string };

    expect(response.status).toBe(504);
    expect(lookup).toHaveBeenCalledWith('tools.example.com', { all: true, verbatim: true });
    expect(payload.approved).toBe(true);
    expect(payload.execution_status).toBe('unknown');
    expect(payload.execution_error).toContain('Verify before retrying');
  });

  it('forwards only after approval and never follows redirects', async () => {
    process.env.TOOL_PROXY_ALLOWED_HOSTS = 'tools.example.com';
    const response = await POST(request({
      ...baseBody,
      target_mcp_url: 'https://tools.example.com/mcp',
    }, { 'x-lex-operator-secret': 'operator-test-secret' }));
    const payload = await response.json() as { execution_status: string; result: unknown };

    expect(response.status).toBe(200);
    expect(payload.execution_status).toBe('completed');
    expect(payload.result).toEqual({ content: [] });
    expect(httpsRequest).toHaveBeenCalledOnce();
    expect(httpsRequest.mock.calls[0][0]).toMatchObject({ hostname: 'tools.example.com', servername: 'tools.example.com' });
  });

  it('labels remote HTTP errors as unknown rather than safe-to-retry failures', async () => {
    process.env.TOOL_PROXY_ALLOWED_HOSTS = 'tools.example.com';
    installHttpsResponse({ error: 'upstream failed' }, 503);
    const response = await POST(request({
      ...baseBody,
      target_mcp_url: 'https://tools.example.com/mcp',
    }, { 'x-lex-operator-secret': 'operator-test-secret' }));
    const payload = await response.json() as { execution_status: string; execution_error: string };

    expect(response.status).toBe(502);
    expect(payload.execution_status).toBe('unknown');
    expect(payload.execution_error).toContain('Verify before retrying');
  });

  it('never forwards a denied tool call', async () => {
    process.env.TOOL_PROXY_ALLOWED_HOSTS = 'tools.example.com';
    interceptToolCall.mockResolvedValue({
      ...approved,
      approved: false,
      decision: 'DENIED_BLOCKED',
      reason: 'blocked',
    });

    const response = await POST(request({
      ...baseBody,
      target_mcp_url: 'https://tools.example.com/mcp',
    }, { 'x-lex-operator-secret': 'operator-test-secret' }));
    expect(response.status).toBe(403);
    expect(httpsRequest).not.toHaveBeenCalled();
    expect((await response.json()).execution_status).toBe('not_started');
  });
});
