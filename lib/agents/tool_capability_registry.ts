/**
 * Lex Reference Monitor — capability registry.
 *
 * Security rule: capability is granted by explicit registration, not inferred
 * from an unknown tool name. Unknown tools are fail-closed.
 *
 * The registry describes EFFECT, not vendor/tool identity. This is the
 * foundation for governing tools Lex has never seen before: a new tool must
 * first be mapped to a capability class before execution is permitted.
 */
export type ToolCapability =
  | 'read'
  | 'write'
  | 'external'
  | 'destructive'
  | 'identity'
  | 'financial'
  | 'network'
  | 'execute'
  | 'delegate';

export interface ToolCapabilityRecord {
  name: string;
  capability: ToolCapability;
  approvalRequired: boolean;
  reversible: boolean;
  bootstrapAllowed?: boolean;
  source: 'core' | 'mcp' | 'extension';
}

const READ_TOOLS = [
  'read_file','read_directory','list_directory','list_files','read_memory',
  'search_memory','fetch_page','curl','http_get','get_file','cat','head',
  'tail','grep','find','ls','dir','glob','read_json','parse_csv',
  'get_constitutional_state','get_trajectory_status','review_agent_action',
  'simulate_agent_plan','explain_denial','declare_trajectory_plan',
  'clear_trajectory_plan','get_build_status','get_workflow_run',
  'get_workflow_log','get_workflow_artifact','get_recent_receipts',
  'search_code','check_github_token_scope','get_vercel_logs','run_self_test',
  'self_reflect','query_database',
] as const;

const WRITE_TOOLS = [
  'write_file','write_file_governed','create_file','patch_file','log_decision',
  'narrate_origin',
] as const;

const EXTERNAL_TOOLS = [
  'dispatch_workflow','send_email','publish_post','create_issue',
  'create_pull_request','deploy','create_deployment','http_post','http_put',
  'http_patch','curl_post',
] as const;

const DESTRUCTIVE_TOOLS = [
  'delete_file','delete_directory','delete_repository','delete_branch',
  'revoke_key','change_access','change_billing','drop_table',
  'execute_destructive_sql',
] as const;

const SPECIAL_TOOLS: ToolCapabilityRecord[] = [
  // Governance analysis is non-effectful: it evaluates a requested/hypothetical
  // action but does not execute that action. The target action's capability
  // remains independently governed before any execution path can proceed.
  { name:'run_governance', capability:'read', approvalRequired:false, reversible:true, bootstrapAllowed:true, source:'mcp' },
  { name:'exec', capability:'execute', approvalRequired:true, reversible:false, source:'core' },
  { name:'run', capability:'execute', approvalRequired:true, reversible:false, source:'core' },
  { name:'run_command', capability:'execute', approvalRequired:true, reversible:false, source:'core' },
  { name:'shell', capability:'execute', approvalRequired:true, reversible:false, source:'core' },
  { name:'bash', capability:'execute', approvalRequired:true, reversible:false, source:'core' },
  { name:'powershell', capability:'execute', approvalRequired:true, reversible:false, source:'core' },
  { name:'python', capability:'execute', approvalRequired:true, reversible:false, source:'core' },
  { name:'docker', capability:'execute', approvalRequired:true, reversible:false, source:'core' },
  { name:'eval', capability:'execute', approvalRequired:true, reversible:false, source:'core' },
  { name:'transfer', capability:'financial', approvalRequired:true, reversible:false, source:'core' },
  { name:'rotate_identity', capability:'identity', approvalRequired:true, reversible:false, source:'core' },
  { name:'delegate_agent', capability:'delegate', approvalRequired:true, reversible:false, source:'core' },
  { name:'authorize_tool_action', capability:'identity', approvalRequired:true, reversible:false, source:'core' },
];

function record(name: string, capability: ToolCapability, source:'core'|'mcp'|'extension'='core'): ToolCapabilityRecord {
  return {
    name,
    capability,
    approvalRequired: capability !== 'read',
    reversible: capability === 'read' || capability === 'write',
    source,
  };
}

export const TOOL_CAPABILITY_REGISTRY: ReadonlyMap<string, ToolCapabilityRecord> = new Map([
  ...READ_TOOLS.map(name => [name, record(name, 'read', 'mcp')] as const),
  ...WRITE_TOOLS.map(name => [name, record(name, 'write', name === 'patch_file' ? 'extension' : 'mcp')] as const),
  ...EXTERNAL_TOOLS.map(name => [name, record(name, 'external', 'mcp')] as const),
  ...DESTRUCTIVE_TOOLS.map(name => [name, record(name, 'destructive', 'mcp')] as const),
  ...SPECIAL_TOOLS.map(item => [item.name, item] as const),
]);

export function getToolCapability(toolName: string): ToolCapabilityRecord | undefined {
  return TOOL_CAPABILITY_REGISTRY.get(toolName);
}

export function isKnownGovernedTool(toolName: string): boolean {
  return TOOL_CAPABILITY_REGISTRY.has(toolName);
}

/**
 * Returns the registered capability or a fail-closed result for unknown tools.
 * Never infer an execution capability from an arbitrary tool name.
 */
export function requireKnownToolCapability(toolName: string): ToolCapabilityRecord {
  const record = getToolCapability(toolName);
  if (!record) {
    throw new Error(`Unknown tool capability: ${toolName}. Register its capability before execution.`);
  }
  return record;
}

export function capabilitySummary(): ToolCapabilityRecord[] {
  return [...TOOL_CAPABILITY_REGISTRY.values()].sort((a,b) => a.name.localeCompare(b.name));
}
