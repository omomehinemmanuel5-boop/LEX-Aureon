import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  accountFromCookie: vi.fn(),
  authenticateAccount: vi.fn(),
  checkAccountRateLimit: vi.fn(),
  clientRateLimitKey: vi.fn(),
  createAccountSessionCookie: vi.fn(),
  registerAccount: vi.fn(),
  getClientIp: vi.fn(),
  isTrustedSameOriginFormPost: vi.fn(),
  createAuthorizationCodeForAccount: vi.fn(),
  isRegisteredRedirectUri: vi.fn(),
}));

vi.mock('@/lib/mcp_oauth', () => ({
  MCP_ISSUER: 'https://www.lexaureon.com',
  MCP_SCOPE: 'mcp',
  normalizeMcpResource: (value: string | null) => value === 'https://www.lexaureon.com/api/mcp' ? value : null,
  createAuthorizationCodeForAccount: mocks.createAuthorizationCodeForAccount,
  isRegisteredRedirectUri: mocks.isRegisteredRedirectUri,
}));
vi.mock('@/lib/auth_accounts', () => ({
  accountFromCookie: mocks.accountFromCookie,
  authenticateAccount: mocks.authenticateAccount,
  checkAccountRateLimit: mocks.checkAccountRateLimit,
  clientRateLimitKey: mocks.clientRateLimitKey,
  createAccountSessionCookie: mocks.createAccountSessionCookie,
  registerAccount: mocks.registerAccount,
}));
vi.mock('@/lib/rate_limit', () => ({ getClientIp: mocks.getClientIp }));
vi.mock('@/lib/security/approval_origin', () => ({ isTrustedSameOriginFormPost: mocks.isTrustedSameOriginFormPost }));

import { GET, POST } from '@/app/oauth/authorize/route';

const BASE = 'https://www.lexaureon.com/oauth/authorize';
const CHALLENGE = 'a'.repeat(43);
const USER = { id: 'user_12345678', email: 'owner@example.com', name: 'Owner', tenantId: 'tn_user_12345678', plan: 'free' as const };

function params() {
  return new URLSearchParams({
    client_id: 'client_123',
    redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect',
    response_type: 'code',
    scope: 'mcp',
    state: 'state_123',
    resource: 'https://www.lexaureon.com/api/mcp',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
  });
}

function postRequest(fields: URLSearchParams) {
  return new Request(BASE, {
    method: 'POST',
    headers: { origin: 'https://www.lexaureon.com', 'content-type': 'application/x-www-form-urlencoded' },
    body: fields.toString(),
  });
}

describe('ChatGPT OAuth account authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrustedSameOriginFormPost.mockReturnValue(true);
    mocks.isRegisteredRedirectUri.mockResolvedValue(true);
    mocks.accountFromCookie.mockResolvedValue(null);
    mocks.checkAccountRateLimit.mockResolvedValue(true);
    mocks.clientRateLimitKey.mockImplementation((ip: string, suffix: string) => `${ip}:${suffix}`);
    mocks.getClientIp.mockReturnValue('127.0.0.1');
    mocks.createAccountSessionCookie.mockReturnValue('lex_account_session=test; HttpOnly');
    mocks.registerAccount.mockResolvedValue('sent');
  });

  it('shows account sign-in rather than asking for a raw API key', async () => {
    const query = params();
    const response = await GET(new Request(`${BASE}?${query.toString()}`));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('Sign in to connect Lex');
    expect(body).toContain('name="email"');
    expect(body).toContain('name="password"');
    expect(body).not.toContain('name="api_key"');
    expect(body).toContain('client_id');
  });

  it('offers account creation inside the OAuth flow without dropping the request', async () => {
    const query = params();
    const response = await GET(new Request(`${BASE}?${query.toString()}`));
    const body = await response.text();
    expect(body).toContain('New to Lex? Create an account');
    const registerQuery = new URL(`${BASE}?${query.toString()}&mode=register`);
    const registerResponse = await GET(new Request(registerQuery.toString()));
    const registerBody = await registerResponse.text();
    expect(registerBody).toContain('Create your Lex account');
    expect(registerBody).toContain('name="action" value="register"');
    expect(registerBody).toContain('code_challenge');
  });

  it('sends a signed continuation with registration verification and does not authorize early', async () => {
    const form = params();
    form.set('action', 'register');
    form.set('email', 'new-owner@example.com');
    form.set('password', 'correct-horse-battery');
    form.set('company_name', 'New Workspace');
    const response = await POST(postRequest(form));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('resume this ChatGPT connection');
    expect(mocks.registerAccount).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new-owner@example.com',
      companyName: 'New Workspace',
      continuationUrl: expect.stringContaining('/oauth/authorize?'),
    }));
    expect(mocks.createAuthorizationCodeForAccount).not.toHaveBeenCalled();
  });

  it('authenticates the account and resumes the same PKCE request', async () => {
    mocks.authenticateAccount.mockResolvedValue({ user: USER, verified: true });
    const form = params();
    form.set('action', 'login');
    form.set('email', USER.email);
    form.set('password', 'correct-horse-battery');
    const response = await POST(postRequest(form));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/oauth/authorize?');
    expect(response.headers.get('location')).toContain('state=state_123');
    expect(response.headers.get('set-cookie')).toContain('lex_account_session=test');
  });

  it('issues authorization only after explicit consent from a verified account session', async () => {
    mocks.accountFromCookie.mockResolvedValue(USER);
    mocks.createAuthorizationCodeForAccount.mockResolvedValue({ code: 'lex_code_one_time' });
    const form = params();
    form.set('action', 'authorize');
    const response = await POST(postRequest(form));
    expect(mocks.createAuthorizationCodeForAccount).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'client_123',
      redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
      scope: 'mcp',
      resource: 'https://www.lexaureon.com/api/mcp',
      codeChallenge: CHALLENGE,
    }));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('code=lex_code_one_time');
    expect(response.headers.get('location')).toContain('state=state_123');
  });

  it('does not issue a code when the account session is missing', async () => {
    mocks.createAuthorizationCodeForAccount.mockResolvedValue({ error: 'account_required' });
    const form = params();
    form.set('action', 'authorize');
    const response = await POST(postRequest(form));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toContain('/oauth/authorize?');
  });
});
