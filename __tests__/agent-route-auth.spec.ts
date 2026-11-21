import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  validateApiKey: vi.fn(),
  consumeApiKeyById: vi.fn(),
  checkRateLimit: vi.fn(),
  runAgentLoop: vi.fn(),
}));

vi.mock('../lib/api_keys', () => ({
  validateApiKey: h.validateApiKey,
  consumeApiKeyById: h.consumeApiKeyById,
}));
vi.mock('../lib/rate_limit', () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock('../lib/lex_crs_agent/loop', () => ({ runAgentLoop: h.runAgentLoop }));
vi.mock('../lib/safe_error', () => ({ publicError: () => 'error' }));

import { POST } from '../app/api/agent/route';

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://lexaureon.com/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('POST /api/agent authentication', () => {
  beforeEach(() => {
    h.validateApiKey.mockReset();
    h.runAgentLoop.mockReset();
    h.runAgentLoop.mockResolvedValue({ answer: 'ok' });
    h.consumeApiKeyById.mockReset();
    h.consumeApiKeyById.mockResolvedValue({ valid: true });
    h.checkRateLimit.mockReset();
    h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfter: 0 });
  });

  it('rejects a request with no key and never runs the agent', async () => {
    const res = await POST(req({ task: 'do something' }));
    expect(res.status).toBe(401);
    expect(h.runAgentLoop).not.toHaveBeenCalled();
    expect(h.validateApiKey).not.toHaveBeenCalled();
  });

  it('rejects an invalid key and never runs the agent', async () => {
    h.validateApiKey.mockResolvedValue({ valid: false, error: 'nope' });
    const res = await POST(req({ task: 'x' }, { 'x-lex-api-key': 'bad' }));
    expect(res.status).toBe(401);
    expect(h.runAgentLoop).not.toHaveBeenCalled();
  });

  it('fails closed when the key lookup throws', async () => {
    h.validateApiKey.mockRejectedValue(new Error('db down'));
    const res = await POST(req({ task: 'x' }, { 'x-lex-api-key': 'any' }));
    expect(res.status).toBe(503);
    expect(h.runAgentLoop).not.toHaveBeenCalled();
  });

  it('derives actor and session from the authenticated key, ignoring body identity fields', async () => {
    h.validateApiKey.mockResolvedValue({ valid: true, key: { id: 'key_own' } });
    const res = await POST(req(
      { task: 'x', session_id: 'key_victim:mcp-abc', actor_id: 'api_key:key_victim', owner_id: 'key_victim' },
      { 'x-lex-api-key': 'own' },
    ));
    expect(res.status).toBe(200);
    expect(h.runAgentLoop).toHaveBeenCalledTimes(1);
    const context = h.runAgentLoop.mock.calls[0][3];
    expect(context.actorId).toBe('api_key:key_own');
    expect(context.sessionId.startsWith('key_own:')).toBe(true);
    expect(JSON.stringify(context)).not.toContain('key_victim');
  });

  it('returns 429 with Retry-After when the per-key rate limit is reached, without running the agent', async () => {
    h.validateApiKey.mockResolvedValue({ valid: true, key: { id: 'key_own' } });
    h.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfter: 42 });
    const res = await POST(req({ task: 'x' }, { 'x-lex-api-key': 'own' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('42');
    expect(h.runAgentLoop).not.toHaveBeenCalled();
  });

  it('fails closed when the rate limiter storage is unavailable', async () => {
    h.validateApiKey.mockResolvedValue({ valid: true, key: { id: 'key_own' } });
    h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 0, retryAfter: 0, storageError: true });
    const res = await POST(req({ task: 'x' }, { 'x-lex-api-key': 'own' }));
    expect(res.status).toBe(503);
    expect(h.runAgentLoop).not.toHaveBeenCalled();
  });

  it('returns 429 when the key has no quota left, without running the agent', async () => {
    h.validateApiKey.mockResolvedValue({ valid: true, key: { id: 'key_own' } });
    h.consumeApiKeyById.mockResolvedValue({ valid: false, error: 'quota' });
    const res = await POST(req({ task: 'x' }, { 'x-lex-api-key': 'own' }));
    expect(res.status).toBe(429);
    expect(h.runAgentLoop).not.toHaveBeenCalled();
  });

  it('consumes one run from the authenticated key before running the agent', async () => {
    h.validateApiKey.mockResolvedValue({ valid: true, key: { id: 'key_own' } });
    const res = await POST(req({ task: 'x' }, { 'x-lex-api-key': 'own' }));
    expect(res.status).toBe(200);
    expect(h.consumeApiKeyById).toHaveBeenCalledWith('key_own');
    expect(h.checkRateLimit).toHaveBeenCalledWith('agent.run:key_own', 10, 60);
    expect(h.runAgentLoop).toHaveBeenCalledTimes(1);
  });

  it('gives each request its own run identity and returns it to the caller', async () => {
    h.validateApiKey.mockResolvedValue({ valid: true, key: { id: 'key_own' } });
    const first = await POST(req({ task: 'x' }, { 'x-lex-api-key': 'own' }));
    const second = await POST(req({ task: 'x' }, { 'x-lex-api-key': 'own' }));
    const runA = h.runAgentLoop.mock.calls[0][3].runId;
    const runB = h.runAgentLoop.mock.calls[1][3].runId;
    expect(runA).toBeTruthy();
    expect(runA).not.toBe(runB);
    expect(h.runAgentLoop.mock.calls[0][3].ownerId).toBe('key_own');
    expect((await first.json()).run_id).toBe(runA);
    expect((await second.json()).run_id).toBe(runB);
  });

  it('passes the client abort signal into the run', async () => {
    h.validateApiKey.mockResolvedValue({ valid: true, key: { id: 'key_own' } });
    await POST(req({ task: 'x' }, { 'x-lex-api-key': 'own' }));
    expect(h.runAgentLoop.mock.calls[0][3].signal).toBeDefined();
  });
});
