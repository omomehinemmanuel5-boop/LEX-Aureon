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
