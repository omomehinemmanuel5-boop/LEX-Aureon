import { describe, expect, it } from 'vitest';
import { toolAnnotations, publicToolAnnotationNames } from '../lib/mcp_tool_annotations';
import { PUBLIC_MCP_TOOLS } from '../lib/lex_crs_agent/mcp_access';

describe('ChatGPT MCP tool safety annotations', () => {
  it('has an explicit annotation for every public MCP tool and no stale public entries', () => {
    expect(publicToolAnnotationNames()).toEqual([...PUBLIC_MCP_TOOLS].sort());
    for (const name of PUBLIC_MCP_TOOLS) {
      const annotations = toolAnnotations(name);
      expect(typeof annotations.readOnlyHint).toBe('boolean');
      expect(typeof annotations.destructiveHint).toBe('boolean');
      expect(typeof annotations.openWorldHint).toBe('boolean');
    }
  });

  it('does not describe state-changing governance tools as read-only', () => {
    for (const name of [
      'run_governance', 'request_approval', 'request_recovery_pulse',
      'declare_trajectory_plan', 'clear_trajectory_plan',
      'discover_external_tool', 'govern_external_action', 'consume_external_action',
    ]) {
      expect(toolAnnotations(name).readOnlyHint, name).toBe(false);
    }
  });

  it('marks only reviewed public read operations as read-only', () => {
    for (const name of [
      'get_constitutional_state', 'get_trajectory_status',
      'review_agent_action', 'simulate_agent_plan', 'explain_denial',
    ]) {
      expect(toolAnnotations(name).readOnlyHint, name).toBe(true);
    }
  });

  it('fails conservatively for an unclassified tool', () => {
    expect(toolAnnotations('unreviewed_tool')).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
  });
});
