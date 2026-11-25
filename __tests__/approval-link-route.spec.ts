import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkRateLimit, getClientIp, accountFromCookie, decideApprovalRequest } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => '192.0.2.20'),
  accountFromCookie: vi.fn(),
  decideApprovalRequest: vi.fn(),
}));
vi.mock('../lib/rate_limit', () => ({ checkRateLimit, getClientIp }));
vi.mock('../lib/auth_accounts', () => ({ accountFromCookie }));
vi.mock('../lib/approval_requests', () => ({ decideApprovalRequest }));

import { GET } from '../app/approvals/link/route';
import { POST } from '../app/approvals/link/[requestId]/[decision]/route';

const origin = 'https://www.lexaureon.com';
const id = 'a'.repeat(22);
const cookie = 'lex_account_session=verified-session';

describe('tenant-authenticated approval link routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, retryAfter: 0 });
    accountFromCookie.mockResolvedValue({ id: 'approver-a', tenantId: 'tenant-a' });
    decideApprovalRequest.mockResolvedValue(true);
  });

  it('redirects a valid approval URL to the authenticated tenant inbox', async () => {
    const response = await GET(new Request(`${origin}/approvals/link?id=${id}`));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${origin}/approvals#${id}`);
  });

  it('rejects malformed approval links', async () => {
    const response = await GET(new Request(`${origin}/approvals/link?id=bad`));
    expect(response.status).toBe(400);
  });

  it('requires a verified approver session before recording a decision', async () => {
    accountFromCookie.mockResolvedValueOnce(null);
    const response = await POST(new Request(`${origin}/approvals/link/${id}/approved`, {
      method: 'POST', headers: { origin },
    }), { params: Promise.resolve({ requestId: id, decision: 'approved' }) });
    expect(response.status).toBe(401);
    expect(decideApprovalRequest).not.toHaveBeenCalled();
  });

  it('binds the decision to the signed-in approver tenant and identity', async () => {
    const response = await POST(new Request(`${origin}/approvals/link/${id}/approved`, {
      method: 'POST', headers: { origin, cookie },
    }), { params: Promise.resolve({ requestId: id, decision: 'approved' }) });
    expect(response.status).toBe(200);
    expect(decideApprovalRequest).toHaveBeenCalledWith({
      requestId: id, tenantId: 'tenant-a', decision: 'approved', decidedBy: 'user:approver-a',
    });
    expect(checkRateLimit).toHaveBeenCalledWith('approval-owner-decision:192.0.2.20', 30, 60);
  });

  it('shows a clear conflict instead of success when the tenant-scoped update changes zero rows', async () => {
    decideApprovalRequest.mockResolvedValueOnce(false);
    const response = await POST(new Request(`${origin}/approvals/link/${id}/approved`, {
      method: 'POST', headers: { origin, cookie },
    }), { params: Promise.resolve({ requestId: id, decision: 'approved' }) });
    expect(response.status).toBe(409);
    const html = await response.text();
    expect(html).toContain('No decision was recorded');
    expect(html).toContain('different tenant');
    expect(html).toContain('Approval not completed');
  });

  it('rejects cross-origin decisions before authentication or database mutation', async () => {
    const response = await POST(new Request(`${origin}/approvals/link/${id}/approved`, {
      method: 'POST', headers: { origin: 'https://attacker.example', cookie },
    }), { params: Promise.resolve({ requestId: id, decision: 'approved' }) });
    expect(response.status).toBe(403);
    expect(accountFromCookie).not.toHaveBeenCalled();
    expect(decideApprovalRequest).not.toHaveBeenCalled();
  });
});
