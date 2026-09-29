import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('agent governance coverage', () => {
  it('exposes only resolvable MCP tools and routes calls through one constitutional boundary', () => {
    const route = source('app/api/mcp/route.ts');
    const tools = source('lib/lex_crs_agent/tools.ts');
    const patch = source('lib/lex_crs_agent/tools/patch_file.ts');

    expect(route).toContain('const outcome = await withDeadline(executeGovernedTool(');
    expect(route).toContain('unknown_after_deadline');
    expect(route).toContain('const trajectoryOutcome = await withDeadline(executeGovernedTrajectoryAction(');
    expect(route).toContain('trajectoryController.signal');
    expect(route).toContain('const toolFn = resolveTool(toolName);');
    expect(route).toContain('return main ?? EXTENSION_REGISTRY[name];');
    expect(route).not.toContain('await toolFn(args);');
    expect(route).not.toContain('getDiscoveredToolCapability(ownerId, toolName)');
    expect(route).toContain('Tool capability is not explicitly registered for this environment');
    expect(route).toContain('requireKnownToolCapability(toolName)');

    // The MCP surface is the union of TOOL_DEFINITIONS and patch_file.
    // Verify every declared canonical tool has a corresponding registry entry.
    const definitionNames = [...tools.matchAll(/name:\s*[\'\"]([a-zA-Z0-9_]+)[\'\"]/g)]
      .map(match => match[1]);
    const registryBlock = tools.match(/export const TOOL_REGISTRY[\s\S]*?\n\};/);
    expect(registryBlock).toBeTruthy();

    const registry = registryBlock?.[0] ?? '';
    for (const name of definitionNames) {
      expect(registry, `Missing TOOL_REGISTRY entry for ${name}`).toContain(`${name}:`);
    }

    expect(route).toContain('patch_file: (args, signal) => patch_file(');
    expect(patch).toContain('export async function patch_file');
  });

  it('keeps the execution cache subordinate to fresh authorization', () => {
    const executor = source('lib/agents/constitutional_tool_executor.ts');
    const authorization = executor.indexOf('const decision = await interceptToolCall(');
    const cache = executor.indexOf('const cached = await cache.getOrExecuteAuthorized(');

    expect(authorization).toBeGreaterThanOrEqual(0);
    expect(cache).toBeGreaterThan(authorization);
    expect(executor).toContain('if (!decision.approved) {');
    expect(executor).toContain('return {');
    expect(executor).toContain('approved: false');
    expect(executor).toContain('authorization_rechecked: true');
    expect(executor).not.toContain('getDiscoveredToolCapability');
    expect(executor).toContain('explicitly register the tool capability before execution');
  });
});
