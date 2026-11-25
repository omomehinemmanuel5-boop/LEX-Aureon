import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getApprovalRequestForLink, readCanonicalGovernanceState } = vi.hoisted(() => ({
  getApprovalRequestForLink: vi.fn(),
  readCanonicalGovernanceState: vi.fn(),
}));
vi.mock('../lib/approval_link', () => ({ getApprovalRequestForLink }));
vi.mock('../lib/agents/canonical_governance_state', () => ({ readCanonicalGovernanceState }));

import { GET } from '../app/approvals/route';

const origin = 'https://www.lexaureon.com';
const id = 'a'.repeat(22);

describe('public request-scoped approval inbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getApprovalRequestForLink.mockResolvedValue({
      request_id: id, owner_id: 'owner-a', tenant_id: 'tenant-a',
      session_id: 'owner-a:s1', tool_name: 'write_file',
      args_json: JSON.stringify({ path: 'README.md', api_key: 'must-not-render' }),
      status: 'pending', created_at: 1_800_000_000_000, expires_at: Date.now() + 60_000,
    });
    readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: { recoveryState: 'NORMAL', M: 0.31, nStable: 27, canaryPassed: true },
    });
  });

  it('does not require sign-in and does not expose tenant-wide history at the inbox root', async () => {
    const response = await GET(new Request(`${origin}/approvals`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('Open the private approval link');
    expect(html).not.toContain('Account email');
    expect(html).not.toContain('Password');
    expect(getApprovalRequestForLink).not.toHaveBeenCalled();
  });

  it('renders only the exact tenant-bound request addressed by the private capability link', async () => {
    const response = await GET(new Request(`${origin}/approvals?id=${id}`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(getApprovalRequestForLink).toHaveBeenCalledWith(id);
    expect(html).toContain('write_file');
    expect(html).toContain('Approve this exact action');
    expect(html).toContain(`/approvals/link/${id}/approved`);
    expect(html).toContain(`/approvals/link/${id}/denied`);
    expect(html).toContain('NORMAL');
    expect(html).toContain('[REDACTED]');
    expect(html).not.toContain('must-not-render');
    expect(html).toContain('Anyone who possesses it');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('rejects malformed request identifiers before storage lookup', async () => {
    const response = await GET(new Request(`${origin}/approvals?id=bad`));
    expect(response.status).toBe(400);
    expect(getApprovalRequestForLink).not.toHaveBeenCalled();
  });

  it('does not show decision buttons for expired or already decided requests', async () => {
    getApprovalRequestForLink.mockResolvedValueOnce({
      request_id: id, owner_id: 'owner-a', tenant_id: 'tenant-a',
      session_id: 'owner-a:s1', tool_name: 'write_file', args_json: '{}',
      status: 'expired', created_at: 1, expires_at: 2,
    });
    const html = await (await GET(new Request(`${origin}/approvals?id=${id}`))).text();
    expect(html).toContain('This request is');
    expect(html).not.toContain('Approve this exact action');
  });
});
