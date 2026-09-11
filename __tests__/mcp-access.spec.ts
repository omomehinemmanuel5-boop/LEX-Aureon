import { afterEach, describe, expect, it } from 'vitest';
import {
  canCallTool,
  isOperatorSecret,
  OPERATOR_ONLY_MCP_TOOLS,
  profileForApiKey,
  PUBLIC_MCP_TOOLS,
  toolsForProfile,
} from '../lib/lex_crs_agent/mcp_access';

describe('MCP capability policy', () => {
  afterEach(() => {
    delete process.env.MCP_OPERATOR_SECRET;
  });

  it('keeps infrastructure tools out of the public profile', () => {
    expect(toolsForProfile('public', [
      'run_governance',
      'read_file',
      'query_database',
      'dispatch_workflow',
    ])).toEqual(['run_governance']);
    expect(PUBLIC_MCP_TOOLS.has('read_file')).toBe(false);
  });

  it('allows the operator profile to include the classified tools', () => {
    expect(OPERATOR_ONLY_MCP_TOOLS.has('read_file')).toBe(true);
    expect(canCallTool('operator', 'read_file')).toBe(true);
    expect(canCallTool('public', 'read_file')).toBe(false);
  });

  it('requires the separate operator secret', () => {
    process.env.MCP_OPERATOR_SECRET = 'operator-test-secret';
    expect(isOperatorSecret('operator-test-secret')).toBe(true);
    expect(isOperatorSecret('api-key-value')).toBe(false);
    expect(isOperatorSecret(null)).toBe(false);
  });

  it('gives only private_test keys the full operator profile', () => {
    expect(profileForApiKey('private_test')).toBe('operator');
    expect(profileForApiKey('free')).toBe('public');
    expect(profileForApiKey(undefined)).toBe('public');
  });
});
