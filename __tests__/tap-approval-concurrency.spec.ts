import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, readCanonicalGovernanceState, canonicalExecutionAllowed, interceptToolCall } = vi.hoisted(() => ({
  execute: vi.fn(),
  readCanonicalGovernanceState: vi.fn(),
  canonicalExecutionAllowed: vi.fn(),
  interceptToolCall: vi.fn(),
}));
vi.mock('../lib/db', () => ({ getClient: () => ({ execute }) }));
vi.mock('../lib/agents/canonical_governance_state', () => ({ readCanonicalGovernanceState, canonicalExecutionAllowed }));
vi.mock('../lib/agents/tool_interceptor', () => ({ interceptToolCall }));

import { createApprovalRequest, decideApprovalRequest } from '../lib/approval_requests';
import { executeGovernedToolStructured } from '../lib/agents/constitutional_tool_executor';

let row: Record<string, unknown> | null;
const state = {
  sessionId: 'owner-a:s1', actorId: 'api_key:owner-a', C: 1, R: 1, S: 1, M: 1,
  healthBand: 'OPTIMAL', recoveryState: 'NORMAL', sigmaViol: 0, toolCalls: 1,
  trajectoryAvailable: true, nStable: 3, canaryPassed: true, canaryReceiptId: 'canary',
  stateFingerprint: 'fingerprint', trajectoryUpdatedAt: '2026-10-11T00:00:00Z',
  authorization: 'approval_required', policyRisk: 'write', version: 'test', observedAt: '2026-10-11T00:00:00Z',
} as const;

function installDb() {
  execute.mockImplementation(async (query: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof query === 'string' ? query : query.sql;
    const args = typeof query === 'string' ? [] : query.args ?? [];
    if (sql.startsWith('INSERT INTO approval_requests')) {
      row = {
        request_id: args[0], owner_id: args[1], session_id: args[2], tool_name: args[3], args_hash: args[4],
        args_json: args[5], status: 'pending', created_at: args[6], expires_at: args[7],
      };
      return { rowsAffected: 1, rows: [] };
    }
    if (sql.startsWith('UPDATE approval_requests SET status = ?, decided_at = ?, decided_by = ?')) {
      const current = row;
      if (current && current.request_id === args[3] && current.status === 'pending' && Number(current.expires_at) > Number(args[4])) {
        current.status = args[0];
        current.decided_at = args[1];
        current.decided_by = args[2];
        return { rowsAffected: 1, rows: [] };
      }
      return { rowsAffected: 0, rows: [] };
    }
    if (sql.includes('FROM approval_requests WHERE request_id = ?')) {
      return { rows: row?.request_id === args[0] ? [{ ...row }] : [] };
    }
    if (sql.startsWith("UPDATE approval_requests SET status = 'used'")) {
      const current = row;
      if (current && current.request_id === args[0] && current.owner_id === args[1] && current.session_id === args[2]
        && current.tool_name === args[3] && current.args_hash === args[4] && current.status === 'approved'
        && Number(current.expires_at) > Number(args[5])) {
        current.status = 'used';
        return { rowsAffected: 1, rows: [] };
      }
      return { rowsAffected: 0, rows: [] };
    }
    return { rowsAffected: 0, rows: [] };
  });
}

describe('concurrent one-tap executor use', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    row = null;
    installDb();
    readCanonicalGovernanceState.mockResolvedValue({ available: true, state });
    canonicalExecutionAllowed.mockReturnValue({ allowed: true });
    interceptToolCall.mockResolvedValue({
      approved: true, decision: 'APPROVED', reason: 'safe', receipt_id: 'receipt',
      crs: { C: 1, R: 1, S: 1, M: 1, risk_level: 'LOW' }, health_band: 'OPTIMAL', sigma_viol: 0,
    });
  });

  it('permits only one of two concurrent executions to run the side effect', async () => {
    const sessionId = state.sessionId;
    const actionArgs = { path: 'README.md', content: 'one exact edit', message: 'test', session_id: sessionId };
    const request = await createApprovalRequest({
      ownerId: 'owner-a', sessionId, toolName: 'write_file', args: actionArgs,
    });
    expect(await decideApprovalRequest({ requestId: request.requestId, decision: 'approved', decidedBy: 'operator' })).toBe(true);
    const handler = vi.fn(async () => 'SIDE_EFFECT_COMPLETE');
    const callArgs = { ...actionArgs, approval_request_id: request.requestId };
    const run = () => executeGovernedToolStructured(
      'write_file', callArgs, handler, sessionId, undefined, 'api_key:owner-a', undefined, 'owner-a', 'owner-a',
    );

    const outcomes = await Promise.all([run(), run()]);
    expect(outcomes.filter(outcome => outcome.approved)).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(row?.status).toBe('used');
  });
});
