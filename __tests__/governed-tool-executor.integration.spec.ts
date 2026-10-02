import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGovernanceApprovalToken } from '../lib/agents/tool_governance_gateway';

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

describe('governed tool execution integration boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    interceptToolCall.mockResolvedValue(approvedDecision());
    dbExecute.mockResolvedValue({ rows: [{ last_c: 1.0, last_r: 1.0, last_s: 1.0, last_m: 1.0, sigma_viol: 0, n_stable: 3, tool_calls: 0 }], rowsAffected: 1 });
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
    const token1 = createGovernanceApprovalToken({ actorId: 'internal-agent', sessionId: 'integration-write-session', toolName: 'write_file', args: baseArgs });
    const token2 = createGovernanceApprovalToken({ actorId: 'internal-agent', sessionId: 'integration-write-session', toolName: 'write_file', args: baseArgs });
    await executeGovernedTool('write_file', { ...baseArgs, approval_token: token1 }, write, 'integration-write-session');
    await executeGovernedTool('write_file', { ...baseArgs, approval_token: token2 }, write, 'integration-write-session');

    expect(executions).toBe(2);
    expect(interceptToolCall).toHaveBeenCalledTimes(2);
  });

  it('never executes a denied tool call', async () => {
    interceptToolCall.mockResolvedValue(deniedDecision());
    const tool = vi.fn(async () => 'SHOULD_NOT_EXECUTE');

    const result = await executeGovernedTool('write_file', { path: 'blocked.ts' }, tool, 'integration-deny-session');

    expect(result).toContain('approved:    false');
    expect(tool).not.toHaveBeenCalled();
  });

  it('returns typed approval metadata without requiring string parsing', async () => {
    const tool = vi.fn(async () => 'STRUCTURED_OK');

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
    let trajectoryReads = 0;
    dbExecute.mockImplementation(async (query: { sql?: string }) => {
      if (query.sql?.includes('FROM z_traj')) {
        trajectoryReads += 1;
        return trajectoryReads === 1
          ? { rows: [{ last_c: 0.40, last_r: 0.40, last_s: 0.40, sigma_viol: 0, n_stable: 3 }] }
          : { rows: [{ last_c: 0.04, last_r: 0.48, last_s: 0.48, sigma_viol: 1 }] };
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
