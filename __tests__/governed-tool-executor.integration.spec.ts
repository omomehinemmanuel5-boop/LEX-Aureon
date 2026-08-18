import { beforeEach, describe, expect, it, vi } from 'vitest';

const { interceptToolCall } = vi.hoisted(() => ({
  interceptToolCall: vi.fn(),
}));

vi.mock('../lib/agents/tool_interceptor', () => ({
  interceptToolCall,
}));

import { executeGovernedTool } from '../lib/agents/constitutional_tool_executor';

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

    await executeGovernedTool('write_file', { path: 'a.ts', content: 'x' }, write, 'integration-write-session');
    await executeGovernedTool('write_file', { path: 'a.ts', content: 'x' }, write, 'integration-write-session');

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
});
