/**
 * MCP capability policy.
 *
 * The public MCP endpoint must never expose Lex's own infrastructure tools.
 * Those tools use server-side GitHub, Vercel, database, or filesystem access
 * and are available only to an operator with the separate MCP_OPERATOR_SECRET.
 */

import { env } from '../env';

export const PUBLIC_MCP_TOOLS = new Set([
  'run_governance',
  'get_constitutional_state',
  'declare_trajectory_plan',
  'get_trajectory_status',
  'clear_trajectory_plan',
  'review_agent_action',
  'simulate_agent_plan',
  'explain_denial',
  'discover_external_tool',
  'govern_external_action',
  'consume_external_action',
]);

export const PRIVATE_TEST_MCP_TOOLS = new Set([
  'read_file', 'list_directory', 'search_code', 'get_build_status',
  'get_workflow_run', 'get_workflow_log', 'get_workflow_artifact',
  'get_constitutional_state', 'get_recent_receipts', 'run_self_test', 'self_reflect',
]);

export const OPERATOR_ONLY_MCP_TOOLS = new Set([
  'read_file',
  'list_directory',
  'search_code',
  'write_file',
  'patch_file',
  'get_build_status',
  'get_workflow_run',
  'get_workflow_log',
  'dispatch_workflow',
  'get_workflow_artifact',
  'check_github_token_scope',
  'query_database',
  'get_recent_receipts',
  'get_vercel_logs',
  'run_self_test',
  'self_reflect',
  'log_decision',
  'narrate_origin',
  'authorize_tool_action',
]);

export type McpAccessProfile = 'public' | 'private_test' | 'operator';

export function profileForApiKey(plan: string | undefined): McpAccessProfile {
  // private_test keys are issued only by the admin-protected test-key endpoint.
  // They are diagnostic, not operator credentials; mutations remain operator-only.
  return plan === 'private_test' ? 'private_test' : 'public';
}

export function operatorSecretConfigured(): boolean {
  return Boolean(env.MCP_OPERATOR_SECRET);
}

export function isOperatorSecret(value: string | null | undefined): boolean {
  const configured = env.MCP_OPERATOR_SECRET;
  return Boolean(configured && value && value === configured);
}

export function toolsForProfile(profile: McpAccessProfile, names: string[]) {
  return names.filter(name => profile === 'operator'
    ? OPERATOR_ONLY_MCP_TOOLS.has(name) || PUBLIC_MCP_TOOLS.has(name)
    : profile === 'private_test'
      ? PRIVATE_TEST_MCP_TOOLS.has(name) || PUBLIC_MCP_TOOLS.has(name)
      : PUBLIC_MCP_TOOLS.has(name));
}

export function canCallTool(profile: McpAccessProfile, name: string): boolean {
  return profile === 'operator'
    ? OPERATOR_ONLY_MCP_TOOLS.has(name) || PUBLIC_MCP_TOOLS.has(name)
    : profile === 'private_test'
      ? PRIVATE_TEST_MCP_TOOLS.has(name) || PUBLIC_MCP_TOOLS.has(name)
      : PUBLIC_MCP_TOOLS.has(name);
}
