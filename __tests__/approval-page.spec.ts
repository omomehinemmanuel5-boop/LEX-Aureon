import { beforeEach, describe, expect, it, vi } from 'vitest';

const { values, checkRateLimit, getClientIp, listApprovalRequests, decideApprovalRequest, readCanonicalGovernanceState, authenticateApprovalOwner, approvalOwnerFromCookie, createApprovalOwnerCookie } = vi.hoisted(() => ({
  values: { ownerId: 'owner-a', cookie: '', apiKey: 'lex_sk_owner_api_key_placeholder' },
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => '192.0.2.10'),
  listApprovalRequests: vi.fn(),
  decideApprovalRequest: vi.fn(),
  readCanonicalGovernanceState: vi.fn(),
  authenticateApprovalOwner: vi.fn(),
  approvalOwnerFromCookie: vi.fn(),
  createApprovalOwnerCookie: vi.fn(),
}));
vi.mock('../lib/rate_limit', () => ({ checkRateLimit, getClientIp }));
vi.mock('../lib/approval_requests', () => ({ listApprovalRequests, decideApprovalRequest }));
vi.mock('../lib/agents/canonical_governance_state', () => ({ readCanonicalGovernanceState }));
vi.mock('../lib/approval_owner_auth', () => ({ authenticateApprovalOwner, approvalOwnerFromCookie, createApprovalOwnerCookie }));

import { GET as approvalsGet, POST as signInPost } from '../app/approvals/route';
import { POST as decisionPost } from '../app/approvals/[requestId]/[decision]/route';

const ownOrigin = 'https://www.lexaureon.com';
function loginRequest(apiKey: string, origin = ownOrigin, next?: string) {
  const body = new FormData();
  body.set('api_key', apiKey);
  if (next !== undefined) body.set('next', next);
  return new Request(`${ownOrigin}/approvals`, { method: 'POST', headers: { origin }, body });
}

function ownerCookie(ownerId = values.ownerId) {
  return `lex_approval_owner=${ownerId}.1800000900000.signature`;
}

describe('owner-scoped approval page and POST boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    values.ownerId = 'owner-a';
    values.cookie = '';
    values.apiKey = 'lex_sk_owner_api_key_placeholder';
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 9, retryAfter: 0 });
    authenticateApprovalOwner.mockImplementation(async (key: string) => key === values.apiKey
      ? { ownerId: values.ownerId, signingKey: 'hash-placeholder' }
      : null);
    createApprovalOwnerCookie.mockReturnValue('lex_approval_owner=signed-owner-session; Path=/approvals; HttpOnly; Secure; SameSite=Strict');
    approvalOwnerFromCookie.mockImplementation(async (cookie: string | null) => cookie?.includes('signed-owner-session') || cookie?.includes('signature') ? values.ownerId : null);
    listApprovalRequests.mockResolvedValue([{
      request_id: 'a'.repeat(22), owner_id: 'owner-a', session_id: 'owner-a:s1',
      tool_name: 'write_file', args_json: '{"path":"README.md","api_key":"must-not-render"}',
      status: 'pending', created_at: 1_800_000_000_000, expires_at: 1_800_000_900_000,
      decided_at: null, decided_by: null,
    }]);
    readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: { recoveryState: 'RESTORING', M: 0.31, nStable: 27, canaryPassed: false },
    });
    decideApprovalRequest.mockResolvedValue(true);
  });

  it('requires an authenticated owner session before showing the request list', async () => {
    const unauthenticated = await approvalsGet(new Request(`${ownOrigin}/approvals`));
    expect(unauthenticated.status).toBe(200);
    expect(await unauthenticated.text()).toContain('Owner API key');
    expect(listApprovalRequests).not.toHaveBeenCalled();

    const response = await approvalsGet(new Request(`${ownOrigin}/approvals`, { headers: { cookie: ownerCookie() } }));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(listApprovalRequests).toHaveBeenCalledWith('owner-a');
    expect(html).toContain('write_file');
    expect(html).toContain('Approve this exact action');
    expect(html).toContain('approval_request_id');
    expect(html).toContain('@media(max-width:520px)');
    expect(html).toContain('Approval history');
    expect(html).toContain('Current recovery gate snapshot');
    expect(html).toContain('RESTORING');
    expect(html).toContain('0.310');
    expect(html).toContain('n_stable');
    expect(html).toContain('canary_passed');
    expect(html).toContain('id="aaaaaaaaaaaaaaaaaaaaaa"');
    expect(html).toContain('.request:target');
    expect(html).toContain('scroll-margin-top');
    expect(html).toContain('[REDACTED]');
    expect(html).not.toContain('must-not-render');
    expect((await approvalsGet(new Request(`${ownOrigin}/approvals`, { headers: { cookie: ownerCookie() } }))).headers.get('cache-control')).toContain('no-store');
  });

  it('authenticates using the request-owner API key without returning or storing it in the session cookie', async () => {
    const response = await signInPost(loginRequest(values.apiKey));
    expect(response.status).toBe(303);
    expect(authenticateApprovalOwner).toHaveBeenCalledWith(values.apiKey);
    expect(createApprovalOwnerCookie).toHaveBeenCalledWith({ ownerId: 'owner-a', signingKey: 'hash-placeholder' });
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain(values.apiKey);
  });

  it('preserves an approval fragment through sign-in and rejects malicious return targets', async () => {
    const requestId = 'a'.repeat(22);
    const page = await approvalsGet(new Request(`${ownOrigin}/approvals#${requestId}`));
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain('window.location.hash');
    expect(html).toContain('name="next"');
    const valid = await signInPost(loginRequest(values.apiKey, ownOrigin, `/approvals#${requestId}`));
    expect(valid.status).toBe(303);
    expect(valid.headers.get('location')).toBe(`/approvals#${requestId}`);
    const malicious = await signInPost(loginRequest(values.apiKey, ownOrigin, '//attacker.example'));
    expect(malicious.status).toBe(400);
    expect(malicious.headers.get('location')).toBeNull();
  });

  it('escapes patch_file old/new text and keeps raw JSON collapsed', async () => {
    listApprovalRequests.mockResolvedValue([{
      request_id: 'patch_123-safe', owner_id: 'owner-a', session_id: 'owner-a:s1',
      tool_name: 'patch_file',
      args_json: JSON.stringify({ path: 'src/example.ts', old_str: '<script>alert("x")</script>', new_str: 'const safe = "&";' }),
      status: 'pending', created_at: 1_800_000_000_000, expires_at: 1_800_000_900_000,
      decided_at: null, decided_by: null,
    }]);
    const html = await (await approvalsGet(new Request(`${ownOrigin}/approvals`, { headers: { cookie: ownerCookie() } }))).text();
    expect(html).toContain('Old text');
    expect(html).toContain('New text');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('<details><summary>Raw JSON</summary>');
    expect(html).not.toContain('<script>alert("x")</script>');
  });

  it('escapes request IDs used as article anchors', async () => {
    listApprovalRequests.mockResolvedValue([{
      request_id: 'bad"><script>', owner_id: 'owner-a', session_id: 'owner-a:s1',
      tool_name: 'write_file', args_json: '{"path":"README.md"}',
      status: 'pending', created_at: 1_800_000_000_000, expires_at: 1_800_000_900_000,
      decided_at: null, decided_by: null,
    }]);
    const html = await (await approvalsGet(new Request(`${ownOrigin}/approvals`, { headers: { cookie: ownerCookie() } }))).text();
    expect(html).toContain('id="bad&quot;&gt;&lt;script&gt;"');
    expect(html).not.toContain('<article id="bad"><script>');
  });

  it('rejects sign-in from an origin other than the configured site', async () => {
    const response = await signInPost(loginRequest(values.apiKey, 'https://attacker.example'));
    expect(response.status).toBe(403);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('accepts only the official apex/www aliases for login and approval decisions', async () => {
    const apexOrigin = 'https://lexaureon.com';
    const login = await signInPost(loginRequest(values.apiKey, apexOrigin));
    expect(login.status).toBe(303);
    const requestId = 'e'.repeat(22);
    const approved = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/approved`, {
      method: 'POST', headers: { origin: apexOrigin, cookie: ownerCookie() },
    }), { params: Promise.resolve({ requestId, decision: 'approved' }) });
    expect(approved.status).toBe(200);
    expect(decideApprovalRequest).toHaveBeenCalledWith({ requestId, ownerId: 'owner-a', decision: 'approved', decidedBy: 'owner:owner-a' });
    expect((await signInPost(loginRequest(values.apiKey, ''))).status).toBe(403);
  });

  it('rate-limits owner sign-in attempts and rejects invalid keys', async () => {
    authenticateApprovalOwner.mockResolvedValue(null);
    expect((await signInPost(loginRequest('wrong-placeholder'))).status).toBe(401);
    expect(checkRateLimit).toHaveBeenCalledWith('approval-owner-login:192.0.2.10', 10, 3600);
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 3600 });
    expect((await signInPost(loginRequest('wrong-placeholder'))).status).toBe(429);
  });

  it('requires the owner session and same-origin POST before allowing or denying a request', async () => {
    const requestId = 'c'.repeat(22);
    const unauthenticated = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/approved`, {
      method: 'POST', headers: { origin: ownOrigin },
    }), { params: Promise.resolve({ requestId, decision: 'approved' }) });
    expect(unauthenticated.status).toBe(401);

    const foreignOrigin = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/denied`, {
      method: 'POST', headers: { origin: 'https://attacker.example', cookie: ownerCookie() },
    }), { params: Promise.resolve({ requestId, decision: 'denied' }) });
    expect(foreignOrigin.status).toBe(403);
    expect(decideApprovalRequest).not.toHaveBeenCalled();

    const approved = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/approved`, {
      method: 'POST', headers: { origin: ownOrigin, cookie: ownerCookie() },
    }), { params: Promise.resolve({ requestId, decision: 'approved' }) });
    expect(approved.status).toBe(200);
    const approvalResult = await approved.text();
    expect(approvalResult).toContain('Decision recorded');
    expect(approvalResult).toContain('This does not execute the action');
    expect(approvalResult).toContain('Return to your approvals');
    expect(decideApprovalRequest).toHaveBeenCalledWith({ requestId, ownerId: 'owner-a', decision: 'approved', decidedBy: 'owner:owner-a' });

    const denied = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/denied`, {
      method: 'POST', headers: { origin: ownOrigin, cookie: ownerCookie() },
    }), { params: Promise.resolve({ requestId, decision: 'denied' }) });
    expect(denied.status).toBe(200);
    expect(await denied.text()).toContain('Denial recorded');
  });

  it('rejects attempts to alter a request more than once or use an invalid decision', async () => {
    const requestId = 'd'.repeat(22);
    decideApprovalRequest.mockResolvedValue(false);
    const replay = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/approved`, {
      method: 'POST', headers: { origin: ownOrigin, cookie: ownerCookie() },
    }), { params: Promise.resolve({ requestId, decision: 'approved' }) });
    expect(replay.status).toBe(409);
    const invalid = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/pending`, {
      method: 'POST', headers: { origin: ownOrigin, cookie: ownerCookie() },
    }), { params: Promise.resolve({ requestId, decision: 'pending' }) });
    expect(invalid.status).toBe(400);
  });
});
