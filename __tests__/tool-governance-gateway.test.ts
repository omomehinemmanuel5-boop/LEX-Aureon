import { describe, expect, it, vi } from 'vitest';
import {
  classifyDatabaseOperation,
  classifyGovernanceRisk,
  createGovernanceApprovalToken,
  evaluateToolGovernance,
  hashGovernanceArguments,
  redactGovernanceText,
  redactGovernanceValue,
  verifyToolResult,
} from '@/lib/agents/tool_governance_gateway';

describe('central tool governance gateway', () => {
  it('classifies tools by effect rather than trusting a caller label', () => {
    expect(classifyGovernanceRisk('read_file')).toBe('read');
    expect(classifyGovernanceRisk('patch_file')).toBe('write');
    expect(classifyGovernanceRisk('dispatch_workflow')).toBe('external');
    expect(classifyGovernanceRisk('delete_repository')).toBe('destructive');
    // run_governance evaluates a request but has no side effect itself.
    expect(classifyGovernanceRisk('run_governance')).toBe('read');
    expect(classifyGovernanceRisk('query_database', { sql: 'SELECT 1' })).toBe('read');
  });

  it('treats query_database as a read-only SELECT capability', () => {
    const result = evaluateToolGovernance({
      toolName: 'query_database',
      args: { sql: 'SELECT 1' },
      sessionId: 'session-1',
      actorId: 'internal-agent',
      authorized: true,
    });
    expect(result.risk).toBe('read');
    expect(result.requiresApproval).toBe(false);
    expect(result.decision).toBe('allow');
    expect(classifyDatabaseOperation('SELECT 1')).toBe('read');
    expect(classifyGovernanceRisk('query_database', { sql: 'UPDATE users SET x = 1' })).toBe('write');
    expect(classifyGovernanceRisk('query_database', { sql: 'SELECT 1; DELETE FROM users' })).toBe('destructive');
    expect(classifyDatabaseOperation('  /* comment */ SELECT 1')).toBe('read');
    expect(classifyDatabaseOperation('UPDATE users SET x = 1')).toBe('write');
    expect(classifyDatabaseOperation('SELECT 1; DELETE FROM users')).toBe('invalid');
  });

  it('allows non-effectful governance analysis without weakening normal write approval', () => {
    const result = evaluateToolGovernance({
      toolName: 'run_governance',
      args: { prompt: 'Review repository state.' },
      sessionId: 'session-1',
      actorId: 'internal-agent',
      authorized: true,
    });
    expect(result.risk).toBe('read');
    expect(result.requiresApproval).toBe(false);
    expect(result.decision).toBe('allow');
  });

  it('requires a valid signed approval bound to the exact action', () => {
    const denied = evaluateToolGovernance({
      toolName: 'dispatch_workflow',
      args: { workflow: 'ci.yml' },
      sessionId: 'session-1',
      actorId: 'internal-agent',
      authorized: true,
    });
    expect(denied.decision).toBe('approval_required');
    expect(denied.requiresApproval).toBe(true);

    const writeDenied = evaluateToolGovernance({
      toolName: 'write_file',
      args: { path: 'notes.txt', content: 'changed' },
      sessionId: 'session-1',
      actorId: 'internal-agent',
      authorized: true,
    });
    expect(writeDenied.risk).toBe('write');
    expect(writeDenied.decision).toBe('approval_required');
    expect(writeDenied.requiresApproval).toBe(true);

    vi.stubEnv('LEX_APPROVAL_SIGNING_SECRET', 'test-approval-secret');
    const nowMs = 1_700_000_000_000;
    const actionArgs = { workflow: 'ci.yml' };
    const token = createGovernanceApprovalToken({
      actorId: 'internal-agent',
      sessionId: 'session-1',
      toolName: 'dispatch_workflow',
      args: actionArgs,
      nowMs,
      approvalId: 'approval-1',
    });
    const approved = evaluateToolGovernance({
      toolName: 'dispatch_workflow',
      args: { ...actionArgs, approval_token: token },
      sessionId: 'session-1',
      actorId: 'internal-agent',
      authorized: true,
      approvalToken: token,
      nowMs,
    });
    expect(approved.decision).toBe('allow');
    expect(approved.approvalId).toBe('approval-1');

    const mismatched = evaluateToolGovernance({
      toolName: 'dispatch_workflow',
      args: { workflow: 'other.yml', approval_token: token },
      sessionId: 'session-1',
      actorId: 'internal-agent',
      authorized: true,
      approvalToken: token,
      nowMs,
    });
    expect(mismatched.decision).toBe('approval_required');
    expect(mismatched.reasons.join(' ')).toContain('different action arguments');

    const expired = evaluateToolGovernance({
      toolName: 'dispatch_workflow',
      args: { ...actionArgs, approval_token: token },
      sessionId: 'session-1',
      actorId: 'internal-agent',
      authorized: true,
      approvalToken: token,
      nowMs: nowMs + 15 * 60 * 1000 + 1,
    });
    expect(expired.decision).toBe('approval_required');
    expect(expired.reasons.join(' ')).toContain('expired');
    vi.unstubAllEnvs();
  });

  it('rejects approval substitution across actor, session, and tool boundaries', () => {
    vi.stubEnv('LEX_APPROVAL_SIGNING_SECRET', 'test-approval-secret');
    const nowMs = 1_700_000_000_000;
    const args = { workflow: 'ci.yml' };
    const token = createGovernanceApprovalToken({
      actorId: 'actor-a',
      sessionId: 'session-a',
      toolName: 'dispatch_workflow',
      args,
      nowMs,
      approvalId: 'approval-boundary-1',
    });

    const substitutions = [
      {
        actorId: 'actor-b',
        sessionId: 'session-a',
        toolName: 'dispatch_workflow',
      },
      {
        actorId: 'actor-a',
        sessionId: 'session-b',
        toolName: 'dispatch_workflow',
      },
      {
        actorId: 'actor-a',
        sessionId: 'session-a',
        toolName: 'patch_file',
      },
    ];

    for (const substitution of substitutions) {
      const result = evaluateToolGovernance({
        toolName: substitution.toolName,
        args: { ...args, approval_token: token },
        sessionId: substitution.sessionId,
        actorId: substitution.actorId,
        authorized: true,
        approvalToken: token,
        nowMs,
      });
      expect(result.decision).toBe('approval_required');
      expect(result.reasons.join(' ')).toContain('different actor, session, or tool');
    }

    vi.unstubAllEnvs();
  });

  it('redacts credential-shaped keys recursively', () => {
    expect(redactGovernanceValue({
      token: 'secret-value',
      nested: { password: 'another-secret', ok: 'visible' },
    })).toEqual({
      token: '[REDACTED]',
      nested: { password: '[REDACTED]', ok: 'visible' },
    });
  });

  it('redacts inline credentials from free-form context', () => {
    expect(redactGovernanceText('Authorization: Bearer abc123 password=hunter2'))
      .toBe('Authorization=[REDACTED] password=[REDACTED]');
  });

  it('produces stable argument hashes regardless of object key order', () => {
    expect(hashGovernanceArguments({ b: 2, a: 1 }))
      .toBe(hashGovernanceArguments({ a: 1, b: 2 }));
  });

  it('does not claim a write succeeded without resource-specific verification', () => {
    expect(verifyToolResult('read_file', 'content').status).toBe('verified');
    expect(verifyToolResult('patch_file', 'changed').status).toBe('unknown');
    expect(verifyToolResult('patch_file', 'approved:    false').status).toBe('unknown');
    expect(verifyToolResult('patch_file', undefined).status).toBe('not_started');
  });

  it('does not interpret denial-like strings inside a read result as execution status', () => {
    expect(verifyToolResult('read_file', 'source contains approved:    false').status).toBe('verified');
    expect(verifyToolResult('read_file', 'source contains EXECUTION_STATUS=not_started').status).toBe('verified');
  });
});
