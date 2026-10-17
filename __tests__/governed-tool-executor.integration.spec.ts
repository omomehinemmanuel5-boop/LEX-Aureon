import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGovernanceApprovalToken } from '../lib/agents/tool_governance_gateway';
import { approvalArgsHash } from '../lib/approval_requests';
import { recoverySnapshotFingerprint } from '../lib/agents/recovery_canary_evidence';
import { readCanonicalGovernanceState } from '../lib/agents/canonical_governance_state';

const { interceptToolCall, dbExecute } = vi.hoisted(() => ({
  interceptToolCall: vi.fn(),
  dbExecute: vi.fn(),
}));

vi.mock('../lib/agents/tool_interceptor', () => ({
  interceptToolCall,
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: dbExecute }),
}));

import {
  executeGovernedTool,
  executeGovernedToolStructured,
} from '../lib/agents/constitutional_tool_executor';

function approvedDecision() {
  return {
    decision: 'ALLOW',
    approved: true,
    crs: { C: 0.9, R: 0.9, S: 0.9, M: 0.9, risk_level: 'LOW' },
    health_band: 'GREEN',
    sigma_viol: 0,
    receipt_id: 'integration-receipt',
    reason: 'approved for integration test',
  };
}

function deniedDecision() {
  return {
    decision: 'DENY',
    approved: false,
    crs: { C: 0.2, R: 0.2, S: 0.2, M: 0.2, risk_level: 'HIGH' },
    health_band: 'RED',
    sigma_viol: 1,
    receipt_id: 'integration-denied',
    reason: 'denied for integration test',
  };
}

const CANONICAL_VERSION = 'canonical-governance-2026-10-10.1';
const DEFAULT_UPDATED_AT = '2026-10-10T00:00:00.000Z';
const canaryEvidence = new Map<string, string>();

function addPassingCanary(sessionId: string, snapshot: {
  C: number; R: number; S: number; nStable: number; sigmaViol: number; updatedAt: string;
}) {
  const fingerprint = recoverySnapshotFingerprint({
    sessionId,
    policyVersion: CANONICAL_VERSION,
    C: snapshot.C,
    R: snapshot.R,
    S: snapshot.S,
    nStable: snapshot.nStable,
    sigmaViol: snapshot.sigmaViol,
    trajectoryUpdatedAt: snapshot.updatedAt,
  });
  canaryEvidence.set(`${sessionId}:${fingerprint}`, 'integration-canary-receipt');
}

function evidenceResult(query: unknown) {
  const record = query as { sql?: string; args?: unknown[] };
  if (!record.sql?.includes('FROM recovery_canary_evidence')) return null;
  const [sessionId, fingerprint] = record.args ?? [];
  const receiptId = canaryEvidence.get(`${String(sessionId)}:${String(fingerprint)}`);
  return { rows: receiptId ? [{ canary_status: 'passed', receipt_id: receiptId }] : [] };
}

describe('governed tool execution integration boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canaryEvidence.clear();
    interceptToolCall.mockResolvedValue(approvedDecision());
    dbExecute.mockImplementation(async (query: unknown) => {
      const evidence = evidenceResult(query);
      if (evidence) return evidence;
      const sql = typeof query === 'string' ? query : String((query as { sql?: string }).sql ?? '');
      if (sql.includes('FROM z_traj')) {
        return { rows: [{ last_c: 1, last_r: 1, last_s: 1, sigma_viol: 0, n_stable: 3, updated_at: DEFAULT_UPDATED_AT }] };
      }
      if (sql.includes('FROM tool_sessions')) return { rows: [{ sigma_viol: 0, tool_calls: 0 }] };
      return { rows: [], rowsAffected: 1 };
    });
    vi.stubEnv('LEX_APPROVAL_SIGNING_SECRET', 'integration-approval-secret');
  });

  it('derives capability-aware intent when task context is omitted', async () => {
    const read = vi.fn(async () => 'READ_RESULT');

    await executeGovernedTool(
      'read_file',
      { path: 'README.md' },
      read,
      'integration-context-session',
    );

    expect(interceptToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'read_file',
        task_context: 'Read using read_file. Target: README.md',
      }),
    );
  });

  it('does not mutate z_traj during repeated governed diagnostic reads', async () => {
    const read = vi.fn(async () => JSON.stringify({ C: 1, R: 1, S: 1, M: 1 }));
    const sessionId = 'read-only-stability-session';
    const results = [];
    for (let i = 0; i < 5; i += 1) {
      results.push(await executeGovernedTool('get_constitutional_state', { session_id: sessionId }, read, sessionId));
    }
    expect(results[0]).toContain('diagnostic_crs: diagnostic only;');
    expect(results[0]).toContain('canonical_crs:');
    const trajectoryMutations = dbExecute.mock.calls.filter(([query]) => {
      const sql = typeof query === 'string' ? query : String((query as { sql?: string }).sql ?? '');
      return /\b(UPDATE|INSERT INTO|DELETE FROM)\s+z_traj\b/i.test(sql);
    });
    expect(trajectoryMutations).toHaveLength(0);
    expect(read).toHaveBeenCalledTimes(5);
  });

  it('does not consume an action approval when cancellation happens before execution starts', async () => {
    const sessionId = 'cancel-before-consume-session';
    addPassingCanary(sessionId, { C: 1, R: 1, S: 1, nStable: 3, sigmaViol: 0, updatedAt: DEFAULT_UPDATED_AT });
    const controller = new AbortController();
    controller.abort();
    const write = vi.fn(async () => 'WRITE_SHOULD_NOT_RUN');
    const actionArgs = { path: 'README.md', content: 'test' };
    const result = await executeGovernedToolStructured(
      'write_file', { ...actionArgs, approval_request_id: 'a'.repeat(22) }, write, sessionId,
      undefined, 'internal-agent', controller.signal,
    );
    expect(result.decision).toBe('EXECUTION_CANCELLED_BEFORE_START');
    expect(result.result).toContain('not_started_after_cancellation');
    expect(write).not.toHaveBeenCalled();
    const approvalConsumption = dbExecute.mock.calls.filter(([query]) => {
      const sql = typeof query === 'string' ? query : String((query as { sql?: string }).sql ?? '');
      return /UPDATE\s+approval_requests/i.test(sql);
    });
    expect(approvalConsumption).toHaveLength(0);
  });

  it('restores a consumed approval when cancellation arrives during the approval-store round trip', async () => {
    const sessionId = 'cancel-during-consume-session';
    const requestId = 'cancel-during-consume-request';
    const actionArgs = { path: 'README.md', content: 'test', approval_request_id: requestId };
    addPassingCanary(sessionId, { C: 1, R: 1, S: 1, nStable: 3, sigmaViol: 0, updatedAt: DEFAULT_UPDATED_AT });
    const controller = new AbortController();
    const write = vi.fn(async () => 'WRITE_SHOULD_NOT_RUN');
    let status = 'approved';
    const expiresAt = Date.now() + 60_000;
    dbExecute.mockImplementation(async (query: unknown) => {
      const evidence = evidenceResult(query);
      if (evidence) return evidence;
      const sql = typeof query === 'string' ? query : String((query as { sql?: string }).sql ?? '');
      const args = typeof query === 'string' ? [] : ((query as { args?: unknown[] }).args ?? []);
      if (sql.includes('FROM z_traj')) {
        return { rows: [{ last_c: 1, last_r: 1, last_s: 1, sigma_viol: 0, n_stable: 3, updated_at: DEFAULT_UPDATED_AT }] };
      }
      if (sql.includes('FROM tool_sessions')) return { rows: [{ sigma_viol: 0, tool_calls: 0 }] };
      if (sql.includes('FROM approval_requests WHERE request_id = ?')) {
        return { rows: [{
          request_id: requestId, owner_id: 'operator', session_id: sessionId, tool_name: 'write_file',
          args_hash: approvalArgsHash(actionArgs), status, expires_at: expiresAt,
        }] };
      }
      if (sql.startsWith("UPDATE approval_requests SET status = 'used'")) {
        status = 'used';
        controller.abort();
        return { rowsAffected: 1, rows: [] };
      }
      if (sql.startsWith("UPDATE approval_requests SET status = 'approved'")) {
        status = 'approved';
        return { rowsAffected: 1, rows: [] };
      }
      return { rows: [], rowsAffected: 1 };
    });

    const result = await executeGovernedToolStructured(
      'write_file', actionArgs, write, sessionId, undefined, 'internal-agent', controller.signal,
    );

    expect(result.decision).toBe('EXECUTION_CANCELLED_BEFORE_START');
    expect(result.result).toContain('approval_release=restored');
    expect(write).not.toHaveBeenCalled();
    expect(status).toBe('approved');
  });

  it('authorizes before reusing a cached read result', async () => {
    let executions = 0;
    const read = async () => {
      executions += 1;
      return 'READ_RESULT';
    };

    const first = await executeGovernedTool('read_file', { path: 'README.md' }, read, 'integration-session');
    const second = await executeGovernedTool('read_file', { path: 'README.md' }, read, 'integration-session');

    expect(first).toContain('cache_hit:   false');
    expect(second).toContain('cache_hit:   true');
    expect(executions).toBe(1);
    expect(interceptToolCall).toHaveBeenCalledTimes(2);
  });

  it('blocks a previously cached read when the current authorization is denied', async () => {
    let executions = 0;
    const read = async () => {
      executions += 1;
      return 'SECRET_RESULT';
    };

    await executeGovernedTool('read_file', { path: '.env' }, read, 'integration-session-deny');
    interceptToolCall.mockResolvedValueOnce(deniedDecision());

    const denied = await executeGovernedTool('read_file', { path: '.env' }, read, 'integration-session-deny');

    expect(denied).toContain('approved:    false');
    expect(denied).not.toContain('SECRET_RESULT');
    expect(executions).toBe(1);
    expect(interceptToolCall).toHaveBeenCalledTimes(2);
  });

  it('does not cache approved write operations', async () => {
    let executions = 0;
    const write = async () => {
      executions += 1;
      return 'WRITE_OK';
    };

    const baseArgs = { path: 'a.ts', content: 'x' };
    addPassingCanary('integration-write-session', { C: 1, R: 1, S: 1, nStable: 3, sigmaViol: 0, updatedAt: DEFAULT_UPDATED_AT });
    const token1 = createGovernanceApprovalToken({ actorId: 'internal-agent', sessionId: 'integration-write-session', toolName: 'write_file', args: baseArgs });
    const token2 = createGovernanceApprovalToken({ actorId: 'internal-agent', sessionId: 'integration-write-session', toolName: 'write_file', args: baseArgs });
    await executeGovernedTool('write_file', { ...baseArgs, approval_token: token1 }, write, 'integration-write-session');
    await executeGovernedTool('write_file', { ...baseArgs, approval_token: token2 }, write, 'integration-write-session');

    expect(executions).toBe(2);
    expect(interceptToolCall).toHaveBeenCalledTimes(2);
  });

  it('allows the read-only recovery canary through RESTORING without an approval token', async () => {
    const probe = vi.fn(async () => 'CANARY_PROBE_OK');

    const result = await executeGovernedToolStructured(
      'run_recovery_canary',
      { session_id: 'restoring-canary-session' },
      probe,
      'restoring-canary-session',
    );

    expect(result.approved).toBe(true);
    expect(probe).toHaveBeenCalledOnce();
    const canonical = await readCanonicalGovernanceState({
      sessionId: 'restoring-canary-session', actorId: 'operator', capability: 'read',
    });
    expect(canonical.state.recoveryState).toBe('RESTORING');
    expect(result.policy).toMatchObject({ decision: 'allow', requiresApproval: false });
    expect(dbExecute.mock.calls.some(([query]) =>
      typeof query === 'object'
      && query !== null
      && 'sql' in query
      && String((query as { sql: unknown }).sql).includes('governance_approval_consumptions'),
    )).toBe(false);
  });

  it('does not invalidate a passing canary as a side effect of an approved write in VERIFIED state', async () => {
    const sessionId = 'verified-write-session';
    const snapshot = { C: 0.2, R: 0.4, S: 0.4, nStable: 3, sigmaViol: 0, updatedAt: DEFAULT_UPDATED_AT };
    addPassingCanary(sessionId, snapshot);
    dbExecute.mockImplementation(async (query: unknown) => {
      const evidence = evidenceResult(query);
      if (evidence) return evidence;
      const sql = typeof query === 'string' ? query : String((query as { sql?: string }).sql ?? '');
      if (sql.includes('FROM z_traj')) {
        return { rows: [{
          last_c: snapshot.C, last_r: snapshot.R, last_s: snapshot.S,
          velocity: 0, sigma_viol: 0, n_stable: snapshot.nStable,
          updated_at: snapshot.updatedAt,
        }] };
      }
      if (sql.includes('FROM tool_sessions')) return { rows: [{ sigma_viol: 0, tool_calls: 0 }] };
      return { rows: [], rowsAffected: 1 };
    });

    const actionArgs = { path: 'verified-safe.ts', content: 'export {};' };
    const token = createGovernanceApprovalToken({
      actorId: 'internal-agent', sessionId, toolName: 'write_file', args: actionArgs,
    });
    const write = vi.fn(async () => 'WRITE_COMPLETED');
    const result = await executeGovernedToolStructured(
      'write_file', { ...actionArgs, approval_token: token }, write, sessionId,
      undefined, 'internal-agent',
    );

    expect(result.approved).toBe(true);
    expect(result.result).toContain('WRITE_COMPLETED');
    expect(write).toHaveBeenCalledTimes(1);
    // The successful write records its own post-action observation once. A
    // preflight recovery mutation would produce an extra z_traj update and
    // invalidate the canary before the approved action could execute.
    const trajectoryUpdates = dbExecute.mock.calls.filter(([query]) => {
      const sql = typeof query === 'string' ? query : String((query as { sql?: string }).sql ?? '');
      return /^\s*UPDATE\s+z_traj\b/i.test(sql);
    });
    expect(trajectoryUpdates).toHaveLength(1);
  });

  it('does not grant write authority from a passing canary without action approval', async () => {
    const sessionId = 'canary-is-not-write-authority';
    const args = { path: 'still-protected.ts', content: 'change' };
    const write = vi.fn(async () => 'SHOULD_NOT_WRITE');
    addPassingCanary(sessionId, { C: 1, R: 1, S: 1, nStable: 3, sigmaViol: 0, updatedAt: DEFAULT_UPDATED_AT });

    const result = await executeGovernedToolStructured(
      'write_file', args, write, sessionId,
    );

    expect(result.approved).toBe(false);
    expect(result.policy).toMatchObject({ decision: 'approval_required' });
    expect(write).not.toHaveBeenCalled();
  });

  it('never executes a denied tool call', async () => {
    interceptToolCall.mockResolvedValue(deniedDecision());
    const tool = vi.fn(async () => 'SHOULD_NOT_EXECUTE');
    addPassingCanary('integration-deny-session', { C: 1, R: 1, S: 1, nStable: 3, sigmaViol: 0, updatedAt: DEFAULT_UPDATED_AT });

    const result = await executeGovernedTool('write_file', { path: 'blocked.ts' }, tool, 'integration-deny-session');

    expect(result).toContain('approved:    false');
    expect(tool).not.toHaveBeenCalled();
  });

  it('returns typed approval metadata without requiring string parsing', async () => {
    const tool = vi.fn(async () => 'STRUCTURED_OK');
    addPassingCanary('structured-approval-session', { C: 1, R: 1, S: 1, nStable: 3, sigmaViol: 0, updatedAt: DEFAULT_UPDATED_AT });

    const result = await executeGovernedToolStructured(
      'write_file',
      { path: 'safe.ts', content: 'export {}', approval_token: createGovernanceApprovalToken({ actorId: 'internal-agent', sessionId: 'structured-approval-session', toolName: 'write_file', args: { path: 'safe.ts', content: 'export {}' } }) },
      tool,
      'structured-approval-session',
    );

    expect(result).toMatchObject({
      result: expect.stringContaining('STRUCTURED_OK'),
      approved: true,
      decision: 'ALLOW',
      receiptId: 'integration-receipt',
    });
    expect(tool).toHaveBeenCalledOnce();
  });

  it('returns typed denial metadata and never invokes the tool', async () => {
    interceptToolCall.mockResolvedValue(deniedDecision());
    const tool = vi.fn(async () => 'SHOULD_NOT_EXECUTE');
    addPassingCanary('structured-denial-session', { C: 1, R: 1, S: 1, nStable: 3, sigmaViol: 0, updatedAt: DEFAULT_UPDATED_AT });

    const result = await executeGovernedToolStructured(
      'write_file',
      { path: 'blocked.ts', content: 'unsafe' },
      tool,
      'structured-denial-session',
    );

    expect(result).toMatchObject({
      result: expect.stringContaining('approved:    false'),
      approved: false,
      decision: 'DENY',
      receiptId: 'integration-denied',
    });
    expect(tool).not.toHaveBeenCalled();
  });

  it('does not serve a cached read after kernel M falls below the critical floor', async () => {
    let executions = 0;
    const read = async () => {
      executions += 1;
      return 'SAFE_RESULT';
    };

    await executeGovernedTool('read_file', { path: 'README.md' }, read, 'integration-kernel-critical');
    dbExecute.mockResolvedValue({ rows: [{ last_c: 0.01, last_r: 0.49, last_s: 0.50, last_m: 0.01, sigma_viol: 0, tool_calls: 1 }] });
    interceptToolCall.mockResolvedValue(deniedDecision());

    const result = await executeGovernedTool(
      'read_file',
      { path: 'README.md' },
      read,
      'integration-kernel-critical',
    );

    expect(result).toContain('approved:    false');
    expect(result).not.toContain('SAFE_RESULT');
    expect(result).not.toContain('cache_hit:   true');
    expect(executions).toBe(1);
    // The canonical reference monitor now blocks before the interceptor when M is critical.
    expect(interceptToolCall).toHaveBeenCalledTimes(1);
    expect(dbExecute).toHaveBeenCalled();
  });

  it('records post-action canonical state instead of only the pre-action snapshot', async () => {
    const tool = vi.fn(async () => 'WRITE_OK');
    addPassingCanary('post-action-session', { C: 0.4, R: 0.4, S: 0.4, nStable: 3, sigmaViol: 0, updatedAt: DEFAULT_UPDATED_AT });
    let trajectoryReads = 0;
    dbExecute.mockImplementation(async (query: { sql?: string }) => {
      const evidence = evidenceResult(query);
      if (evidence) return evidence;
      if (query.sql?.includes('FROM z_traj')) {
        trajectoryReads += 1;
        return trajectoryReads === 1
          ? { rows: [{ last_c: 0.40, last_r: 0.40, last_s: 0.40, sigma_viol: 0, n_stable: 3, updated_at: DEFAULT_UPDATED_AT }] }
          : { rows: [{ last_c: 0.04, last_r: 0.48, last_s: 0.48, sigma_viol: 1, n_stable: 0, updated_at: '2026-10-10T00:00:01.000Z' }] };
      }
      if (query.sql?.includes('FROM tool_sessions')) {
        return { rows: [{ sigma_viol: 0, tool_calls: 1 }] };
      }
      return { rows: [{ rowsAffected: 1 }], rowsAffected: 1 };
    });

    const args = { path: 'post-action.ts', content: 'changed' };
    const token = createGovernanceApprovalToken({
      actorId: 'internal-agent',
      sessionId: 'post-action-session',
      toolName: 'write_file',
      args,
    });

    const result = await executeGovernedToolStructured(
      'write_file',
      { ...args, approval_token: token },
      tool,
      'post-action-session',
    );

    expect(tool).toHaveBeenCalledOnce();
    expect(result.result).toContain('canonical_crs: C=0.400 R=0.400 S=0.400 M=0.400');
    expect(result.result).toContain('post_action_canonical_crs: C=0.040 R=0.480 S=0.480 M=0.040');
    expect(result.result).toContain('post_action_canonical_health_band: CRITICAL');
    expect(result.result).toContain('POST_ACTION_GOVERNANCE: Post-action canonical M changed from 0.400 to 0.040');
  });

  it('lets run_governance initialize the same session that the executor gates', async () => {
    let initialized = false;
    dbExecute.mockImplementation(async (query: { sql?: string }) => {
      if (query.sql?.includes('FROM z_traj')) {
        return initialized
          ? { rows: [{ last_c: 0.36, last_r: 0.34, last_s: 0.30, sigma_viol: 0 }] }
          : { rows: [] };
      }
      if (query.sql?.includes('FROM tool_sessions')) {
        return { rows: [{ sigma_viol: 0, tool_calls: 1 }] };
      }
      return { rows: [], rowsAffected: 1 };
    });
    const bootstrap = vi.fn(async () => {
      initialized = true;
      return 'GOVERNANCE_BOOTSTRAPPED';
    });

    const result = await executeGovernedToolStructured(
      'run_governance',
      { prompt: 'Initialize this governance session.' },
      bootstrap,
      'bootstrap-session',
    );

    expect(bootstrap).toHaveBeenCalledOnce();
    expect(result.approved).toBe(true);
    expect(result.result).toContain('canonical_crs: UNINITIALIZED (no z_traj row)');
    expect(result.result).toContain('canonical_health_band: UNINITIALIZED');
    expect(result.result).toContain('post_action_canonical_crs: C=0.360 R=0.340 S=0.300 M=0.300');
    expect(result.result).toContain('post_action_canonical_health_band: OPTIMAL');
  });

  it('fails closed instead of executing when governance state is unavailable', async () => {
    dbExecute.mockRejectedValueOnce(new Error('state store unavailable'));
    const read = vi.fn(async () => 'SHOULD_NOT_EXECUTE');

    const result = await executeGovernedTool(
      'read_file',
      { path: 'README.md' },
      read,
      'integration-state-outage',
    );

    expect(result).toContain('approved:    false');
    expect(result).toContain('Canonical governance state unavailable');
    expect(read).not.toHaveBeenCalled();
  });
});
