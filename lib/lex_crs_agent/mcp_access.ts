/**
 * MCP capability policy.
 *
 * The public MCP endpoint must never expose Lex's own infrastructure tools.
 * Those tools use server-side GitHub, Vercel, database, or filesystem access
 * and are available only to an operator with the separate MCP_OPERATOR_SECRET.
 */

export const PUBLIC_MCP_TOOLS = new Set([
  'run_governance',
  'get_constitutional_state',
  'declare_trajectory_plan',
  'get_trajectory_status',
  'clear_trajectory_plan',
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
]);

export type McpAccessProfile = 'public' | 'operator';

export function operatorSecretConfigured(): boolean {
  return Boolean(process.env.MCP_OPERATOR_SECRET || process.env.ADMIN_PASSWORD);
}

export function isOperatorSecret(value: string | null | undefined): boolean {
  // MCP_OPERATOR_SECRET is preferred. ADMIN_PASSWORD is a backwards-safe
  // owner fallback so the existing deployment does not lose operator access
  // before the new optional secret is added to Vercel.
  const configured = process.env.MCP_OPERATOR_SECRET || process.env.ADMIN_PASSWORD;
  return Boolean(configured && value && value === configured);
}

export function toolsForProfile(profile: McpAccessProfile, names: string[]) {
  return names.filter(name => profile === 'operator'
    ? OPERATOR_ONLY_MCP_TOOLS.has(name) || PUBLIC_MCP_TOOLS.has(name)
    : PUBLIC_MCP_TOOLS.has(name));
}

export function canCallTool(profile: McpAccessProfile, name: string): boolean {
  return profile === 'operator'
    ? OPERATOR_ONLY_MCP_TOOLS.has(name) || PUBLIC_MCP_TOOLS.has(name)
    : PUBLIC_MCP_TOOLS.has(name);
}
