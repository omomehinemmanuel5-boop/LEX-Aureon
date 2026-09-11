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
import { executeGovernedTrajectoryAction, trajectoryActionId } from '@/lib/agents/trajectory_executor';
import type { TrajectoryAction } from '@/lib/agents/trajectory_governance';
import { getTrajectoryState, setTrajectoryState, clearTrajectoryState, isTrajectoryActive } from '@/lib/agents/trajectory_session_store';
import { validateApiKey, validateAndConsumeKey } from '@/lib/api_keys';
import { recordMcpClientIdentity } from '@/lib/db';
import { canCallTool, isOperatorSecret, profileForApiKey, toolsForProfile, type McpAccessProfile } from '@/lib/lex_crs_agent/mcp_access';
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
//
// fix (2026-09-04): added a `?apiKey=` query-param fallback. Claude.ai's
// custom connector UI (mobile + web) has no field for a static request
// header today — "Requires sign-in" only exposes OAuth client id/secret,
// not a raw Bearer/x-lex-api-key value — so header-only auth leaves that
// client unable to authenticate at all. Every other MCP client we support
// (Claude Code, Codex, etc.) already sends the header and is unaffected.
// Query-param keys can leak into logs/browser history more easily than
// headers, so this is an interim measure until OAuth is added for the
// Claude.ai path specifically — not a replacement for the header check.
function extractApiKey(req: Request): string | null {
  const header = req.headers.get('x-lex-api-key');
  if (header) return header.trim();
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const queryKey = new URL(req.url).searchParams.get('apiKey');
  if (queryKey) return queryKey.trim();
  return null;
}

function isOperator(req: Request): boolean {
  return isOperatorSecret(req.headers.get('x-lex-operator-secret'));
}

function unauthorized(id: number | string | null | undefined) {
  return NextResponse.json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Unauthorized: valid API key required' },
    id,
  });
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
  id?: number | string | null;
};

const MAX_SESSION_ID_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestId(value: unknown): number | string | null {
  return typeof value === 'number' || typeof value === 'string' || value === null
    ? value
    : null;
}

function invalidRequest(id: number | string | null = null) {
  return NextResponse.json({
    jsonrpc: '2.0',
    error: { code: -32600, message: 'Invalid Request' },
    id,
  });
}

function invalidParams(id: number | string | null, message = 'Invalid params') {
  return NextResponse.json({
    jsonrpc: '2.0',
    error: { code: -32602, message },
    id,
  });
}

function validSessionId(value: unknown): value is string {
  return typeof value === 'string'
    && value.trim().length > 0
    && value.length <= MAX_SESSION_ID_LENGTH;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({
      jsonrpc: '2.0',
      error: { code: -32700, message: 'Parse error' },
      id: null,
    });
  }

  // Keep the transport boundary strict. A malformed request previously fell
  // through to property casts, where arrays/null could produce a generic 500
  // after authentication or tool dispatch had already started. MCP clients
  // receive the protocol-defined error instead, and no quota is consumed.
  if (!isRecord(body) || body.jsonrpc !== '2.0' || typeof body.method !== 'string'
    || body.method.trim().length === 0 || (body.params !== undefined && !isRecord(body.params))
    || (body.id !== undefined && requestId(body.id) === null && body.id !== null)) {
    return invalidRequest(requestId(isRecord(body) ? body.id : undefined));
  }

  const { method, params, id } = body as JsonRpcRequest;

  if (method === 'initialize') {
    // fix (2026-08-24): clientInfo (name/version) arrives here per the MCP
    // protocol spec and was previously never read. Best-effort record —
    // never let this block or fail the actual handshake response.
    // Initialization is necessarily public in MCP, but telemetry must not
    // turn it into an unauthenticated database-write endpoint. Record the
    // optional client identity only for an authenticated key or operator.
    try {
      const apiKey = extractApiKey(req);
      const keyIsValid = apiKey ? (await validateApiKey(apiKey)).valid : false;
      if (isOperator(req) || keyIsValid) {
        const clientInfo = isRecord(params?.clientInfo) ? params.clientInfo : undefined;
        await recordMcpClientIdentity(
          ipHash(req),
          typeof clientInfo?.name === 'string' ? clientInfo.name.slice(0, 128) : undefined,
          typeof clientInfo?.version === 'string' ? clientInfo.version.slice(0, 64) : undefined,
        );
      }
    } catch { /* non-fatal telemetry must never block a handshake */ }

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
    const operator = isOperator(req);
    let profile: McpAccessProfile = operator ? 'operator' : 'public';
    if (!operator) {
      const apiKey = extractApiKey(req);
      if (!apiKey) return unauthorized(id);
      const keyCheck = await validateApiKey(apiKey);
      if (!keyCheck.valid) return unauthorized(id);
      profile = profileForApiKey(keyCheck.key?.plan);
    }
    const allTools = [
      ...TOOL_DEFINITIONS.map(t => ({ name: t.name, description: t.description, inputSchema: t.parameters })),
      ...EXTENSION_DEFINITIONS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    ];
    return NextResponse.json({
      jsonrpc: '2.0',
      result: { tools: allTools.filter(t => toolsForProfile(profile, [t.name]).length > 0) },
      id,
    });
  }

  if (method === 'tools/call') {
    // fix (2026-09-01): require a valid API key before dispatching ANY
    // tool. Previously this endpoint had zero caller authentication --
    // only the constitutional (CRS) content-risk scorer sat between an
    // anonymous request and full write access to this repo (patch_file),
    // CI/CD (dispatch_workflow), and the database (query_database), using
    // this project's own credentials. CRS scores whether a CALL looks
    // risky; it was never designed to answer whether a CALLER is
    // authorized, and conflating the two left this endpoint effectively
    // open to anyone who knew the URL. Checked BEFORE tool resolution so
    // an unauthenticated caller gets a uniform error regardless of which
    // tool they asked for, and before CRS or tool logic ever runs.
    const toolName = params?.name;
    const suppliedArgs = params?.arguments;
    if (typeof toolName !== 'string' || toolName.trim().length === 0
      || (suppliedArgs !== undefined && !isRecord(suppliedArgs))) {
      return invalidParams(id ?? null);
    }
    const args = suppliedArgs ?? {};
    if (args.session_id !== undefined && !validSessionId(args.session_id)) {
      return invalidParams(id ?? null, `session_id must be a non-empty string of at most ${MAX_SESSION_ID_LENGTH} characters`);
    }
    const operator = isOperator(req);
    let profile: McpAccessProfile = operator ? 'operator' : 'public';
    let ownerId = 'operator';
    let apiKey: string | null = null;
    if (!operator) {
      apiKey = extractApiKey(req);
      if (!apiKey) return unauthorized(id);
      // Validate first so malformed, unknown, and unauthorized tool names do
      // not debit a caller's quota. Consumption remains atomic below, after
      // all local admission checks have passed and before execution begins.
      const keyCheck = await validateApiKey(apiKey);
      if (!keyCheck.valid) return unauthorized(id);
      ownerId = String(keyCheck.key?.id ?? 'anonymous');
      profile = profileForApiKey(keyCheck.key?.plan);
    }

    // Capability filtering is enforced again at call time. Hiding a tool from
    // tools/list is not an authorization boundary by itself because clients
    // can still guess a tool name.
    if (!canCallTool(profile, toolName)) {
      return NextResponse.json({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Tool not found: ${toolName}` },
        id,
      });
    }
    const toolFn = resolveTool(toolName);

    if (!toolFn) {
      return NextResponse.json({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Tool not found: ${toolName}` },
        id,
      });
    }

    if (!operator && apiKey) {
      const consumption = await validateAndConsumeKey(apiKey);
      if (!consumption.valid) return unauthorized(id);
      // Use the atomically re-read key after consumption for ownership and
      // profile selection, so a concurrent revoke/plan change cannot retain
      // stale privileges from the preflight validation above.
      ownerId = String(consumption.key?.id ?? 'anonymous');
      profile = profileForApiKey(consumption.key?.plan);
      if (!canCallTool(profile, toolName)) return unauthorized(id);
    }

    try {
      const clientSessionId = (args.session_id as string | undefined)
        ?? `mcp-${new Date().toISOString().slice(0, 10)}-${ipHash(req)}`;
      // Public sessions are namespaced by API-key identity. A caller-supplied
      // session_id is only a label, never an authorization credential.
      const sessionId = profile === 'public' ? `${ownerId}:${clientSessionId}` : clientSessionId;
      const scopedArgs = profile === 'public'
        ? { ...args, session_id: sessionId }
        : args;

      // Constitutional authorization is the single dispatch boundary for
      // every MCP-exposed tool. Read-only results may be reused by the
      // executor's cache, but authorization is recomputed for every call.
      // Non-read tools are never cached and still pass through the same
      // constitutional decision point.
      // fix (2026-09-06): trajectory-aware dispatch. Plan-declaring/status/
      // clear tools always go through bare executeGovernedTool — they
      // manage trajectory state, so gating them BY a trajectory would be
      // circular. For every other tool: if this session has declared an
      // active (unlocked, incomplete) plan via declare_trajectory_plan,
      // route through executeGovernedTrajectoryAction instead — plan-level
      // scope/order/drift enforcement on top of, not instead of, the same
      // per-call constitutional authorization as before. Sessions that
      // never declare a plan are completely unaffected: falls straight
      // through to the original bare path.
      const TRAJECTORY_META_TOOLS = new Set(['declare_trajectory_plan', 'get_trajectory_status', 'clear_trajectory_plan']);
      const trajectoryState = TRAJECTORY_META_TOOLS.has(toolName) ? undefined : await getTrajectoryState(sessionId);

      if (trajectoryState && isTrajectoryActive(trajectoryState)) {
        const expected = trajectoryState.plan.actions[trajectoryState.currentStep];
        const attemptedAction: TrajectoryAction = {
          actionId: trajectoryActionId(toolName, trajectoryState.currentStep),
          toolName,
          declaredIntent: expected?.toolName === toolName ? expected.declaredIntent : `Undeclared call to ${toolName}`,
          risk: expected?.toolName === toolName ? expected.risk : 'destructive',
          target: expected?.target,
        };

        const execution = await executeGovernedTrajectoryAction(
          trajectoryState,
          attemptedAction,
          scopedArgs,
          toolFn,
          sessionId,
          args.task_context as string | undefined,
        );

        if (isTrajectoryActive(execution.state)) {
          await setTrajectoryState(sessionId, execution.state);
        } else {
          // Plan completed or locked — clear it so further calls in this
          // session fall back to ordinary per-call governance rather than
          // staying permanently gated by a finished or violated plan.
          await clearTrajectoryState(sessionId);
        }

        return NextResponse.json({
          jsonrpc: '2.0',
          result: { content: [{ type: 'text', text: execution.result }] },
          id,
        });
      }

      const result = await withDeadline(executeGovernedTool(
        toolName,
        scopedArgs,
        toolFn,
        sessionId,
        args.task_context as string | undefined,
      ), 30_000);

      return NextResponse.json({
        jsonrpc: '2.0',
        result: { content: [{ type: 'text', text: result }] },
        id,
      });
    } catch (e) {
      return NextResponse.json({
        jsonrpc: '2.0',
        error: { code: String(e).includes('timed out') ? -32002 : -32603, message: String(e).includes('timed out') ? 'Tool execution timed out' : 'Tool execution failed' },
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

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tool execution timed out')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
