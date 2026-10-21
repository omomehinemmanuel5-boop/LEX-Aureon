import { classifyDatabaseOperation } from './agents/tool_governance_gateway';

// These inspection tools must not bootstrap or otherwise mutate the trajectory they inspect.
const NON_MUTATING_INSPECTION_TOOLS = new Set([
  'get_constitutional_state', 'get_recent_receipts', 'explain_denial',
  'read_file', 'read_directory', 'list_directory', 'list_files',
  'read_memory', 'search_memory', 'search_code', 'fetch_page', 'http_get',
  'get_file', 'read_json', 'parse_csv', 'cat', 'head', 'tail', 'grep',
  'find', 'ls', 'dir', 'glob', 'get_build_status', 'get_workflow_run',
  'get_workflow_log', 'get_vercel_logs', 'preview_patch_file',
  'check_github_token_scope', 'get_trajectory_status', 'run_recovery_canary',
  'get_workflow_artifact', 'review_agent_action', 'narrate_origin',
  // A simulated plan is read-only with respect to canonical trajectory state.
  'simulate_agent_plan',
]);

export function isNonMutatingInspectionTool(toolName: string, args: Record<string, unknown> = {}): boolean {
  if (toolName === 'query_database') {
    return classifyDatabaseOperation(String(args.sql ?? '')) === 'read';
  }
  return NON_MUTATING_INSPECTION_TOOLS.has(toolName);
}
