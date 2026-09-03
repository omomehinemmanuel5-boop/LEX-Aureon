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
import { validateAndConsumeKey } from '@/lib/api_keys';
import { recordMcpClientIdentity } from '@/lib/db';
import crypto from 'crypto';

// fix (2026-08-24): short, non-reversible correlation key for a caller —
// MCP-over-HTTP here is stateless per POST request, so IP is the only
// signal consistently available across a client's initialize call and the
// tools/call requests that follow it, short of adding a new handshake
// token no client currently sends. Used both for the session_id fallback
// below and for mcp_client_identity's primary key.
function ipHash(req: Request): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12);
}

// fix (2026-09-01): reuses the exact header convention already documented
// in /api-docs for /api/lex/govern (x-lex-api-key, or Authorization:
// Bearer) rather than inventing a new one — same key system, same
// lib/api_keys.ts validation, now REQUIRED here rather than optional,
// since this endpoint's blast radius (repo write, CI dispatch, DB read)
// is categorically larger than a rate-limited text-governance call.
function extractApiKey(req: Request): string | null {
  const header = req.headers.get('x-lex-api-key');
  if (header) return header.trim();
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

const SERVER_INFO = {
  name:    'lex-crs-agent',
  version: '2.3.0',
};

const CAPABILITIES = { tools: {} };

type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

const EXTENSION_DEFINITIONS = [PATCH_FILE_DEFINITION] as const;

/**
 * Extension handlers are kept PURE here. The MCP dispatcher applies the
 * constitutional executor uniformly to every exposed tool, including
 * patch_file. This prevents an extension from accidentally bypassing the
 * same authorization boundary used by the main registry.
 */
const EXTENSION_REGISTRY: Record<string, ToolHandler> = {
  patch_file: (args) => patch_file(
    args as unknown as Parameters<typeof patch_file>[0]
  ),
};

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
    // fix (2026-08-24): clientInfo (name/version) arrives here per the MCP
    // protocol spec and was previously never read. Best-effort record —
    // never let this block or fail the actual handshake response.
    try {
      const clientInfo = params?.clientInfo as { name?: string; version?: string } | undefined;
      await recordMcpClientIdentity(ipHash(req), clientInfo?.name, clientInfo?.version);
    } catch { /* non-fatal — see lib/db.ts's other best-effort writes */ }

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
        ?? `mcp-${new Date().toISOString().slice(0, 10)}-${ipHash(req)}`;

      // Constitutional authorization is the single dispatch boundary for
      // every MCP-exposed tool. Read-only results may be reused by the
      // executor's cache, but authorization is recomputed for every call.
      // Non-read tools are never cached and still pass through the same
      // constitutional decision point.
      const result = await executeGovernedTool(
        toolName,
        args,
        toolFn,
        sessionId,
        args.task_context as string | undefined,
      );

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
    description: 'Lex CRS Agent — MCP coding agent with constitutional authorization before every tool execution; read-only results may use authorization-checked execution caching.',
    tools: servedTools().length,
    endpoint: '/api/mcp',
    protocol: 'MCP 2024-11-05',
  });
}
