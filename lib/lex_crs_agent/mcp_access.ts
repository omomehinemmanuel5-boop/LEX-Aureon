/**
 * MCP capability policy.
 *
 * The public MCP endpoint must never expose Lex's own infrastructure tools.
 * Those tools use server-side GitHub, Vercel, database, or filesystem access.
 * They are available to admin-issued private_test credentials (mapped to the
 * operator capability profile) and to an operator with the optional
 * MCP_OPERATOR_SECRET; public API profiles never receive them.
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

export const INTERNAL_MCP_TOOLS = new Set([
  'read_file',
  'list_directory',
  'search_code',
  'write_file',
  'patch_file',
  'preview_patch_file',
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
]);

// Admin-issued private-test credentials may use the complete internal and
// authorization-control surface. Their calls remain authenticated, quota
// checked, and subject to the normal constitutional execution gateway.
export const PRIVATE_TEST_MCP_TOOLS = new Set([
  ...INTERNAL_MCP_TOOLS,
  'authorize_tool_action',
  'authorize_external_action',
]);

export const OPERATOR_ONLY_MCP_TOOLS = new Set([
  ...INTERNAL_MCP_TOOLS,
  'authorize_tool_action',
  'authorize_external_action',
]);

export type McpAccessProfile = 'public' | 'private_test' | 'operator';

export function profileForApiKey(plan: string | undefined): McpAccessProfile {
  // private_test keys are issued only by the admin-protected test-key endpoint.
  // Map them to the same operator capability profile for internal-agent
  // interoperability. This does NOT make the request an operator-secret
  // request: route-level key accounting and api_key:<id> audit identity remain.
  // Mutations still pass through the normal constitutional execution gateway.
  return plan === 'private_test' ? 'operator' : 'public';
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
