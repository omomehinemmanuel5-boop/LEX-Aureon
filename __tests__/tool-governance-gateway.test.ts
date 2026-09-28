import { describe, expect, it } from 'vitest';
import {
  classifyGovernanceRisk,
  evaluateToolGovernance,
  hashGovernanceArguments,
  redactGovernanceText,
  redactGovernanceValue,
  verifyToolResult,
} from '@/lib/agents/tool_governance_gateway';

describe('central tool governance gateway', () => {
  it('classifies tools by impact rather than trusting a caller label', () => {
    expect(classifyGovernanceRisk('read_file')).toBe('read');
    expect(classifyGovernanceRisk('patch_file')).toBe('write');
    expect(classifyGovernanceRisk('dispatch_workflow')).toBe('external');
    expect(classifyGovernanceRisk('delete_repository')).toBe('destructive');
  });

  it('requires action-bound approval for external and destructive actions', () => {
    const denied = evaluateToolGovernance({
      toolName: 'dispatch_workflow',
      args: { workflow: 'ci.yml' },
      sessionId: 'session-1',
      actorId: 'internal-agent',
      authorized: true,
    });
    expect(denied.decision).toBe('approval_required');
    expect(denied.requiresApproval).toBe(true);

    const approved = evaluateToolGovernance({
      toolName: 'dispatch_workflow',
      args: { workflow: 'ci.yml', approval_id: 'approval-1' },
      sessionId: 'session-1',
      actorId: 'internal-agent',
      authorized: true,
      approvalGranted: true,
    });
    expect(approved.decision).toBe('allow');
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
    expect(verifyToolResult('patch_file', 'approved:    false').status).toBe('failed');
    expect(verifyToolResult('patch_file', undefined).status).toBe('not_started');
  });
});
