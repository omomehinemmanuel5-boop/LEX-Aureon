import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isOperatorSecret, createScopedGrant, revokeScopedGrant } = vi.hoisted(() => ({
  isOperatorSecret: vi.fn(),
  createScopedGrant: vi.fn(),
  revokeScopedGrant: vi.fn(),
}));
vi.mock('../lib/lex_crs_agent/mcp_access', () => ({ isOperatorSecret }));
vi.mock('../lib/scoped_grants', () => ({ createScopedGrant, revokeScopedGrant }));

import { POST } from '../app/api/scoped-grants/route';

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/scoped-grants', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

describe('operator-only scoped grant control plane', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isOperatorSecret.mockReturnValue(false);
    createScopedGrant.mockResolvedValue({ grant_id: 'grant-1', owner_id: 'owner-a' });
    revokeScopedGrant.mockResolvedValue(true);
  });

  it('does not allow an agent API key to create a grant', async () => {
    const response = await POST(request({
      action: 'create', owner_id: 'owner-a', allowed_tools: ['create_branch'],
      path_prefixes: ['docs/'], max_uses: 1, expires_at: Date.now() + 30_000,
    }, { 'x-lex-api-key': 'agent-key' }));
    expect(response.status).toBe(401);
    expect(createScopedGrant).not.toHaveBeenCalled();
  });

  it('creates a grant only when the existing operator secret authenticates the request', async () => {
    isOperatorSecret.mockReturnValue(true);
    const response = await POST(request({
      action: 'create', owner_id: 'owner-a', allowed_tools: ['create_branch'],
      path_prefixes: ['docs/'], max_uses: 1, expires_at: Date.now() + 30_000,
    }, { 'x-lex-operator-secret': 'operator-secret' }));
    expect(response.status).toBe(201);
    expect(createScopedGrant).toHaveBeenCalledWith(expect.objectContaining({
      owner_id: 'owner-a', allowed_tools: ['create_branch'], path_prefixes: ['docs/'], max_uses: 1,
    }), true);
  });

  it('revokes grants only through the operator-authenticated control plane', async () => {
    isOperatorSecret.mockReturnValue(true);
    const response = await POST(request({ action: 'revoke', grant_id: 'grant-1' }, { 'x-lex-operator-secret': 'operator-secret' }));
    expect(response.status).toBe(200);
    expect(revokeScopedGrant).toHaveBeenCalledWith('grant-1', true);
  });
});
