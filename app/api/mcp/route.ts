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
import { bindGovernanceToolSession } from '@/lib/agents/governance_tool_session';
import type { TrajectoryAction } from '@/lib/agents/trajectory_governance';
import { getTrajectoryState, setTrajectoryState, clearTrajectoryState, claimTrajectoryState, compareAndSetTrajectoryState, lockTrajectoryState, isTrajectoryActive } from '@/lib/agents/trajectory_session_store';
import { getAutonomousRun } from '@/lib/agents/autonomous_run_supervisor';
import type { AutonomousRunContext } from '@/lib/agents/trajectory_executor';
import { validateApiKey, validateAndConsumeKey, consumeApiKeyById } from '@/lib/api_keys';
import { validateMcpSession } from '@/lib/mcp_sessions';
import { recordMcpClientIdentity, runZTrajMigrations } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate_limit';
import { canCallTool, isOperatorSecret, profileForApiKey, toolsForProfile, type McpAccessProfile } from '@/lib/lex_crs_agent/mcp_access';
import { getToolCapability, requireKnownToolCapability, type ToolCapability } from '@/lib/agents/tool_capability_registry';
import { interceptToolCall } from '@/lib/agents/tool_interceptor';
import { createGovernanceApprovalToken } from '@/lib/agents/tool_governance_gateway';
import { ensureCanonicalTrajectoryState } from '@/lib/agents/canonical_governance_state';
import { discoverExternalTool, governExternalAction, authorizeExternalAction, consumeExternalAction } from '@/lib/agents/external_capability_broker';
import type { ToolManifest } from '@/lib/agents/tool_capability_discovery';
import crypto from 'crypto';
import { negotiateMcpHandshakeVersion } from '@/lib/mcp_protocol';
import { MCP_RESOURCE } from '@/lib/mcp_oauth';

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
function extractApiKey(req: Request): string | null {
  const header = req.headers.get('x-lex-api-key');
  if (header) return header.trim();
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return null;
}

function extractSessionToken(req: Request): string | null {
  return req.headers.get('x-lex-session-token')?.trim() || null;
}

function isOperator(req: Request): boolean {
  return isOperatorSecret(req.headers.get('x-lex-operator-secret'));
}

function unauthorized(id: number | string | null | undefined) {
  return NextResponse.json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Unauthorized: valid API key or OAuth bearer token required' },
    id,
  }, {
    status: 401,
    headers: {
      'WWW-Authenticate': `Bearer resource_metadata="https://www.lexaureon.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="Authentication is required for this MCP operation"`,
    },
  });
}

const SERVER_INFO = {
  name:    'lex-crs-agent',
  version: '2.3.0',
};

const CAPABILITIES = { tools: {} };

type ToolHandler = (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;

function trajectoryRiskForCapability(capability: ToolCapability | undefined): TrajectoryAction['risk'] {
  if (capability === 'read') return 'read';
  if (capability === 'write') return 'write';
  if (capability === 'external' || capability === 'network' || capability === 'delegate') return 'external';
  return 'destructive';
}

const EXTERNAL_CAPABILITY_DEFINITIONS = [
  {
    name: 'discover_external_tool',
    description: 'Discover an external tool manifest and conservatively classify its capability. Discovery never grants execution authority.',
    inputSchema: {
      type: 'object',
      properties: {
        environment_id: { type: 'string' },
        manifest: { type: 'object' },
      },
      required: ['environment_id', 'manifest'],
    },
  },
  {
    name: 'govern_external_action',
    description: 'Run Lex governance over a discovered external tool action. Read-only actions may be auto-authorized; consequential actions require an exact action-bound approval token.',
    inputSchema: {
      type: 'object',
      properties: {
        environment_id: { type: 'string' },
        manifest: { type: 'object' },
        action_args: { type: 'object' },
        session_id: { type: 'string' },
        task_context: { type: 'string' },
        approval_token: { type: 'string' },
      },
      required: ['environment_id', 'manifest', 'action_args'],
    },
  },
  {
    name: 'consume_external_action',
    description: 'Final execution gate for a client-side external tool adapter. Consumes the exact single-use Lex approval immediately before the adapter executes.',
    inputSchema: {
      type: 'object',
      properties: {
        environment_id: { type: 'string' },
        manifest: { type: 'object' },
        action_args: { type: 'object' },
        session_id: { type: 'string' },
        approval_token: { type: 'string' },
      },
      required: ['environment_id', 'manifest', 'action_args', 'approval_token'],
    },
  },
  {
    name: 'authorize_external_action',
    description: 'Operator-only control-plane operation. Reviews an exact discovered external action and issues a short-lived action-bound approval permit.',
    inputSchema: {
      type: 'object',
      properties: {
        environment_id: { type: 'string' },
        manifest: { type: 'object' },
        action_args: { type: 'object' },
        session_id: { type: 'string' },
        task_context: { type: 'string' },
        target_actor_id: { type: 'string', description: 'Authenticated client actor ID that the permit will be bound to.' },
      },
      required: ['environment_id', 'manifest', 'action_args', 'target_actor_id'],
    },
  },
] as const;

const EXTENSION_DEFINITIONS = [PATCH_FILE_DEFINITION] as const;

/**
 * Extension handlers are kept PURE here. The MCP dispatcher applies the
 * constitutional executor uniformly to every exposed tool, including
 * patch_file. This prevents an extension from accidentally bypassing the
 * same authorization boundary used by the main registry.
 */
const EXTENSION_REGISTRY: Record<string, ToolHandler> = {
  patch_file: (args, signal) => patch_file(
    args as unknown as Parameters<typeof patch_file>[0],
    signal,
  ),
};

function servedTools() {
  return [
    ...TOOL_DEFINITIONS.map(t => ({ name: t.name, description: t.description, inputSchema: t.parameters, securitySchemes: [{ type: 'oauth2', scopes: ['mcp'] }] })),
    ...EXTENSION_DEFINITIONS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, securitySchemes: [{ type: 'oauth2', scopes: ['mcp'] }] })),
    ...EXTERNAL_CAPABILITY_DEFINITIONS.map(t => ({ ...t, securitySchemes: [{ type: 'oauth2', scopes: ['mcp'] }] })),
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
const MAX_MCP_BODY_BYTES = 128 * 1024;
const MCP_REQUESTS_PER_MINUTE = 60;

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

function requestTooLarge() {
  return NextResponse.json({
    jsonrpc: '2.0',
    error: { code: -32010, message: 'Request body too large' },
    id: null,
  }, { status: 413 });
}

function rateLimited(retryAfter: number, storageError = false) {
  return NextResponse.json({
    jsonrpc: '2.0',
    error: {
      code: storageError ? -32003 : -32029,
      message: storageError ? 'MCP admission temporarily unavailable' : 'Too many MCP requests',
    },
    id: null,
  }, {
    status: storageError ? 503 : 429,
    headers: {
      'Retry-After': String(retryAfter),
      'X-RateLimit-Limit': String(MCP_REQUESTS_PER_MINUTE),
      'X-RateLimit-Remaining': '0',
    },
  });
}

export async function POST(req: Request) {
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_MCP_BODY_BYTES) {
    return requestTooLarge();
  }

  // MCP is a high-impact endpoint, including its public initialize method.
  // Limit it before parsing JSON or touching key/tool state so malformed-call
  // floods cannot turn validation, telemetry, or quota storage into an
  // amplification vector. The shared Turso limiter fails closed on outage.
  const rate = await checkRateLimit(
    `mcp:request:${ipHash(req)}`,
    MCP_REQUESTS_PER_MINUTE,
    60,
  );
  if (!rate.allowed) return rateLimited(rate.retryAfter, rate.storageError);

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
      const sessionToken = extractSessionToken(req);
      const keyIsValid = apiKey ? (await validateApiKey(apiKey)).valid
        : sessionToken ? (await validateMcpSession(sessionToken)).valid : false;
      if (isOperator(req) || keyIsValid) {
        const clientInfo = isRecord(params?.clientInfo) ? params.clientInfo : undefined;
        await recordMcpClientIdentity(
          ipHash(req),
          typeof clientInfo?.name === 'string' ? clientInfo.name.slice(0, 128) : undefined,
          typeof clientInfo?.version === 'string' ? clientInfo.version.slice(0, 64) : undefined,
        );
      }
    } catch { /* non-fatal telemetry must never block a handshake */ }

    const requestedProtocolVersion = params?.protocolVersion;
    const protocolVersion = negotiateMcpHandshakeVersion(requestedProtocolVersion);

    return NextResponse.json({
      jsonrpc: '2.0',
      result: {
        protocolVersion,
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
    // Tool discovery is intentionally public. Authentication belongs at the
    // execution boundary, not the catalog boundary: ChatGPT and other MCP
    // clients must be able to complete discovery before a user credential is
    // available. No tool is executed by this branch and no secret is exposed.
    const operator = isOperator(req);
    let profile: McpAccessProfile = 'public';
    if (operator) {
      profile = 'operator';
    } else {
      const sessionToken = extractSessionToken(req);
      if (sessionToken) {
        const session = await validateMcpSession(sessionToken);
        if (session.valid) profile = profileForApiKey(session.key.plan);
      } else {
        const apiKey = extractApiKey(req);
        if (apiKey) {
          const keyCheck = await validateApiKey(apiKey);
          if (keyCheck.valid) profile = profileForApiKey(keyCheck.key?.plan);
        }
      }
    }
    const allTools = [
      ...TOOL_DEFINITIONS.map(t => ({ name: t.name, description: t.description, inputSchema: t.parameters, securitySchemes: [{ type: 'oauth2', scopes: ['mcp'] }] })),
      ...EXTENSION_DEFINITIONS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, securitySchemes: [{ type: 'oauth2', scopes: ['mcp'] }] })),
      ...EXTERNAL_CAPABILITY_DEFINITIONS.map(t => ({ ...t, securitySchemes: [{ type: 'oauth2', scopes: ['mcp'] }] })),
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
    let actorId = 'operator';
    let apiKey: string | null = null;
    let sessionKeyId: string | null = null;
    if (!operator) {
      const sessionToken = extractSessionToken(req);
      if (sessionToken) {
        const session = await validateMcpSession(sessionToken);
        if (!session.valid) return unauthorized(id);
        sessionKeyId = session.key.id;
        ownerId = session.key.id;
        actorId = `api_key:${ownerId}`;
        profile = profileForApiKey(session.key.plan);
      } else {
        apiKey = extractApiKey(req);
        if (!apiKey) return unauthorized(id);
        // Validate first so malformed, unknown, and unauthorized tool names do
        // not debit a caller's quota. Consumption remains atomic below, after
        // all local admission checks have passed and before execution begins.
        const keyCheck = await validateApiKey(apiKey);
        if (!keyCheck.valid) return unauthorized(id);
        ownerId = String(keyCheck.key?.id ?? 'anonymous');
        actorId = `api_key:${ownerId}`;
        profile = profileForApiKey(keyCheck.key?.plan);
      }
    }

    // The authorization endpoint is an operator-only control-plane action.
    // It issues a short-lived token bound to one exact consequential action.
    // It is intentionally handled before ordinary tool execution so an
    // approval token cannot be self-issued by the governed tool it authorizes.
    if (toolName === 'authorize_tool_action') {
      if (!operator) return unauthorized(id);
      const requestedTool = typeof args.tool_name === 'string' ? args.tool_name.trim() : '';
      const requestedArgs = isRecord(args.arguments) ? args.arguments : null;
      const requestedSession = typeof args.session_id === 'string' && args.session_id.trim()
        ? args.session_id.trim()
        : `operator-${new Date().toISOString().slice(0, 10)}-${ipHash(req)}`;
      const taskContext = typeof args.task_context === 'string'
        ? args.task_context.slice(0, 4096)
        : `Operator authorization for ${requestedTool}`;
      if (!requestedTool || !requestedArgs) {
        return invalidParams(id ?? null, 'tool_name and arguments are required');
      }
      if (requestedTool === 'authorize_tool_action') {
        return invalidParams(id ?? null, 'authorize_tool_action cannot authorize itself');
      }
      let capability;
      try {
        capability = requireKnownToolCapability(requestedTool);
      } catch {
        return NextResponse.json({
          jsonrpc: '2.0',
          error: { code: -32030, message: 'Cannot issue authorization for an unregistered tool capability' },
          id,
        });
      }
      if (!capability.approvalRequired) {
        return invalidParams(id ?? null, 'Approval tokens are only issued for consequential capabilities');
      }
      try {
        await runZTrajMigrations();
        if (!(await ensureCanonicalTrajectoryState(requestedSession))) {
          return NextResponse.json({
            jsonrpc: '2.0',
            error: { code: -32003, message: 'Canonical governance state temporarily unavailable' },
            id,
          }, { status: 503 });
        }
      } catch {
        return NextResponse.json({
          jsonrpc: '2.0',
          error: { code: -32003, message: 'Governance storage temporarily unavailable' },
          id,
        }, { status: 503 });
      }
      const review = await interceptToolCall({
        id: crypto.randomUUID(),
        name: requestedTool,
        arguments: requestedArgs,
        session_id: requestedSession,
        actor_id: 'operator',
        task_context: taskContext,
      });
      if (!review.approved) {
        return NextResponse.json({
          jsonrpc: '2.0',
          result: {
            approved: false,
            decision: review.decision,
            reason: review.reason,
            receipt_id: review.receipt_id ?? null,
          },
          id,
        });
      }
      const approvalId = crypto.randomUUID();
      let approvalToken: string;
      try {
        approvalToken = createGovernanceApprovalToken({
          actorId: 'operator',
          sessionId: requestedSession,
          toolName: requestedTool,
          args: requestedArgs,
          approvalId,
        });
      } catch {
        return NextResponse.json({
          jsonrpc: '2.0',
          error: { code: -32003, message: 'Approval signing is not configured; authorization denied' },
          id,
        }, { status: 503 });
      }
      return NextResponse.json({
        jsonrpc: '2.0',
        result: {
          approved: true,
          decision: 'approval_issued',
          tool_name: requestedTool,
          approval_id: approvalId,
          expires_in_seconds: 15 * 60,
          approval_token: approvalToken,
          receipt_id: review.receipt_id ?? null,
          warning: 'Treat this token as sensitive. It is single-use and bound to the exact tool and arguments.',
        },
        id,
      });
    }

    // External capability control-plane operations deliberately sit outside the
    // static internal tool registry. They govern client-side adapters rather than
    // granting Lex server-side credentials or arbitrary remote execution.
    if (toolName === 'discover_external_tool' || toolName === 'govern_external_action' || toolName === 'consume_external_action' || toolName === 'authorize_external_action') {
      if (toolName === 'authorize_external_action' && !operator) return unauthorized(id);
      if (!operator && (apiKey || sessionKeyId)) {
        const consumption = apiKey ? await validateAndConsumeKey(apiKey) : await consumeApiKeyById(sessionKeyId!);
        if (!consumption.valid) return unauthorized(id);
        ownerId = String(consumption.key?.id ?? 'anonymous');
        actorId = `api_key:${ownerId}`;
        profile = profileForApiKey(consumption.key?.plan);
      }
      const environmentId = typeof args.environment_id === 'string' ? args.environment_id.trim() : '';
      const manifest = isRecord(args.manifest) ? args.manifest as unknown as ToolManifest : null;
      const actionArgs = isRecord(args.action_args) ? args.action_args : {};
      const sessionId = typeof args.session_id === 'string' && args.session_id.trim()
        ? args.session_id.trim()
        : `mcp-${new Date().toISOString().slice(0, 10)}-${ipHash(req)}`;
      if (!environmentId || !manifest || typeof manifest.name !== 'string' || !manifest.name.trim()) {
        return invalidParams(id ?? null, 'environment_id and manifest.name are required');
      }
      try {
        if (toolName === 'discover_external_tool') {
          const capability = await discoverExternalTool(environmentId, manifest);
          return NextResponse.json({ jsonrpc: '2.0', result: {
            discovered: true,
            execution_authorized: false,
            capability,
            security_rule: 'Discovery is advisory and never grants execution authority.',
          }, id });
        }
        if (toolName === 'govern_external_action') {
          const result = await governExternalAction({
            environmentId, manifest, actionArgs, sessionId,
            actorId,
            approvalToken: typeof args.approval_token === 'string' ? args.approval_token : undefined,
            taskContext: typeof args.task_context === 'string' ? args.task_context.slice(0, 4096) : undefined,
          });
          return NextResponse.json({ jsonrpc: '2.0', result, id });
        }
        if (toolName === 'authorize_external_action') {
          const targetActorId = typeof args.target_actor_id === 'string' ? args.target_actor_id.trim() : '';
          if (!targetActorId) return invalidParams(id ?? null, 'target_actor_id is required for operator authorization');
          const result = await authorizeExternalAction({
            environmentId, manifest, actionArgs, sessionId, actorId: targetActorId,
            taskContext: typeof args.task_context === 'string' ? args.task_context.slice(0, 4096) : undefined,
          });
          return NextResponse.json({ jsonrpc: '2.0', result, id });
        }
        const approvalToken = typeof args.approval_token === 'string' ? args.approval_token : '';
        if (!approvalToken) return invalidParams(id ?? null, 'approval_token is required');
        const result = await consumeExternalAction({ environmentId, manifest, actionArgs, sessionId, actorId, approvalToken });
        return NextResponse.json({ jsonrpc: '2.0', result: {
          ...result,
          execution_may_begin: result.granted,
          warning: result.granted
            ? 'Lex has granted this exact single-use action. The client adapter must execute only the exact governed action and emit its own result/audit event.'
            : undefined,
        }, id });
      } catch (error) {
        return NextResponse.json({ jsonrpc: '2.0', error: {
          code: -32031,
          message: error instanceof Error ? error.message : 'External capability governance failed closed',
        }, id }, { status: 400 });
      }
    }

    // Reference-monitor admission happens at the MCP transport boundary too.
    // A guessed or dynamically invented tool name must not be treated as a
    // harmless "not found" case or allowed to reach any extension resolver.
    // Capability is explicit and fail-closed; execution applies the same
    // check again inside executeGovernedTool for defense in depth.
    try {
      requireKnownToolCapability(toolName);
    } catch {
      // Discovery is advisory only. It can inform registration workflows, but
      // it must never become an authorization source at the execution boundary.
      // A tool is executable only after explicit capability registration.
      return NextResponse.json({
        jsonrpc: '2.0',
        error: {
          code: -32030,
          message: 'Tool capability is not explicitly registered for this environment; execution denied by the Lex reference monitor',
        },
        id,
      });
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

    if (!operator && (apiKey || sessionKeyId)) {
      const consumption = apiKey ? await validateAndConsumeKey(apiKey) : await consumeApiKeyById(sessionKeyId!);
      if (!consumption.valid) return unauthorized(id);
      // Use the atomically re-read key after consumption for ownership and
      // profile selection, so a concurrent revoke/plan change cannot retain
      // stale privileges from the preflight validation above.
      ownerId = String(consumption.key?.id ?? 'anonymous');
      actorId = `api_key:${ownerId}`;
      profile = profileForApiKey(consumption.key?.plan);
      if (!canCallTool(profile, toolName)) return unauthorized(id);
    }

    try {
      await runZTrajMigrations();
      const clientSessionId = (args.session_id as string | undefined)
        ?? `mcp-${new Date().toISOString().slice(0, 10)}-${ipHash(req)}`;
      const sessionId = profile === 'public' ? `${ownerId}:${clientSessionId}` : clientSessionId;
      if (!(await ensureCanonicalTrajectoryState(sessionId))) {
        return NextResponse.json({
          jsonrpc: '2.0',
          error: { code: -32003, message: 'Canonical governance state temporarily unavailable' },
          id,
        }, { status: 503 });
      }
    } catch {
      return NextResponse.json({
        jsonrpc: '2.0',
        error: { code: -32003, message: 'Governance storage temporarily unavailable' },
        id,
      }, { status: 503 });
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
      const runId = typeof args.run_id === 'string' ? args.run_id : undefined;
      const leaseToken = typeof args.lease_token === 'string' ? args.lease_token : undefined;
      const idempotencyKey = typeof args.idempotency_key === 'string' ? args.idempotency_key : undefined;
      const hasRunMetadata = runId !== undefined || leaseToken !== undefined || idempotencyKey !== undefined;
      if (hasRunMetadata && (!runId || !leaseToken || !idempotencyKey)) {
        return invalidParams(id ?? null, 'run_id, lease_token, and idempotency_key are required together');
      }
      const baseToolArgs = hasRunMetadata
        ? Object.fromEntries(Object.entries(scopedArgs).filter(([key]) =>
          !['run_id', 'lease_token', 'idempotency_key', 'risk_cost'].includes(key)))
        : scopedArgs;
      const toolArgs = bindGovernanceToolSession(toolName, baseToolArgs, sessionId);
      let runContext: AutonomousRunContext | undefined;
      if (runId && leaseToken && idempotencyKey) {
        const run = await getAutonomousRun(runId);
        if (!run || run.sessionId !== sessionId) {
          return NextResponse.json({ jsonrpc: '2.0', error: { code: -32041, message: 'Autonomous run not found for this session' }, id });
        }
        runContext = {
          lease: { runId, leaseToken },
          idempotencyKey,
          expectedCheckpointVersion: run.checkpointVersion,
          riskCost: typeof args.risk_cost === 'number' ? args.risk_cost : 1,
        };
      }

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
      if (runContext && (!trajectoryState || !isTrajectoryActive(trajectoryState))) {
        return NextResponse.json({ jsonrpc: '2.0', error: { code: -32042, message: 'Long-horizon actions require an active trajectory checkpoint' }, id });
      }

      if (trajectoryState?.locked) {
        return NextResponse.json({
          jsonrpc: '2.0',
          result: {
            content: [{ type: 'text', text: `Trajectory denied: ${trajectoryState.lockReason ?? 'trajectory_locked'}` }],
            trajectory: {
              decision: 'deny', reason: trajectoryState.lockReason ?? 'trajectory_locked',
              plan_id: trajectoryState.plan.planId, session_id: sessionId,
              step_before: trajectoryState.currentStep, step_after: trajectoryState.currentStep,
              drift_score: trajectoryState.driftScore, execution_status: 'not_executed', receipt_id: null,
            },
          },
          id,
        });
      }

      if (trajectoryState && isTrajectoryActive(trajectoryState)) {
        const claimedState = await claimTrajectoryState(sessionId, trajectoryState.version ?? 0);
        if (!claimedState) {
          return NextResponse.json({
            jsonrpc: '2.0',
            error: { code: -32043, message: 'Trajectory step is already in flight or was advanced by another request; retry after reconciliation' },
            id,
          }, { status: 409 });
        }
        // The claim is persisted before the side effect. A concurrent request
        // therefore cannot execute this same declared step a second time.
        const claimedVersion = claimedState.version ?? 0;
        const expected = claimedState.plan.actions[claimedState.currentStep];
        const attemptedCapability = getToolCapability(toolName);
        const attemptedAction: TrajectoryAction = {
          actionId: trajectoryActionId(toolName, claimedState.currentStep),
          toolName,
          declaredIntent: expected?.toolName === toolName ? expected.declaredIntent : `Undeclared call to ${toolName}`,
          risk: expected?.toolName === toolName ? expected.risk : trajectoryRiskForCapability(attemptedCapability?.capability),
          target: expected?.target,
        };

        const trajectoryController = new AbortController();
        const trajectoryOutcome = await withDeadline(executeGovernedTrajectoryAction(
          claimedState,
          attemptedAction,
          toolArgs,
          toolFn,
          sessionId,
          args.task_context as string | undefined,
          runContext,
          actorId,
          trajectoryController.signal,
          ownerId,
        ), 30_000, trajectoryController);

        if (trajectoryOutcome.timedOut) {
          const pausedState = await lockTrajectoryState(sessionId, 'execution_unknown_after_deadline');
          return NextResponse.json({
            jsonrpc: '2.0',
            result: { content: [{
              type: 'text',
              text: 'EXECUTION_STATUS=unknown_after_deadline. Trajectory is locked fail-closed; verify its state and receipt before retrying.',
            }], trajectory: {
              decision: 'paused', reason: 'execution_unknown_after_deadline', plan_id: claimedState.plan.planId,
              session_id: sessionId, step_before: claimedState.currentStep,
              step_after: pausedState?.currentStep ?? claimedState.currentStep,
              drift_score: pausedState?.driftScore ?? claimedState.driftScore,
              execution_status: 'unknown',
            } },
            id,
          });
        }
        const execution = trajectoryOutcome.value;

        if (isTrajectoryActive(execution.state)) {
          const committed = await compareAndSetTrajectoryState(sessionId, execution.state, claimedVersion);
          if (!committed) {
            return NextResponse.json({
              jsonrpc: '2.0',
              result: { content: [{ type: 'text', text: 'TRAJECTORY PAUSED: state changed during execution; verify the receipt before retrying.' }] },
              id,
            });
          }
        } else {
          // Plan completed or locked — clear it so further calls in this
          // session fall back to ordinary per-call governance rather than
          // staying permanently gated by a finished or violated plan.
          await clearTrajectoryState(sessionId);
        }

        return NextResponse.json({
          jsonrpc: '2.0',
          result: {
            content: [{ type: 'text', text: execution.result }],
            trajectory: {
              decision: execution.trajectory.decision,
              reason: execution.trajectory.reason,
              plan_id: execution.trajectory.planId,
              session_id: execution.trajectory.sessionId,
              step_before: execution.trajectory.stepBefore,
              step_after: execution.trajectory.stepAfter,
              drift_score: execution.trajectory.driftScore,
              execution_status: execution.trajectory.executionStatus,
              receipt_id: execution.governance.receiptId ?? null,
            },
          },
          id,
        });
      }

      const controller = new AbortController();
      const outcome = await withDeadline(executeGovernedTool(
        toolName,
        toolArgs,
        toolFn,
        sessionId,
        args.task_context as string | undefined,
        actorId,
        controller.signal,
        ownerId,
      ), 30_000, controller);

      const result = outcome.timedOut
        ? 'EXECUTION_STATUS=unknown_after_deadline. Cancellation was requested, but the tool or remote system may already have completed the action. Verify its state and receipt before retrying.'
        : outcome.value;

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

async function withDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  controller: AbortController,
): Promise<{ timedOut: true } | { timedOut: false; value: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(value => ({ timedOut: false as const, value })),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ timedOut: true });
        }, timeoutMs);
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
    protocol: 'MCP legacy handshake (2024-11-05 through 2025-11-25)',
  });
}
