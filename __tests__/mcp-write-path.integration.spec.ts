import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dbExecute, getGitHubCredentialForApprovedAction, readCanonicalGovernanceState, canonicalExecutionAllowed, interceptToolCall } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  getGitHubCredentialForApprovedAction: vi.fn(),
  readCanonicalGovernanceState: vi.fn(),
  canonicalExecutionAllowed: vi.fn(),
  interceptToolCall: vi.fn(),
}));

vi.mock('../lib/db', () => ({ getClient: () => ({ execute: dbExecute }) }));
vi.mock('../lib/agents/credential_broker', () => ({ getGitHubCredentialForApprovedAction }));
vi.mock('../lib/agents/canonical_governance_state', () => ({ readCanonicalGovernanceState, canonicalExecutionAllowed }));
vi.mock('../lib/agents/tool_interceptor', () => ({ interceptToolCall }));

import { createApprovalRequest, decideApprovalRequest } from '../lib/approval_requests';
import { executeGovernedToolStructured } from '../lib/agents/constitutional_tool_executor';
import { patch_file } from '../lib/lex_crs_agent/tools/patch_file';

const session = {
  sessionId: 'owner-write:stable-session', actorId: 'api_key:owner-write',
  C: 0.2, R: 0.4, S: 0.4, M: 0.2, healthBand: 'STRESSED', recoveryState: 'VERIFIED',
  sigmaViol: 0, toolCalls: 3, trajectoryAvailable: true, nStable: 3, velocity: 0.019,
  canaryPassed: true, canaryReceiptId: 'canary-receipt', stateFingerprint: 'fingerprint',
  trajectoryUpdatedAt: '2026-10-20T00:00:00.000Z', authorization: 'approval_required',
  policyRisk: 'write', version: 'test', observedAt: '2026-10-20T00:00:00.000Z',
} as const;

describe('MCP patch_file write path', () => {
  let approval: { request_id: string; owner_id: string; session_id: string; tool_name: string; args_hash: string; status: string; expires_at: number } | null;
  let content = 'const before = true;\n';
  let commitCalls = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    approval = null;
    commitCalls = 0;
    content = 'const before = true;\n';
    readCanonicalGovernanceState.mockResolvedValue({ available: true, state: session });
    canonicalExecutionAllowed.mockReturnValue({ allowed: true });
    interceptToolCall.mockResolvedValue({
      approved: true, decision: 'APPROVED', reason: 'approved', receipt_id: 'receipt',
      crs: { C: 0.2, R: 0.4, S: 0.4, M: 0.2, risk_level: 'LOW' }, health_band: 'STRESSED', sigma_viol: 0,
    });
    getGitHubCredentialForApprovedAction.mockResolvedValue('approved-token');
    dbExecute.mockImplementation(async (query: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof query === 'string' ? query : query.sql;
      const args = typeof query === 'string' ? [] : query.args ?? [];
      if (sql.includes('INSERT INTO approval_requests')) {
        approval = { request_id: String(args[0]), owner_id: String(args[1]), session_id: String(args[2]), tool_name: String(args[3]), args_hash: String(args[4]), status: 'pending', expires_at: Number(args[7]) };
      } else if (sql.startsWith('SELECT request_id, owner_id')) {
        return { rows: approval ? [approval] : [] };
      } else if (sql.includes("UPDATE approval_requests SET status = ?")) {
        if (!approval || approval.status !== 'pending') return { rowsAffected: 0 };
        approval.status = String(args[0]);
        return { rowsAffected: 1 };
      } else if (sql.includes("UPDATE approval_requests SET status = 'used'")) {
        if (!approval || approval.status !== 'approved') return { rowsAffected: 0 };
        approval.status = 'used';
        return { rowsAffected: 1 };
      }
      return { rows: [] };
    });
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        commitCalls += 1;
        content = Buffer.from(String(JSON.parse(String(init.body)).content), 'base64').toString('utf8');
        return new Response(JSON.stringify({ commit: { sha: 'commit-sha' } }), { status: 200 });
      }
      return new Response(JSON.stringify({ content: Buffer.from(content).toString('base64'), sha: 'file-sha' }), { status: 200 });
    }));
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('passes dry-run, requires approval, commits once, and rejects replay or changed arguments', async () => {
    const args = { path: 'README.md', old_str: 'before', new_str: 'after', message: 'approved patch', session_id: session.sessionId };

    const dryRun = await patch_file({ ...args, dry_run: true });
    expect(dryRun).toContain('dry_run — no commit made');
    expect(commitCalls).toBe(0);

    const pending = await createApprovalRequest({ ownerId: 'owner-write', sessionId: session.sessionId, toolName: 'patch_file', args });
    expect(pending.requestId).toBeTruthy();
    expect(commitCalls).toBe(0);
    expect(await decideApprovalRequest({ requestId: pending.requestId, decision: 'approved', decidedBy: 'test-approver' })).toBe(true);

    const execute = (input: Record<string, unknown>) => executeGovernedToolStructured(
      'patch_file', input, (handlerArgs) => patch_file(handlerArgs as Parameters<typeof patch_file>[0]),
      session.sessionId, undefined, session.actorId, undefined, 'owner-write', 'owner-write',
    );
    const first = await execute({ ...args, approval_request_id: pending.requestId });
    expect(first.approved).toBe(true);
    expect(commitCalls).toBe(1);

    const replay = await execute({ ...args, approval_request_id: pending.requestId });
    expect(replay.approved).toBe(false);
    expect(String(replay.result)).toContain('already used');
    expect(commitCalls).toBe(1);

    const changed = await execute({ ...args, new_str: 'different', approval_request_id: pending.requestId });
    expect(changed.approved).toBe(false);
    expect(String(changed.result)).toContain('already used');
    expect(commitCalls).toBe(1);
  });
});
