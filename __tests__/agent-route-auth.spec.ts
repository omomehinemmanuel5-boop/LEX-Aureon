import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  validateApiKey: vi.fn(),
  runAgentLoop: vi.fn(),
}));

vi.mock('../lib/api_keys', () => ({ validateApiKey: h.validateApiKey }));
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
});
