import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getApprovalRequestForLink, decideApprovalRequestByLink, readCanonicalGovernanceState, checkRateLimit, getClientIp } = vi.hoisted(() => ({
  getApprovalRequestForLink: vi.fn(),
  decideApprovalRequestByLink: vi.fn(),
  readCanonicalGovernanceState: vi.fn(),
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => '192.0.2.20'),
}));
vi.mock('../lib/approval_link', () => ({ getApprovalRequestForLink, decideApprovalRequestByLink }));
vi.mock('../lib/agents/canonical_governance_state', () => ({ readCanonicalGovernanceState }));
vi.mock('../lib/rate_limit', () => ({ checkRateLimit, getClientIp }));

import { GET } from '../app/approvals/link/route';
import { POST } from '../app/approvals/link/[requestId]/[decision]/route';

const origin = 'https://www.lexaureon.com';
const id = 'a'.repeat(22);

describe('direct tenant-scoped approval link routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApprovalRequestForLink.mockResolvedValue({
      request_id: id,
      owner_id: 'owner-a',
      tenant_id: 'tenant-a',
      session_id: 'owner-a:session-1',
      tool_name: 'write_file',
      args_json: JSON.stringify({ path: 'README.md', api_key: 'secret-value' }),
      status: 'pending',
      created_at: 1_800_000_000_000,
      expires_at: Date.now() + 600_000,
    });
    readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: { recoveryState: 'NORMAL', M: 0.31, nStable: 3, canaryPassed: true },
    });
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29, retryAfter: 0 });
    decideApprovalRequestByLink.mockResolvedValue(true);
  });

  it('renders the exact tenant-bound action without asking for email or password', async () => {
    const response = await GET(new Request(`${origin}/approvals/link?id=${id}`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(getApprovalRequestForLink).toHaveBeenCalledWith(id);
    expect(html).toContain('Approve this exact action');
    expect(html).toContain('write_file');
    expect(html).toContain('README.md');
    expect(html).toContain('[REDACTED]');
    expect(html).not.toContain('secret-value');
    expect(html).not.toContain('Account email');
    expect(html).not.toContain('name="password"');
    expect(html).toContain('Anyone who has the link');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('does not offer a decision for an expired or previously decided request', async () => {
    getApprovalRequestForLink.mockResolvedValueOnce({
      request_id: id, owner_id: 'owner-a', tenant_id: 'tenant-a',
      session_id: 'owner-a:session-1', tool_name: 'write_file', args_json: '{}',
      status: 'expired', created_at: 1, expires_at: 2,
    });
    const html = await (await GET(new Request(`${origin}/approvals/link?id=${id}`))).text();
    expect(html).toContain('expired');
    expect(html).not.toContain('Approve this exact action');
  });

  it('records a decision without requiring an account cookie', async () => {
    const response = await POST(new Request(`${origin}/approvals/link/${id}/approved`, {
      method: 'POST',
      headers: { origin },
    }), { params: Promise.resolve({ requestId: id, decision: 'approved' }) });
    expect(response.status).toBe(200);
    expect(decideApprovalRequestByLink).toHaveBeenCalledWith({ requestId: id, decision: 'approved' });
    expect(checkRateLimit).toHaveBeenCalledWith('approval-link-decision:192.0.2.20', 30, 60);
  });

  it('rejects cross-origin decisions before touching the approval', async () => {
    const response = await POST(new Request(`${origin}/approvals/link/${id}/approved`, {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    }), { params: Promise.resolve({ requestId: id, decision: 'approved' }) });
    expect(response.status).toBe(403);
    expect(decideApprovalRequestByLink).not.toHaveBeenCalled();
  });
});
