import { beforeEach, describe, expect, it, vi } from 'vitest';

const { values, sessionCookie, checkRateLimit, getClientIp, listApprovalRequests, decideApprovalRequest, readCanonicalGovernanceState } = vi.hoisted(() => ({
  values: { secret: 'test-only-placeholder', site: 'https://www.lexaureon.com', cookie: '' },
  sessionCookie: vi.fn(() => ''),
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => '192.0.2.10'),
  listApprovalRequests: vi.fn(),
  decideApprovalRequest: vi.fn(),
  readCanonicalGovernanceState: vi.fn(),
}));
vi.mock('../lib/env', () => ({ env: {
  get MCP_OPERATOR_SECRET() { return values.secret || undefined; },
  get NEXT_PUBLIC_SITE_URL() { return values.site; },
} }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ cookie: values.cookie }) }));
vi.mock('../lib/rate_limit', () => ({ checkRateLimit, getClientIp }));
vi.mock('../lib/approval_requests', () => ({ listApprovalRequests, decideApprovalRequest }));
vi.mock('../lib/agents/canonical_governance_state', () => ({ readCanonicalGovernanceState }));

import { GET as approvalsGet, POST as signInPost } from '../app/approvals/route';
import { createOperatorSessionCookie, hasOperatorSession } from '../app/approvals/route';
import { POST as decisionPost } from '../app/approvals/[requestId]/[decision]/route';

const ownOrigin = 'https://www.lexaureon.com';
function loginRequest(secret: string, origin = ownOrigin) {
  const body = new FormData();
  body.set('secret', secret);
  return new Request(`${ownOrigin}/approvals`, {
    method: 'POST', headers: { origin }, body,
  });
}

describe('operator approval page and POST boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    values.secret = 'test-only-placeholder';
    values.site = ownOrigin;
    values.cookie = '';
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 4, retryAfter: 0 });
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

  it('disables the page and decision endpoint when no operator secret is configured', async () => {
    values.secret = '';
    expect((await approvalsGet()).status).toBe(404);
    const denied = await decisionPost(new Request(`${ownOrigin}/approvals/${'b'.repeat(22)}/approved`, {
      method: 'POST', headers: { origin: ownOrigin },
    }), { params: Promise.resolve({ requestId: 'b'.repeat(22), decision: 'approved' }) });
    expect(denied.status).toBe(404);
    expect(decideApprovalRequest).not.toHaveBeenCalled();
  });

  it('serves a server-rendered pending list only to a valid signed operator session and redacts secrets', async () => {
    const cookie = createOperatorSessionCookie(values.secret, 1_800_000_000_000).split(';')[0];
    values.cookie = cookie;
    const response = await approvalsGet();
    const html = await response.text();
    expect(response.status).toBe(200);
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
    expect(html).toContain('[REDACTED]');
    expect(html).not.toContain('must-not-render');
    expect(html).not.toContain(values.secret);
    expect((await approvalsGet()).headers.get('cache-control')).toContain('no-store');
  });

  it('issues an eight-hour HttpOnly, Secure, SameSite=Strict signed cookie without storing the secret in it', async () => {
    const response = await signInPost(loginRequest(values.secret));
    expect(response.status).toBe(303);
    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Max-Age=28800');
    expect(cookie).not.toContain(values.secret);
    expect(hasOperatorSession(cookie, values.secret)).toBe(true);
    expect(hasOperatorSession(cookie, values.secret, Date.now() + 8 * 60 * 60 * 1000 + 1)).toBe(false);
  });

  it('rejects sign-in from an origin other than the configured site', async () => {
    const response = await signInPost(loginRequest(values.secret, 'https://attacker.example'));
    expect(response.status).toBe(403);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('accepts only the official apex/www aliases for login and approval decisions', async () => {
    const apexOrigin = 'https://lexaureon.com';
    const login = await signInPost(loginRequest(values.secret, apexOrigin));
    expect(login.status).toBe(303);

    const requestId = 'e'.repeat(22);
    const cookie = createOperatorSessionCookie(values.secret).split(';')[0];
    const approved = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/approved`, {
      method: 'POST', headers: { origin: apexOrigin, cookie },
    }), { params: Promise.resolve({ requestId, decision: 'approved' }) });
    expect(approved.status).toBe(200);
    expect(decideApprovalRequest).toHaveBeenCalledWith({ requestId, decision: 'approved', decidedBy: 'operator' });

    const missingOrigin = await signInPost(loginRequest(values.secret, ''));
    expect(missingOrigin.status).toBe(403);
    const attackerOrigin = await signInPost(loginRequest(values.secret, 'https://attacker.example'));
    expect(attackerOrigin.status).toBe(403);
  });

  it('rate-limits failed sign-ins by IP and hour', async () => {
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 0, retryAfter: 0 });
    for (let i = 0; i < 5; i += 1) {
      expect((await signInPost(loginRequest('wrong-placeholder'))).status).toBe(401);
    }
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 3600 });
    expect((await signInPost(loginRequest('wrong-placeholder'))).status).toBe(429);
    expect(checkRateLimit).toHaveBeenCalledWith('approval-login:192.0.2.10', 5, 3600);
  });

  it('requires the signed session and same-origin POST before allowing or denying a pending request', async () => {
    const requestId = 'c'.repeat(22);
    const unauthenticated = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/approved`, {
      method: 'POST', headers: { origin: ownOrigin },
    }), { params: Promise.resolve({ requestId, decision: 'approved' }) });
    expect(unauthenticated.status).toBe(401);

    const cookie = createOperatorSessionCookie(values.secret).split(';')[0];
    const foreignOrigin = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/denied`, {
      method: 'POST', headers: { origin: 'https://attacker.example', cookie },
    }), { params: Promise.resolve({ requestId, decision: 'denied' }) });
    expect(foreignOrigin.status).toBe(403);
    expect(decideApprovalRequest).not.toHaveBeenCalled();

    const approved = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/approved`, {
      method: 'POST', headers: { origin: ownOrigin, cookie },
    }), { params: Promise.resolve({ requestId, decision: 'approved' }) });
    expect(approved.status).toBe(200);
    const approvalResult = await approved.text();
    expect(approvalResult).toContain('Decision recorded');
    expect(approvalResult).toContain('This does not execute the action');
    expect(approvalResult).toContain('Return to approvals');
    expect(decideApprovalRequest).toHaveBeenCalledWith({ requestId, decision: 'approved', decidedBy: 'operator' });

    const denied = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/denied`, {
      method: 'POST', headers: { origin: ownOrigin, cookie },
    }), { params: Promise.resolve({ requestId, decision: 'denied' }) });
    expect(denied.status).toBe(200);
    expect(await denied.text()).toContain('Denial recorded');
  });

  it('rejects attempts to alter a request more than once or use an invalid decision', async () => {
    const requestId = 'd'.repeat(22);
    const cookie = createOperatorSessionCookie(values.secret).split(';')[0];
    decideApprovalRequest.mockResolvedValue(false);
    const replay = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/approved`, {
      method: 'POST', headers: { origin: ownOrigin, cookie },
    }), { params: Promise.resolve({ requestId, decision: 'approved' }) });
    expect(replay.status).toBe(409);
    const invalid = await decisionPost(new Request(`${ownOrigin}/approvals/${requestId}/pending`, {
      method: 'POST', headers: { origin: ownOrigin, cookie },
    }), { params: Promise.resolve({ requestId, decision: 'pending' }) });
    expect(invalid.status).toBe(400);
  });
});
