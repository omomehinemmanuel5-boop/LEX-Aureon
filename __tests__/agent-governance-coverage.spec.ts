import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS, TOOL_REGISTRY } from '../lib/lex_crs_agent/tools';
import { PATCH_FILE_DEFINITION, patch_file, preview_patch_file } from '../lib/lex_crs_agent/tools/patch_file';
import { requireKnownToolCapability } from '../lib/agents/tool_capability_registry';
import { isNonMutatingInspectionTool } from '../app/api/mcp/route';
import { isNonMutatingGovernanceTool } from '../lib/agents/constitutional_tool_executor';

describe('agent governance coverage', () => {
  it('exposes only tools with executable handlers and registered capabilities', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(typeof TOOL_REGISTRY[tool.name], `Missing executable handler for ${tool.name}`).toBe('function');
      expect(() => requireKnownToolCapability(tool.name), `Missing capability for ${tool.name}`).not.toThrow();
    }

    expect(PATCH_FILE_DEFINITION.name).toBe('patch_file');
    expect(typeof patch_file).toBe('function');
    expect(typeof preview_patch_file).toBe('function');
    expect(() => requireKnownToolCapability('patch_file')).not.toThrow();
  });

  it('uses the same explicit, minimal read-only classification at transport and executor boundaries', () => {
    const readOnlyTools = [
      'get_constitutional_state', 'get_recent_receipts', 'explain_denial',
      'read_file', 'read_directory', 'list_directory', 'list_files',
      'read_memory', 'search_memory', 'search_code', 'fetch_page', 'http_get',
      'get_file', 'read_json', 'parse_csv', 'cat', 'head', 'tail', 'grep',
      'find', 'ls', 'dir', 'glob', 'get_build_status', 'get_workflow_run',
      'get_workflow_log', 'get_vercel_logs', 'preview_patch_file',
      'check_github_token_scope', 'get_trajectory_status', 'run_recovery_canary',
    ];

    for (const tool of readOnlyTools) {
      expect(isNonMutatingInspectionTool(tool), `Transport should classify ${tool} as non-mutating`).toBe(true);
      expect(isNonMutatingGovernanceTool(tool), `Executor should classify ${tool} as non-mutating`).toBe(true);
    }

    for (const tool of ['curl', 'unknown_tool', 'discover_external_tool', 'govern_external_action', 'write_file']) {
      expect(isNonMutatingInspectionTool(tool), `Transport must not classify ${tool} as non-mutating`).toBe(false);
      expect(isNonMutatingGovernanceTool(tool), `Executor must not classify ${tool} as non-mutating`).toBe(false);
    }
  });

  it('fails closed for an unknown tool capability', () => {
    expect(() => requireKnownToolCapability('unknown_tool')).toThrow();
  });
});
