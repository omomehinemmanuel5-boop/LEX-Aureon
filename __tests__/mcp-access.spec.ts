import { afterEach, describe, expect, it } from 'vitest';
import {
  canCallTool,
  isOperatorSecret,
  INTERNAL_MCP_TOOLS,
  OPERATOR_ONLY_MCP_TOOLS,
  PRIVATE_TEST_MCP_TOOLS,
  profileForApiKey,
  PUBLIC_MCP_TOOLS,
  toolsForProfile,
} from '../lib/lex_crs_agent/mcp_access';

describe('MCP capability policy', () => {
  afterEach(() => {
    delete process.env.MCP_OPERATOR_SECRET;
    delete process.env.ADMIN_PASSWORD;
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
    expect(canCallTool('operator', 'authorize_tool_action')).toBe(true);
    expect(canCallTool('operator', 'authorize_external_action')).toBe(true);
    expect(canCallTool('public', 'read_file')).toBe(false);
  });

  it('requires the separate operator secret', () => {
    process.env.MCP_OPERATOR_SECRET = 'operator-test-secret';
    expect(isOperatorSecret('operator-test-secret')).toBe(true);
    expect(isOperatorSecret('api-key-value')).toBe(false);
    expect(isOperatorSecret(null)).toBe(false);
  });

  it('gives admin-issued private-test keys a diagnostic profile without mutation authority', () => {
    expect(profileForApiKey('private_test')).toBe('private_test');
    expect(PRIVATE_TEST_MCP_TOOLS).not.toEqual(INTERNAL_MCP_TOOLS);
    expect(canCallTool('private_test', 'read_file')).toBe(true);
    expect(canCallTool('private_test', 'write_file')).toBe(false);
    expect(canCallTool('private_test', 'patch_file')).toBe(false);
    expect(canCallTool('private_test', 'dispatch_workflow')).toBe(false);
    expect(canCallTool('private_test', 'query_database')).toBe(true);
    expect(canCallTool('private_test', 'authorize_tool_action')).toBe(false);
    expect(canCallTool('private_test', 'authorize_external_action')).toBe(false);
    expect(profileForApiKey('sovereign')).toBe('public');
    expect(profileForApiKey('free')).toBe('public');
    expect(profileForApiKey(undefined)).toBe('public');
  });

  it('does not accept ADMIN_PASSWORD as an MCP operator credential', () => {
    process.env.ADMIN_PASSWORD = 'admin-password';
    expect(isOperatorSecret('admin-password')).toBe(false);
  });
});
