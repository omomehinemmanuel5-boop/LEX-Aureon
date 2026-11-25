import { beforeEach, describe, expect, it, vi } from 'vitest';

const { checkRateLimit, getClientIp, getApprovalRequestForLink, decideApprovalRequestByLink } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => '192.0.2.20'),
  getApprovalRequestForLink: vi.fn(),
  decideApprovalRequestByLink: vi.fn(),
}));
vi.mock('../lib/rate_limit', () => ({ checkRateLimit, getClientIp }));
vi.mock('../lib/approval_link', () => ({ getApprovalRequestForLink, decideApprovalRequestByLink }));

import { GET } from '../app/approvals/link/route';
import { POST } from '../app/approvals/link/[requestId]/[decision]/route';

const origin = 'https://www.lexaureon.com';
const id = 'a'.repeat(22);

describe('public request-capability approval routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, retryAfter: 0 });
    getApprovalRequestForLink.mockResolvedValue({ request_id: id, tenant_id: 'tenant-a' });
    decideApprovalRequestByLink.mockResolvedValue(true);
  });

  it('validates the capability and redirects to the exact public request page', async () => {
    const response = await GET(new Request(`${origin}/approvals/link?id=${id}`));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${origin}/approvals?id=${id}`);
    expect(getApprovalRequestForLink).toHaveBeenCalledWith(id);
  });

  it('rejects malformed and unavailable links', async () => {
    expect((await GET(new Request(`${origin}/approvals/link?id=bad`))).status).toBe(400);
    getApprovalRequestForLink.mockResolvedValueOnce(null);
    expect((await GET(new Request(`${origin}/approvals/link?id=${id}`))).status).toBe(404);
  });

  it('records a decision without an account cookie when the private capability is valid', async () => {
    const response = await POST(new Request(`${origin}/approvals/link/${id}/approved`, {
      method: 'POST', headers: { origin },
    }), { params: Promise.resolve({ requestId: id, decision: 'approved' }) });
    expect(response.status).toBe(200);
    expect(decideApprovalRequestByLink).toHaveBeenCalledWith({ requestId: id, decision: 'approved' });
    expect(checkRateLimit).toHaveBeenCalledWith('approval-capability-decision:192.0.2.20', 30, 60);
    expect(await response.text()).toContain('This does not execute the action');
  });

  it('supports denial without account authentication', async () => {
    const response = await POST(new Request(`${origin}/approvals/link/${id}/denied`, {
      method: 'POST', headers: { origin },
    }), { params: Promise.resolve({ requestId: id, decision: 'denied' }) });
    expect(response.status).toBe(200);
    expect(decideApprovalRequestByLink).toHaveBeenCalledWith({ requestId: id, decision: 'denied' });
  });

  it('rejects cross-origin decisions before touching the approval store', async () => {
    const response = await POST(new Request(`${origin}/approvals/link/${id}/approved`, {
      method: 'POST', headers: { origin: 'https://attacker.example' },
    }), { params: Promise.resolve({ requestId: id, decision: 'approved' }) });
    expect(response.status).toBe(403);
    expect(decideApprovalRequestByLink).not.toHaveBeenCalled();
  });

  it('returns an explicit conflict when the one-time conditional update changes zero rows', async () => {
    decideApprovalRequestByLink.mockResolvedValueOnce(false);
    const response = await POST(new Request(`${origin}/approvals/link/${id}/approved`, {
      method: 'POST', headers: { origin },
    }), { params: Promise.resolve({ requestId: id, decision: 'approved' }) });
    expect(response.status).toBe(409);
    expect(await response.text()).toContain('No decision was recorded');
  });

  it('rejects invalid decisions and rate-limits repeated attempts', async () => {
    const invalid = await POST(new Request(`${origin}/approvals/link/${id}/pending`, {
      method: 'POST', headers: { origin },
    }), { params: Promise.resolve({ requestId: id, decision: 'pending' }) });
    expect(invalid.status).toBe(400);
    checkRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 60 });
    const limited = await POST(new Request(`${origin}/approvals/link/${id}/approved`, {
      method: 'POST', headers: { origin },
    }), { params: Promise.resolve({ requestId: id, decision: 'approved' }) });
    expect(limited.status).toBe(429);
  });
});
