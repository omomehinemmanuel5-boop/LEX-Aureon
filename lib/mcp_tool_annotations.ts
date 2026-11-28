export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
}

/**
 * Review-derived annotations for the public MCP surface.
 * Keep this list aligned with PUBLIC_MCP_TOOLS and inspect implementation
 * side effects whenever a public tool is added or changed.
 */
const PUBLIC_TOOL_ANNOTATIONS: Record<string, McpToolAnnotations> = {
  run_governance: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  request_approval: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  get_constitutional_state: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  request_recovery_pulse: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  declare_trajectory_plan: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  get_trajectory_status: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  clear_trajectory_plan: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  review_agent_action: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  simulate_agent_plan: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  explain_denial: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  discover_external_tool: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  govern_external_action: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  consume_external_action: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
};

/** Unknown tools are advertised conservatively and still fail closed server-side. */
export function toolAnnotations(name: string): McpToolAnnotations {
  return PUBLIC_TOOL_ANNOTATIONS[name]
    ? { ...PUBLIC_TOOL_ANNOTATIONS[name] }
    : { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
}

export function publicToolAnnotationNames(): string[] {
  return Object.keys(PUBLIC_TOOL_ANNOTATIONS).sort();
}
