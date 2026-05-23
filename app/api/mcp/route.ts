/**
 * MCP Server — Lex CRS Agent
 * Connect this to Claude at: https://lexaureon.com/api/mcp
 *
 * Implements the Model Context Protocol (JSON-RPC 2.0 over HTTP).
 * Exposes all 10 Lex CRS Agent tools to any MCP-compatible client.
 */

import { NextResponse } from 'next/server';
import { TOOL_DEFINITIONS, TOOL_REGISTRY } from '@/lib/lex_crs_agent/tools';

const SERVER_INFO = {
  name:    'lex-crs-agent',
  version: '1.0.0',
};

const CAPABILITIES = {
  tools: {},
};

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
      result:  {
        tools: TOOL_DEFINITIONS.map(t => ({
          name:        t.name,
          description: t.description,
          inputSchema: t.parameters,
        })),
      },
      id,
    });
  }

  // ── tools/call ────────────────────────────────────────────────────────────
  if (method === 'tools/call') {
    const toolName = (params?.name as string) ?? '';
    const args     = (params?.arguments as Record<string, unknown>) ?? {};
    const toolFn   = TOOL_REGISTRY[toolName];

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
    description:  'Lex CRS Agent — AI coding agent with live access to the Lexaureon constitutional codebase.',
    tools:        TOOL_DEFINITIONS.length,
    endpoint:     '/api/mcp',
    protocol:     'MCP 2024-11-05',
  });
}
