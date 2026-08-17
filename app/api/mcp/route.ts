/**
 * MCP Server — Lex CRS Agent
 * Connect this to Claude at: https://lexaureon.com/api/mcp
 *
 * Implements the Model Context Protocol (JSON-RPC 2.0 over HTTP).
 * Exposes the Lex CRS Agent tool suite to any MCP-compatible client.
 */

import { NextResponse } from 'next/server';
import { TOOL_DEFINITIONS, TOOL_REGISTRY } from '@/lib/lex_crs_agent/tools';
import { PATCH_FILE_DEFINITION, patch_file } from '@/lib/lex_crs_agent/tools/patch_file';
import { executeGovernedTool } from '@/lib/agents/constitutional_tool_executor';

const SERVER_INFO = {
  name:    'lex-crs-agent',
  version: '2.3.0',
};

const CAPABILITIES = { tools: {} };

type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

const EXTENSION_DEFINITIONS = [PATCH_FILE_DEFINITION] as const;

const EXTENSION_REGISTRY: Record<string, ToolHandler> = {
  patch_file: (args) => executeGovernedTool(
    'patch_file',
    args,
    () => patch_file(args as unknown as Parameters<typeof patch_file>[0]),
    (args.session_id as string | undefined) ?? `mcp-${new Date().toISOString().slice(0, 10)}`,
    args.task_context as string | undefined
  ),
};

/**
 * Main-suite tools that are now dispatched through the constitutional executor.
 * The current authorization is evaluated before any execution-result cache is
 * consulted. The list starts with file/code operations where stale approval
 * has the clearest consequences.
 */
const GOVERNED_DISPATCH_TOOLS = new Set([
  'read_file',
  'list_directory',
  'search_code',
  'write_file',
]);

function servedTools() {
  return [
    ...TOOL_DEFINITIONS.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.parameters,
    })),
    ...EXTENSION_DEFINITIONS.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  ];
}

function resolveTool(name: string): ToolHandler | undefined {
  const main = (TOOL_REGISTRY as Record<string, ToolHandler | undefined>)[name];
  return main ?? EXTENSION_REGISTRY[name];
}

type JsonRpcRequest = {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
  id?: number | string;
};

export async function POST(req: Request) {
  let body: JsonRpcRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });
  }

  const { method, params, id } = body;

  if (method === 'initialize') {
    return NextResponse.json({
      jsonrpc: '2.0',
      result: {
        protocolVersion: '2024-11-05',
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
      },
      id,
    });
  }

  if (method === 'notifications/initialized') {
    return new NextResponse(null, { status: 204 });
  }

  if (method === 'tools/list') {
    return NextResponse.json({
      jsonrpc: '2.0',
      result: { tools: servedTools() },
      id,
    });
  }

  if (method === 'tools/call') {
    const toolName = (params?.name as string) ?? '';
    const args = (params?.arguments as Record<string, unknown>) ?? {};
    const toolFn = resolveTool(toolName);

    if (!toolFn) {
      return NextResponse.json({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Tool not found: ${toolName}` },
        id,
      });
    }

    try {
      const sessionId = (args.session_id as string | undefined)
        ?? `mcp-${new Date().toISOString().slice(0, 10)}`;

      const result = GOVERNED_DISPATCH_TOOLS.has(toolName)
        ? await executeGovernedTool(
            toolName,
            args,
            toolFn,
            sessionId,
            args.task_context as string | undefined,
          )
        : await toolFn(args);

      return NextResponse.json({
        jsonrpc: '2.0',
        result: { content: [{ type: 'text', text: result }] },
        id,
      });
    } catch (e) {
      return NextResponse.json({
        jsonrpc: '2.0',
        error: { code: -32603, message: String(e) },
        id,
      });
    }
  }

  return NextResponse.json({
    jsonrpc: '2.0',
    error: { code: -32601, message: `Method not found: ${method}` },
    id,
  });
}

export async function GET() {
  return NextResponse.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    description: 'Lex CRS Agent — MCP coding agent with constitutional authorization before governed file operations and execution-result caching.',
    tools: servedTools().length,
    endpoint: '/api/mcp',
    protocol: 'MCP 2024-11-05',
  });
}
