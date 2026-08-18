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

    expect(route).toContain('const result = await executeGovernedTool(');
    expect(route).toContain('const toolFn = resolveTool(toolName);');
    expect(route).toContain('return main ?? EXTENSION_REGISTRY[name];');
    expect(route).not.toContain('await toolFn(args);');

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

    expect(route).toContain('patch_file: (args) => patch_file(');
    expect(patch).toContain('export async function patch_file');
  });

  it('keeps the execution cache subordinate to fresh authorization', () => {
    const executor = source('lib/agents/constitutional_tool_executor.ts');
    const authorization = executor.indexOf('const decision = await interceptToolCall(');
    const cache = executor.indexOf('const cached = await cache.getOrExecuteAuthorized(');

    expect(authorization).toBeGreaterThanOrEqual(0);
    expect(cache).toBeGreaterThan(authorization);
    expect(executor).toContain('if (!decision.approved) return report(toolName, decision);');
    expect(executor).toContain('authorization_rechecked: true');
  });
});
