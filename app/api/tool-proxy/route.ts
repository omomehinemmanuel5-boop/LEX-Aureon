/**
 * Deprecated compatibility adapter for the canonical MCP route.
 *
 * `/api/mcp` is the only agent execution boundary. It owns authentication,
 * rate limiting, capability registration, approvals, governance, execution,
 * receipts, and response semantics. This route exists only for clients that
 * still send the former tool-proxy request shape.
 *
 * Remote MCP forwarding was intentionally removed. It created a second
 * authentication/governance pipeline and could not provide retry-safe remote
 * mutation semantics. Use the canonical MCP route for Lex-governed tools.
 */

import { NextResponse } from 'next/server';
import { POST as canonicalMcpPost } from '@/app/api/mcp/route';
import crypto from 'node:crypto';
import { readBoundedBody } from '@/lib/http/bounded_body';

const MAX_PROXY_BODY_BYTES = 64 * 1024;
const MAX_SESSION_ID_LENGTH = 128;
const MAX_TOOL_NAME_LENGTH = 128;
const MAX_TASK_CONTEXT_LENGTH = 8_000;

function jsonError(status: number, message: string) {
  return NextResponse.json(
    { error: message, canonical_endpoint: '/api/mcp' },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function responseHeaders(source: Response): Headers {
  const headers = new Headers();
  const contentType = source.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  headers.set('Cache-Control', 'no-store');
  return headers;
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_PROXY_BODY_BYTES) {
    return jsonError(413, 'Request body too large');
  }

  const bounded = await readBoundedBody(req, MAX_PROXY_BODY_BYTES, 10_000);
  if (bounded.kind === 'too_large') return jsonError(413, 'Request body too large');
  if (bounded.kind === 'timed_out') return jsonError(408, 'Request body read timed out');
  if (bounded.kind !== 'ok') return jsonError(400, 'Unable to read request body');

  let body: unknown;
  try { body = JSON.parse(bounded.text); }
  catch { return jsonError(400, 'Invalid JSON'); }
  if (!isRecord(body)) return jsonError(400, 'Request body must be a JSON object');

  // The former route supported optional remote forwarding. Keeping this field
  // silently ignored would make callers believe a remote action was executed
  // by the canonical Lex MCP server, so reject it explicitly.
  if (body.target_mcp_url !== undefined) {
    return jsonError(410, 'Remote MCP forwarding was removed; call the target directly or use /api/mcp for Lex-governed tools');
  }

  const toolName = body.tool_name;
  const args = body.arguments;
  const sessionId = body.session_id;
  const taskContext = body.task_context;
  const turn = body.turn;

  if (typeof toolName !== 'string' || !toolName.trim() || toolName.length > MAX_TOOL_NAME_LENGTH) {
    return jsonError(400, 'tool_name must be a non-empty string of at most 128 characters');
  }
  if (!isRecord(args)) return jsonError(400, 'arguments object required');
  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > MAX_SESSION_ID_LENGTH) {
    return jsonError(400, 'session_id must be a non-empty string of at most 128 characters');
  }
  if (taskContext !== undefined && (typeof taskContext !== 'string' || taskContext.length > MAX_TASK_CONTEXT_LENGTH)) {
    return jsonError(400, 'task_context must be a string of at most 8000 characters');
  }
  if (turn !== undefined && (!Number.isInteger(turn) || Number(turn) < 0 || Number(turn) > 1_000_000)) {
    return jsonError(400, 'turn must be a non-negative integer');
  }

  const canonicalArgs: Record<string, unknown> = {
    ...args,
    session_id: sessionId.trim(),
    ...(taskContext !== undefined ? { task_context: taskContext } : {}),
    ...(turn !== undefined ? { turn } : {}),
  };
  const canonicalRequest = new Request(new URL('/api/mcp', req.url), {
    method: 'POST',
    headers: new Headers(req.headers),
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName.trim(), arguments: canonicalArgs },
      id: crypto.randomUUID(),
    }),
  });
  canonicalRequest.headers.set('content-type', 'application/json');
  canonicalRequest.headers.delete('content-length');

  const canonicalResponse = await canonicalMcpPost(canonicalRequest);
  return new Response(canonicalResponse.body, {
    status: canonicalResponse.status,
    headers: responseHeaders(canonicalResponse),
  });
}

export async function GET() {
  return NextResponse.json({
    name: 'Lex Aureon MCP compatibility adapter',
    version: '3.0.0',
    deprecated: true,
    canonical_endpoint: '/api/mcp',
    description: 'Translates the legacy tool-proxy request shape into one canonical MCP tools/call request. Remote forwarding is not supported.',
  }, { headers: { 'Cache-Control': 'no-store' } });
}
