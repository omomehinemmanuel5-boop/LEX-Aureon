import { describe, expect, it } from 'vitest';
import {
  getToolCapability,
  isKnownGovernedTool,
  requireKnownToolCapability,
} from '@/lib/agents/tool_capability_registry';
import { TOOL_DEFINITIONS } from '@/lib/lex_crs_agent/tools';
import {
  EXECUTOR_READ_TOOLS,
  HIGH_RISK_TOOL_NAMES,
  KERNEL_GATED_WRITE_TOOLS,
  MEDIUM_RISK_TOOL_NAMES,
  NON_MUTATING_GOVERNANCE_TOOLS,
  READ_ONLY_TOOL_NAMES,
} from '@/lib/agents/tool_policy';

describe('Lex reference monitor capability registry', () => {
  it('registers capabilities by effect rather than trusting tool names', () => {
    expect(getToolCapability('read_file')?.capability).toBe('read');
    expect(getToolCapability('write_file')?.capability).toBe('write');
    expect(getToolCapability('dispatch_workflow')?.capability).toBe('external');
    expect(getToolCapability('delete_repository')?.capability).toBe('destructive');
    expect(getToolCapability('exec')?.capability).toBe('execute');
    expect(getToolCapability('query_database')?.capability).toBe('read');
    expect(getToolCapability('query_database')?.approvalRequired).toBe(false);
    expect(getToolCapability('run_recovery_canary')).toMatchObject({
      capability: 'recovery_probe', approvalRequired: false, reversible: false, source: 'mcp',
    });
    expect(getToolCapability('advance_recovery_plane')).toMatchObject({
      capability: 'recovery', approvalRequired: false, reversible: false, source: 'mcp',
    });
    expect(getToolCapability('declare_trajectory_plan')).toMatchObject({
      capability: 'write', approvalRequired: true, reversible: false, source: 'mcp',
    });
    expect(getToolCapability('clear_trajectory_plan')).toMatchObject({
      capability: 'write', approvalRequired: true, reversible: false, source: 'mcp',
    });
    // Governance analysis is non-effectful; the hypothetical target action is governed separately.
    expect(getToolCapability('run_governance')?.capability).toBe('read');
    expect(getToolCapability('run_governance')?.approvalRequired).toBe(false);
    expect(getToolCapability('run_governance')?.reversible).toBe(true);
    expect(getToolCapability('run_governance')?.bootstrapAllowed).toBe(true);
    expect(getToolCapability('write_file')?.approvalRequired).toBe(true);
    expect(getToolCapability('narrate_origin')?.capability).toBe('read');
  });

  it('registers external capability control-plane tools explicitly', () => {
    expect(getToolCapability('discover_external_tool')?.capability).toBe('read');
    expect(getToolCapability('discover_external_tool')?.approvalRequired).toBe(false);
    expect(getToolCapability('govern_external_action')?.capability).toBe('read');
    expect(getToolCapability('govern_external_action')?.approvalRequired).toBe(false);
    expect(getToolCapability('consume_external_action')?.capability).toBe('external');
    expect(getToolCapability('consume_external_action')?.approvalRequired).toBe(true);
    expect(getToolCapability('authorize_external_action')?.capability).toBe('identity');
    expect(getToolCapability('authorize_external_action')?.approvalRequired).toBe(true);
  });

  it('fails closed for an unknown tool', () => {
    expect(isKnownGovernedTool('mystery_side_effect')).toBe(false);
    expect(() => requireKnownToolCapability('mystery_side_effect')).toThrow(
      'Unknown tool capability',
    );
  });

  it('registers every core tool exposed by the MCP catalog', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(getToolCapability(tool.name), `${tool.name} is not registered`).toBeDefined();
    }
  });

  it('marks consequential capabilities as approval-bound', () => {
    expect(getToolCapability('run_command')?.approvalRequired).toBe(true);
    expect(getToolCapability('transfer')?.approvalRequired).toBe(true);
    expect(getToolCapability('read_file')?.approvalRequired).toBe(false);
  });

  it('keeps every CRS risk-manifest entry registered', () => {
    for (const toolName of [...HIGH_RISK_TOOL_NAMES, ...MEDIUM_RISK_TOOL_NAMES, ...READ_ONLY_TOOL_NAMES]) {
      expect(getToolCapability(toolName), `${toolName} is missing from the capability registry`).toBeDefined();
    }
  });

  it('keeps executor cache, trajectory, and stressed-kernel policy boundaries explicit', () => {
    expect(EXECUTOR_READ_TOOLS.has('read_file')).toBe(true);
    expect(EXECUTOR_READ_TOOLS.has('get_constitutional_state')).toBe(true);
    expect(NON_MUTATING_GOVERNANCE_TOOLS.has('simulate_agent_plan')).toBe(true);
    expect(NON_MUTATING_GOVERNANCE_TOOLS.has('write_file')).toBe(false);
    expect(KERNEL_GATED_WRITE_TOOLS.has('write_file')).toBe(true);
    expect(KERNEL_GATED_WRITE_TOOLS.has('read_file')).toBe(false);
  });
});
