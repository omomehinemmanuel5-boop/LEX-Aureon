/**
 * MCP Server — Lex CRS Agent
 * Connect this to Claude at: https://lexaureon.com/api/mcp
 *
 * Implements the Model Context Protocol (JSON-RPC 2.0 over HTTP).
 * Exposes the Lex CRS Agent tool suite to any MCP-compatible client.
 *
 * TOOL SOURCES (2026-07-25). Two, deliberately:
 *
 *   TOOL_DEFINITIONS / TOOL_REGISTRY — the main suite in lib/lex_crs_agent/tools.ts.
 *   EXTENSION_* — tools that live in their own module under lib/lex_crs_agent/tools/.
 *
 * The split exists for a concrete reason rather than taste. tools.ts is 46 KB,
 * and write_file is a whole-file Contents API PUT, so registering a new tool
 * inside tools.ts means re-emitting the entire registry — the same
 * reconstruction problem that patch_file was built to solve. Extending here
 * keeps the addition purely additive. Once patch_file is live it can fold its
 * own definition into tools.ts as a small diff and this split can collapse.
 *
 * SCHEMA SHAPE. tools.ts entries carry their JSON Schema under `parameters`,
 * which this route maps to the MCP wire name `inputSchema`. Extension modules
 * declare `inputSchema` directly, since that is the protocol's own name. Both
 * are normalised below, so the served list is uniform.
 */

import { NextResponse } from 'next/server';
import { TOOL_DEFINITIONS, TOOL_REGISTRY } from '@/lib/lex_crs_agent/tools';
import { PATCH_FILE_DEFINITION, patch_file } from '@/lib/lex_crs_agent/tools/patch_file';
import { runToolGoverned } from '@/lib/agents/tool_interceptor';

const SERVER_INFO = {
  name:    'lex-crs-agent',
  version: '2.2.0',
};

const CAPABILITIES = {
  tools: {},
};

/** Tool handlers accept a single loosely-typed args object, as MCP delivers them. */
type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

/** Extension tools, declared with the MCP-native `inputSchema` key. */
const EXTENSION_DEFINITIONS = [PATCH_FILE_DEFINITION] as const;

const EXTENSION_REGISTRY: Record<string, ToolHandler> = {
  patch_file: (args) => runToolGoverned(
    'patch_file',
    args,
    () => patch_file(args as unknown as Parameters<typeof patch_file>[0]),
    args.session_id as string,
    args.task_context as string
  ),
};

/** Single normalised list served to clients, main suite first. */
function servedTools() {
  return [
    ...TOOL_DEFINITIONS.map(t => ({
      name:        t.name,
      description: t.description,
      inputSchema: t.parameters,
    })),
    ...EXTENSION_DEFINITIONS.map(t => ({
      name:        t.name,
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
  method:  string;
  params?: Record<string, unknown>;
  id?:     number | string;
};

export async function POST(req: Request) {
  let body: JsonRpcRequest;
  try { body = await req.json(); }
  catch { return NextResponse.json({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }); }

  const { method, params, id } = body;

  // ── initialize ────────────────────────────────────────────────────────────
  if (method === 'initialize') {
    return NextResponse.json({
      jsonrpc: '2.0',
      result:  { protocolVersion: '2024-11-05', capabilities: CAPABILITIES, serverInfo: SERVER_INFO },
      id,
    });
  }

  // ── notifications/initialized (no response needed) ────────────────────────
  if (method === 'notifications/initialized') {
    return new NextResponse(null, { status: 204 });
  }

  // ── tools/list ────────────────────────────────────────────────────────────
  if (method === 'tools/list') {
    return NextResponse.json({
      jsonrpc: '2.0',
      result:  { tools: servedTools() },
      id,
    });
  }

  // ── tools/call ────────────────────────────────────────────────────────────
  if (method === 'tools/call') {
    const toolName = (params?.name as string) ?? '';
    const args     = (params?.arguments as Record<string, unknown>) ?? {};
    const toolFn   = resolveTool(toolName);

    if (!toolFn) {
      return NextResponse.json({
        jsonrpc: '2.0',
        error:   { code: -32601, message: `Tool not found: ${toolName}` },
        id,
      });
    }

    try {
      const result = await toolFn(args);
      return NextResponse.json({
        jsonrpc: '2.0',
        result:  { content: [{ type: 'text', text: result }] },
        id,
      });
    } catch (e) {
      return NextResponse.json({
        jsonrpc: '2.0',
        error:   { code: -32603, message: String(e) },
        id,
      });
    }
  }

  // ── Unknown method ────────────────────────────────────────────────────────
  return NextResponse.json({
    jsonrpc: '2.0',
    error:   { code: -32601, message: `Method not found: ${method}` },
    id,
  });
}

// MCP also needs GET for discovery
export async function GET() {
  return NextResponse.json({
    name:         SERVER_INFO.name,
    version:      SERVER_INFO.version,
    description:  'Lex CRS Agent — AI coding agent with live access to the Lexaureon constitutional codebase. v2.2.0: adds patch_file (exact-match editing with a differential TypeScript parse gate), 5,520+ audit receipts, semantic memory (4,004 events), self-referential CRS, embedding cache.',
    tools:        servedTools().length,
    endpoint:     '/api/mcp',
    protocol:     'MCP 2024-11-05',
  });
}
