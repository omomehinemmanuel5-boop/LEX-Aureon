import { describe, expect, it } from 'vitest';
import { resolveToolManifest } from '@/lib/agents/tool_capability_discovery';

describe('Lex capability discovery', () => {
  it('maps MCP read-only annotations to read without requiring manual registration', () => {
    const result = resolveToolManifest('env-test', {
      name: 'lookup_repo',
      description: 'Inspect repository metadata',
      annotations: { readOnlyHint: true, openWorldHint: false },
    });
    expect(result.capability).toBe('read');
    expect(result.confidence).toBe('high');
    expect(result.approvalRequired).toBe(false);
  });

  it('maps exec transports to execute conservatively', () => {
    const result = resolveToolManifest('env-test', {
      name: 'exec',
      description: 'Execute a command in the client environment',
    });
    expect(result.capability).toBe('execute');
    expect(result.approvalRequired).toBe(true);
    expect(result.reversible).toBe(false);
  });

  it('does not downgrade ambiguous tools to read', () => {
    const result = resolveToolManifest('env-test', {
      name: 'mystery_tool',
      description: 'Does something useful',
    });
    expect(result.confidence).toBe('unresolved');
    expect(result.capability).toBe('destructive');
    expect(result.approvalRequired).toBe(true);
  });

  it('treats MCP annotations as hints and detects destructive behavior from identity', () => {
    const result = resolveToolManifest('env-test', {
      name: 'delete_customer',
      description: 'Remove a customer record',
      annotations: { readOnlyHint: true },
    });
    expect(result.capability).toBe('destructive');
    expect(result.confidence).toBe('high');
  });
});
