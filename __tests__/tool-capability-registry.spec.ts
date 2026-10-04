import { describe, expect, it } from 'vitest';
import {
  getToolCapability,
  isKnownGovernedTool,
  requireKnownToolCapability,
} from '@/lib/agents/tool_capability_registry';

describe('Lex reference monitor capability registry', () => {
  it('registers capabilities by effect rather than trusting tool names', () => {
    expect(getToolCapability('read_file')?.capability).toBe('read');
    expect(getToolCapability('write_file')?.capability).toBe('write');
    expect(getToolCapability('dispatch_workflow')?.capability).toBe('external');
    expect(getToolCapability('delete_repository')?.capability).toBe('destructive');
    expect(getToolCapability('exec')?.capability).toBe('execute');
    expect(getToolCapability('query_database')?.capability).toBe('read');
    expect(getToolCapability('query_database')?.approvalRequired).toBe(false);
    // Governance analysis is non-effectful; the hypothetical target action is governed separately.
    expect(getToolCapability('run_governance')?.capability).toBe('read');
    expect(getToolCapability('run_governance')?.approvalRequired).toBe(false);
    expect(getToolCapability('run_governance')?.reversible).toBe(true);
    expect(getToolCapability('run_governance')?.bootstrapAllowed).toBe(true);
    expect(getToolCapability('write_file')?.approvalRequired).toBe(true);
  });

  it('registers external capability control-plane tools explicitly', () => {
    expect(getToolCapability('discover_external_tool')?.capability).toBe('read');
    expect(getToolCapability('discover_external_tool')?.approvalRequired).toBe(false);
    expect(getToolCapability('govern_external_action')?.capability).toBe('read');
    expect(getToolCapability('govern_external_action')?.approvalRequired).toBe(false);
    expect(getToolCapability('consume_external_action')?.capability).toBe('external');
    expect(getToolCapability('consume_external_action')?.approvalRequired).toBe(true);
    expect(getToolCapability('authorize_external_action')?.capability).toBe('identity');
    expect(getToolCapability('authorize_external_action')?.approvalRequired).toBe(true);
  });

  it('fails closed for an unknown tool', () => {
    expect(isKnownGovernedTool('mystery_side_effect')).toBe(false);
    expect(() => requireKnownToolCapability('mystery_side_effect')).toThrow(
      'Unknown tool capability',
    );
  });

  it('marks consequential capabilities as approval-bound', () => {
    expect(getToolCapability('run_command')?.approvalRequired).toBe(true);
    expect(getToolCapability('transfer')?.approvalRequired).toBe(true);
    expect(getToolCapability('read_file')?.approvalRequired).toBe(false);
  });
});
