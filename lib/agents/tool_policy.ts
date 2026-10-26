/**
 * Shared tool-risk policy manifest.
 *
 * Capability registration answers what a tool can do; this manifest answers
 * how the constitutional CRS scorer treats the tool's risk surface. Keeping
 * these sets outside the scorer prevents policy edits from being hidden inside
 * measurement code and gives tests/importers one stable source of truth.
 */

export const HIGH_RISK_TOOL_NAMES = [
  'bash', 'shell', 'run_command', 'exec', 'dispatch_workflow',
  'change_access', 'revoke_key', 'change_billing', 'authorize_external_action',
] as const;

export const MEDIUM_RISK_TOOL_NAMES = [
  'write_file', 'create_file',
  'delete_file',
  'run_governance', 'declare_trajectory_plan', 'clear_trajectory_plan',
  'review_agent_action', 'simulate_agent_plan', 'explain_denial', 'log_decision',
  'govern_external_action', 'patch_file', 'request_approval',
  'create_branch', 'open_pr',
] as const;

export const READ_ONLY_TOOL_NAMES = [
  'read_file', 'list_directory', 'search_code', 'get_build_status',
  'get_workflow_run', 'get_workflow_log', 'get_workflow_artifact',
  'check_github_token_scope', 'get_constitutional_state', 'get_recent_receipts',
  'get_vercel_logs', 'run_self_test', 'self_reflect', 'narrate_origin',
  'preview_patch_file', 'run_recovery_canary', 'get_trajectory_status',
] as const;

export const HIGH_RISK_TOOLS: ReadonlySet<string> = new Set(HIGH_RISK_TOOL_NAMES);
export const MEDIUM_RISK_TOOLS: ReadonlySet<string> = new Set(MEDIUM_RISK_TOOL_NAMES);
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set(READ_ONLY_TOOL_NAMES);

export const BUILD_FILE_PATTERNS: readonly RegExp[] = [
  /package\.json$/i,
  /package-lock\.json$/i,
  /turbo\.json$/i,
  /next\.config\./i,
  /vercel\.json$/i,
  /tsconfig\.json$/i,
];

export type ToolRiskClass = 'ULTRA_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';

export function isHighRiskTool(name: string): boolean {
  return HIGH_RISK_TOOLS.has(name.toLowerCase());
}

export function isMediumRiskTool(name: string): boolean {
  return MEDIUM_RISK_TOOLS.has(name.toLowerCase());
}

export function isReadOnlyTool(name: string): boolean {
  return READ_ONLY_TOOLS.has(name.toLowerCase());
}
