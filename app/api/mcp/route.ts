/**
 * MCP Server — Lex CRS Agent
 * Connect this to Claude at: https://lexaureon.com/api/mcp
 *
 * Implements the Model Context Protocol (JSON-RPC 2.0 over HTTP).
 * Exposes the Lex CRS Agent tool suite to any MCP-compatible client.
 */

import { NextResponse } from 'next/server';
import { TOOL_DEFINITIONS, TOOL_REGISTRY } from '@/lib/lex_crs_agent/tools';
import { PATCH_FILE_DEFINITION, patch_file, preview_patch_file } from '@/lib/lex_crs_agent/tools/patch_file';
import { executeGovernedTool, executeGovernedToolStructured } from '@/lib/agents/constitutional_tool_executor';
import { executeGovernedTrajectoryAction, trajectoryActionId } from '@/lib/agents/trajectory_executor';
import { bindGovernanceToolSession } from '@/lib/agents/governance_tool_session';
import type { TrajectoryAction } from '@/lib/agents/trajectory_governance';
import { getTrajectoryState, setTrajectoryState, clearTrajectoryState, claimTrajectoryState, compareAndSetTrajectoryState, lockTrajectoryState, isTrajectoryActive } from '@/lib/agents/trajectory_session_store';
import { getAutonomousRun } from '@/lib/agents/autonomous_run_supervisor';
import type { AutonomousRunContext } from '@/lib/agents/trajectory_executor';
import { validateApiKey, validateAndConsumeKey, consumeApiKeyById, getApiKeyById } from '@/lib/api_keys';
import { validateMcpSession } from '@/lib/mcp_sessions';
import { recordMcpClientIdentity, runZTrajMigrations } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate_limit';
import { canCallTool, isOperatorSecret, profileForApiKey, toolsForProfile, type McpAccessProfile } from '@/lib/lex_crs_agent/mcp_access';
import { getToolCapability, requireKnownToolCapability, type ToolCapability } from '@/lib/agents/tool_capability_registry';
import { interceptToolCall } from '@/lib/agents/tool_interceptor';
import { canonicalExecutionAllowed, ensureCanonicalTrajectoryState, readCanonicalGovernanceState } from '@/lib/agents/canonical_governance_state';
import { advanceRecoveryPlane, shouldAdvanceRecoveryPlane } from '@/lib/agents/recovery_runtime';
import { recordRecoveryCanaryEvidence } from '@/lib/agents/recovery_canary_evidence';
import { discoverExternalTool, governExternalAction, consumeExternalAction } from '@/lib/agents/external_capability_broker';
import type { ToolManifest } from '@/lib/agents/tool_capability_discovery';
import crypto from 'crypto';
import { negotiateMcpHandshakeVersion } from '@/lib/mcp_protocol';
import { resolveAccessToken } from '@/lib/mcp_oauth';
import { createApprovalRequest } from '@/lib/approval_requests';
import { env } from '@/lib/env';
import { CONSTITUTION } from '@/lib/constitution';

// fix (2026-08-24): short, non-reversible correlation key for a caller.
// Used for mcp_client_identity and rate limiting; it is deliberately NOT the
// governance-session identity because reverse proxies can vary the forwarded
// IP between calls from the same authenticated MCP client.
function ipHash(req: Request): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 12);
}

// Stateless MCP clients do not reliably send a session_id on every tools/call.
// Bind the fallback to the authenticated actor, not the transport IP, so a
// proxy hop change cannot split canary evidence from the consequential action.
// Explicit session_id values still take precedence and remain session-scoped.
function defaultMcpSessionId(actorId: string): string {
  const day = new Date().toISOString().slice(0, 10);
  const actorHash = crypto.createHash('sha256').update(actorId).digest('hex').slice(0, 12);
  return `mcp-${day}-${actorHash}`;
}

// Canonicalize all non-operator MCP sessions identically, including the
// explicit approval and external-action control planes. Private-test keys have
// operator capabilities but remain API-key identities and must be owner-scoped.
function canonicalMcpSessionId(ownerId: string, clientSessionId: string, operator: boolean): string {
  if (operator) return clientSessionId;
  const ownerSessionPrefix = `${ownerId}:`;
  return clientSessionId.startsWith(ownerSessionPrefix)
    ? clientSessionId
    : `${ownerSessionPrefix}${clientSessionId}`;
}

// fix (2026-09-01): reuses the exact header convention already documented
// in /api-docs for /api/lex/govern (x-lex-api-key, or Authorization:
// Bearer) rather than inventing a new one — same key system, same
// lib/api_keys.ts validation, now REQUIRED here rather than optional,
// since this endpoint's blast radius (repo write, CI dispatch, DB read)
// is categorically larger than a rate-limited text-governance call.
//
function extractApiKey(req: Request): string | null {
  // Keep x-api-key as a compatibility alias for older client configurations.
  const header = req.headers.get('x-lex-api-key') ?? req.headers.get('x-api-key');
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

/** Operator authority may come from the operator secret or an authenticated operator-profile identity. */
function hasOperatorAuthority(operatorSecretValid: boolean, profile: McpAccessProfile): boolean {
  return operatorSecretValid || profile === 'operator';
}

/** Canary evidence can affect write eligibility, so profile capabilities alone are insufficient. */
function isCanaryOwnerAllowed(ownerId: string): boolean {
  const allowedOwners = (env.LEX_CANARY_OWNER_IDS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  return ownerId !== '' && ownerId !== 'anonymous' && allowedOwners.includes(ownerId);
}

type McpCredentialPath = 'operator_secret' | 'session_token' | 'oauth_bearer' | 'api_key' | 'missing';

function credentialPathFor(req: Request): McpCredentialPath {
  if (isOperator(req)) return 'operator_secret';
  if (extractSessionToken(req)) return 'session_token';
  const key = extractApiKey(req);
  if (!key) return req.headers.has('x-lex-operator-secret') ? 'operator_secret' : 'missing';
  return key.startsWith('lex_at_') ? 'oauth_bearer' : 'api_key';
}

function logMcpAuth(toolName: string, credentialPath: McpCredentialPath, outcome: string, profile?: McpAccessProfile): void {
  // Never include credential values, tokens, headers, or request arguments in auth diagnostics.
  // Unknown caller-controlled names are not copied to logs: a malformed name must not become a credential exfiltration channel.
  const knownToolName = TOOL_DEFINITIONS.some(tool => tool.name === toolName)
    || EXTENSION_DEFINITIONS.some(tool => tool.name === toolName)
    || EXTERNAL_CAPABILITY_DEFINITIONS.some(tool => tool.name === toolName);
  console.info('[mcp-auth]', JSON.stringify({
    method: 'tools/call',
    tool_name: knownToolName ? toolName : '<unknown-tool>',
    credential_path: credentialPath,
    outcome,
    ...(profile ? { profile } : {}),
  }));
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

/**
 * ChatGPT's tool-level OAuth UX is triggered by an MCP error result carrying
 * _meta["mcp/www_authenticate"]. Keep the HTTP 401 challenge above for generic
 * MCP clients, but also emit the MCP-native challenge when a tool call arrives
 * without a usable credential. This lets ChatGPT launch OAuth instead of
 * surfacing a generic authentication failure.
 */
function oauthToolChallenge(id: number | string | null | undefined) {
  // Used by tools/call when a session token is invalid or no API/OAuth credential is supplied.
  // tools/list uses the HTTP 401 resource-metadata challenge instead.
  return NextResponse.json({
    jsonrpc: '2.0',
    result: {
      content: [{ type: 'text', text: 'Authentication required. Connect Lex Aureon and retry this tool call.' }],
      isError: true,
    },
    _meta: {
      'mcp/www_authenticate': [
        'Bearer resource_metadata="https://www.lexaureon.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="Authentication is required for this MCP operation"',
      ],
    },
    id,
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

function mcpToolResult(id: number | string | null | undefined, value: unknown) {
  // MCP structuredContent must be a JSON object. Most Lex tools return their
  // governed result as plain text, so wrap primitive/array results instead of
  // emitting structuredContent as a bare string that strict clients reject.
  const structuredContent = value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    ? value
    : { value };
  return NextResponse.json({
    jsonrpc: '2.0',
    result: {
      // MCP clients require every successful tools/call result to expose
      // content. Keep the structured value for clients that support it.
      content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
      structuredContent,
    },
    id,
  });
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
    description: 'Run Lex governance over a discovered external tool action. Read-only actions may be auto-authorized; for consequential actions, call authorize_external_action to create a pending human approval request, then consume the approved request ID immediately before the client adapter executes.',
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
    description: 'Final execution gate for a client-side external tool adapter. After a human approves the exact action in Lex, provide approval_request_id here; Lex consumes it once immediately before the adapter executes.',
    inputSchema: {
      type: 'object',
      properties: {
        environment_id: { type: 'string' },
        manifest: { type: 'object' },
        action_args: { type: 'object' },
        session_id: { type: 'string' },
        approval_token: { type: 'string' },
        approval_request_id: { type: 'string', description: 'One-time human-approved exact-action request ID from Lex /approvals.' },
      },
      required: ['environment_id', 'manifest', 'action_args'],
    },
  },
  {
    name: 'authorize_external_action',
    description: 'Create a pending human approval request for an exact discovered external action. The target actor must be the authenticated caller. Open approval_url for the one-tap review, then use the request ID with consume_external_action; this operation never executes the external action.',
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
  preview_patch_file: (args, signal) => preview_patch_file(args, signal),
};

function withApprovalRequestSchema(tool: { name: string; description: string; inputSchema: Record<string, unknown> }): { name: string; description: string; inputSchema: Record<string, unknown> } {
  const capability = getToolCapability(tool.name);
  if (!capability?.approvalRequired) return tool;
  const schema = tool.inputSchema;
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
  // The executor already supports one-time approval_request_id consumption.
  // Publish that supported field to MCP clients; otherwise strict clients
  // cannot resume the exact action after human approval.
  return {
    ...tool,
    inputSchema: {
      ...schema,
      properties: {
        ...properties,
        approval_request_id: {
          type: 'string',
          description: 'One-time human-approved exact-action request ID from Lex /approvals. Supply this with the unchanged original arguments after approval.',
        },
      },
    },
  };
}

function servedTools() {
  return [
    ...TOOL_DEFINITIONS.map(t => withApprovalRequestSchema({
      name: t.name, description: t.description, inputSchema: t.parameters as Record<string, unknown>,
    })),
    ...EXTENSION_DEFINITIONS.map(t => withApprovalRequestSchema({
      name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown>,
    })),
    ...EXTERNAL_CAPABILITY_DEFINITIONS,
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

// These inspection tools must not bootstrap or otherwise mutate the trajectory they inspect.
const NON_MUTATING_INSPECTION_TOOLS = new Set([
  'get_constitutional_state', 'get_recent_receipts', 'explain_denial',
  'read_file', 'read_directory', 'list_directory', 'list_files',
  'read_memory', 'search_memory', 'search_code', 'fetch_page', 'http_get',
  'get_file', 'read_json', 'parse_csv', 'cat', 'head', 'tail', 'grep',
  'find', 'ls', 'dir', 'glob', 'get_build_status', 'get_workflow_run',
  'get_workflow_log', 'get_vercel_logs', 'preview_patch_file',
  'check_github_token_scope', 'get_trajectory_status', 'run_recovery_canary',
  // A simulated plan is read-only with respect to canonical trajectory state.
  'simulate_agent_plan',
]);

export function isNonMutatingInspectionTool(toolName: string): boolean {
  return NON_MUTATING_INSPECTION_TOOLS.has(toolName);
}

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
    // Claude can otherwise treat a successful unauthenticated catalog request
    // as a completed connection and never launch OAuth. Require a valid
    // credential here so clients receive the standard 401 resource-metadata
    // challenge and can start sign-in before accepting the tool catalog.
    const operator = isOperator(req);
    let profile: McpAccessProfile = 'public';
    let authenticated = operator;
    if (operator) {
      profile = 'operator';
    } else {
      const sessionToken = extractSessionToken(req);
      if (sessionToken) {
        const session = await validateMcpSession(sessionToken);
        if (session.valid) {
          profile = profileForApiKey(session.key.plan);
          authenticated = true;
        }
      } else {
        const apiKey = extractApiKey(req);
        if (apiKey?.startsWith('lex_at_')) {
          const oauth = await resolveAccessToken(apiKey);
          if (oauth.valid) {
            const oauthKey = await getApiKeyById(oauth.keyId);
            if (oauthKey) {
              profile = profileForApiKey(oauthKey.plan);
              authenticated = true;
            }
          }
        } else if (apiKey) {
          const keyCheck = await validateApiKey(apiKey);
          if (keyCheck.valid) {
            profile = profileForApiKey(keyCheck.key?.plan);
            authenticated = true;
          }
        }
      }
    }
    if (!authenticated) return unauthorized(id);
    const allTools = servedTools();
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
    // Preview uses a separate read-only capability and a handler that is
    // restricted to this public repository and cannot commit.
    const dispatchToolName = toolName === 'patch_file' && args.dry_run === true
      ? 'preview_patch_file'
      : toolName;
    if (args.session_id !== undefined && !validSessionId(args.session_id)) {
      return invalidParams(id ?? null, `session_id must be a non-empty string of at most ${MAX_SESSION_ID_LENGTH} characters`);
    }
    const credentialPath = credentialPathFor(req);
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
        if (!session.valid) {
          logMcpAuth(toolName, credentialPath, 'rejected_invalid_session');
          return oauthToolChallenge(id);
        }
        sessionKeyId = session.key.id;
        ownerId = session.key.id;
        actorId = `api_key:${ownerId}`;
        profile = profileForApiKey(session.key.plan);
      } else {
        apiKey = extractApiKey(req);
        if (!apiKey) {
          logMcpAuth(
            toolName,
            credentialPath,
            credentialPath === 'operator_secret' ? 'rejected_invalid_operator_secret' : 'rejected_missing_credential',
          );
          return oauthToolChallenge(id);
        }

        // OAuth access tokens are distinct credentials from raw API keys.
        // Resolve the token to its backing key, then retain the existing atomic
        // per-key quota consumption and plan-based capability checks below.
        if (apiKey.startsWith('lex_at_')) {
          const oauth = await resolveAccessToken(apiKey);
          if (!oauth.valid) {
            logMcpAuth(toolName, credentialPath, 'rejected_invalid_oauth');
            return unauthorized(id);
          }
          const oauthKey = await getApiKeyById(oauth.keyId);
          if (!oauthKey) {
            logMcpAuth(toolName, credentialPath, 'rejected_missing_oauth_owner');
            return unauthorized(id);
          }
          sessionKeyId = oauth.keyId;
          apiKey = null;
          ownerId = String(oauthKey.id);
          actorId = `api_key:${ownerId}`;
          profile = profileForApiKey(oauthKey.plan);
        } else {
          // Validate first so malformed, unknown, and unauthorized tool names do
          // not debit a caller's quota. Consumption remains atomic below, after
          // all local admission checks have passed and before execution begins.
          const keyCheck = await validateApiKey(apiKey);
          if (!keyCheck.valid) {
            logMcpAuth(toolName, credentialPath, 'rejected_invalid_api_key');
            return unauthorized(id);
          }
          ownerId = String(keyCheck.key?.id ?? 'anonymous');
          actorId = `api_key:${ownerId}`;
          profile = profileForApiKey(keyCheck.key?.plan);
        }
      }
    }

    logMcpAuth(toolName, credentialPath, 'authenticated', profile);

    // The authorization endpoint creates a pending, exact-action request for
    // separate human approval. Tool visibility is not approval authority.
    if (toolName === 'authorize_tool_action') {
      if (!hasOperatorAuthority(operator, profile)) {
        logMcpAuth(toolName, credentialPath, 'rejected_operator_authority_required', profile);
        return unauthorized(id);
      }
      const requestedTool = typeof args.tool_name === 'string' ? args.tool_name.trim() : '';
      const requestedArgs = isRecord(args.arguments) ? args.arguments : null;
      // Resolve the requested label through the same owner-scoped session
      // canonicalizer used by ordinary and external MCP actions. Private-test
      // keys have operator capabilities but remain API-key identities.
      const requestedClientSession = typeof args.session_id === 'string' && args.session_id.trim()
        ? args.session_id.trim()
        : defaultMcpSessionId(actorId);
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
      // Private-test callers may request approval, but cannot grant it. Re-read
      // their identity and plan atomically before creating the pending request.
      if (!operator) {
        const consumption = apiKey
          ? await validateAndConsumeKey(apiKey)
          : sessionKeyId
            ? await consumeApiKeyById(sessionKeyId)
            : null;
        if (!consumption?.valid) {
          logMcpAuth(toolName, credentialPath, 'rejected_key_consumption', profile);
          return unauthorized(id);
        }
        ownerId = String(consumption.key?.id ?? 'anonymous');
        actorId = `api_key:${ownerId}`;
        profile = profileForApiKey(consumption.key?.plan);
        if (!hasOperatorAuthority(operator, profile)) return unauthorized(id);
      }
      // Match the canonical session used by ordinary tools/call dispatch.
      // Private-test credentials have operator capabilities, but they are not
      // operator-secret sessions and must retain owner-scoped session binding.
      const requestedSession = canonicalMcpSessionId(ownerId, requestedClientSession, operator);
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
      let authorizationCanonical = await readCanonicalGovernanceState({
        sessionId: requestedSession,
        actorId,
        capability: capability.capability,
        authorization: 'approval_required',
      });
      if (authorizationCanonical.available && shouldAdvanceRecoveryPlane(authorizationCanonical.state)) {
        await advanceRecoveryPlane(requestedSession);
        authorizationCanonical = await readCanonicalGovernanceState({
          sessionId: requestedSession,
          actorId,
          capability: capability.capability,
          authorization: 'approval_required',
        });
      }
      if (!authorizationCanonical.available) {
        return mcpToolResult(id, {
          approved: false,
          decision: 'DENIED_LOCKED',
          reason: authorizationCanonical.reason ?? 'Canonical governance state unavailable; no approval was created.',
          approval_created: false,
        });
      }
      const authorizationGate = canonicalExecutionAllowed(authorizationCanonical.state);
      if (!authorizationGate.allowed) {
        return mcpToolResult(id, {
          approved: false,
          decision: 'DENIED_BLOCKED',
          reason: authorizationGate.reason ?? 'Canonical governance state denied execution; no approval was created.',
          approval_created: false,
        });
      }
      const review = await interceptToolCall({
        id: crypto.randomUUID(),
        name: requestedTool,
        arguments: requestedArgs,
        session_id: requestedSession,
        actor_id: actorId,
        task_context: taskContext,
      });
      if (!review.approved) {
        return mcpToolResult(id, {
          approved: false,
          decision: review.decision,
          reason: review.reason,
          receipt_id: review.receipt_id ?? null,
        });
      }
      try {
        const pending = await createApprovalRequest({
          ownerId,
          sessionId: requestedSession,
          toolName: requestedTool,
          args: { ...requestedArgs, session_id: requestedSession },
        });
        return mcpToolResult(id, {
          status: 'approval_required',
          request_id: pending.requestId,
          tool_name: requestedTool,
          expires_at: new Date(pending.expiresAt).toISOString(),
          approval_url: new URL(`/approvals#${pending.requestId}`, env.NEXT_PUBLIC_SITE_URL).toString(),
          receipt_id: review.receipt_id ?? null,
          next_step: 'A human approver must review and approve this exact action. Then call the same tool with approval_request_id and unchanged arguments.',
        });
      } catch {
        return NextResponse.json({
          jsonrpc: '2.0',
          error: { code: -32003, message: 'Could not create a pending approval request; no action was authorized' },
          id,
        }, { status: 503 });
      }
    }

    // External capability control-plane operations deliberately sit outside the
    // static internal tool registry. They govern client-side adapters rather than
    // granting Lex server-side credentials or arbitrary remote execution.
    if (toolName === 'discover_external_tool' || toolName === 'govern_external_action' || toolName === 'consume_external_action' || toolName === 'authorize_external_action') {
      if (toolName === 'authorize_external_action' && !hasOperatorAuthority(operator, profile)) {
        logMcpAuth(toolName, credentialPath, 'rejected_operator_authority_required', profile);
        return unauthorized(id);
      }
      if (!operator && (apiKey || sessionKeyId)) {
        const consumption = apiKey ? await validateAndConsumeKey(apiKey) : await consumeApiKeyById(sessionKeyId!);
        if (!consumption.valid) {
          logMcpAuth(toolName, credentialPath, 'rejected_key_consumption', profile);
          return unauthorized(id);
        }
        ownerId = String(consumption.key?.id ?? 'anonymous');
        actorId = `api_key:${ownerId}`;
        profile = profileForApiKey(consumption.key?.plan);
        if (toolName === 'authorize_external_action' && !hasOperatorAuthority(operator, profile)) {
          logMcpAuth(toolName, credentialPath, 'rejected_operator_authority_required', profile);
          return unauthorized(id);
        }
      }
      const environmentId = typeof args.environment_id === 'string' ? args.environment_id.trim() : '';
      const manifest = isRecord(args.manifest) ? args.manifest as unknown as ToolManifest : null;
      const actionArgs = isRecord(args.action_args) ? args.action_args : {};
      const clientSessionId = typeof args.session_id === 'string' && args.session_id.trim()
        ? args.session_id.trim()
        : defaultMcpSessionId(actorId);
      const sessionId = canonicalMcpSessionId(ownerId, clientSessionId, operator);
      if (!environmentId || !manifest || typeof manifest.name !== 'string' || !manifest.name.trim()) {
        return invalidParams(id ?? null, 'environment_id and manifest.name are required');
      }
      if (toolName === 'authorize_external_action' || toolName === 'consume_external_action') {
        const externalCapability = toolName === 'consume_external_action' ? 'external' : 'identity';
        let canonical = await readCanonicalGovernanceState({
          sessionId,
          actorId,
          capability: externalCapability,
          authorization: toolName === 'consume_external_action' ? 'authorized' : 'approval_required',
        });
        if (canonical.available && shouldAdvanceRecoveryPlane(canonical.state)) {
          await advanceRecoveryPlane(sessionId);
          canonical = await readCanonicalGovernanceState({
            sessionId,
            actorId,
            capability: externalCapability,
            authorization: toolName === 'consume_external_action' ? 'authorized' : 'approval_required',
          });
        }
        if (!canonical.available) {
          return mcpToolResult(id, {
            status: 'denied', decision: 'DENIED_LOCKED', approval_created: false,
            reason: canonical.reason ?? 'Canonical governance state unavailable; no approval was created.',
          });
        }
        const preflight = canonicalExecutionAllowed(canonical.state);
        if (!preflight.allowed) {
          return mcpToolResult(id, {
            status: 'denied', decision: 'DENIED_BLOCKED', approval_created: false,
            reason: preflight.reason ?? 'Canonical governance state denied execution; no approval was created.',
          });
        }
      }
      try {
        if (toolName === 'discover_external_tool') {
          const capability = await discoverExternalTool(environmentId, manifest);
          return mcpToolResult(id, {
            discovered: true,
            execution_authorized: false,
            capability,
            security_rule: 'Discovery is advisory and never grants execution authority.',
          });
        }
        if (toolName === 'govern_external_action') {
          const result = await governExternalAction({
            environmentId, manifest, actionArgs, sessionId,
            actorId,
            approvalToken: typeof args.approval_token === 'string' ? args.approval_token : undefined,
            taskContext: typeof args.task_context === 'string' ? args.task_context.slice(0, 4096) : undefined,
          });
          return mcpToolResult(id, result);
        }
        if (toolName === 'authorize_external_action') {
          const targetActorId = typeof args.target_actor_id === 'string' ? args.target_actor_id.trim() : '';
          if (!targetActorId) return invalidParams(id ?? null, 'target_actor_id is required for operator authorization');
          if (targetActorId !== actorId) return invalidParams(id ?? null, 'target_actor_id must match the authenticated caller for a resumable approval request');
          const review = await governExternalAction({
            environmentId, manifest, actionArgs, sessionId, actorId,
            taskContext: typeof args.task_context === 'string' ? args.task_context.slice(0, 4096) : undefined,
          });
          if (!review.approved && review.decision !== 'approval_required') {
            return mcpToolResult(id, {
              status: 'denied', decision: review.decision, reason: review.reason,
              risk: review.risk, receipt_id: review.receiptId ?? null,
            });
          }
          if (!review.approvalRequired) return mcpToolResult(id, review);
          const pending = await createApprovalRequest({
            ownerId,
            sessionId,
            toolName: 'consume_external_action',
            args: { environment_id: environmentId, manifest, action_args: actionArgs, session_id: sessionId },
          });
          return mcpToolResult(id, {
            status: 'approval_required',
            request_id: pending.requestId,
            tool_name: manifest.name,
            risk: review.risk,
            expires_at: new Date(pending.expiresAt).toISOString(),
            approval_url: new URL(`/approvals#${pending.requestId}`, env.NEXT_PUBLIC_SITE_URL).toString(),
            receipt_id: review.receiptId ?? null,
            next_step: 'A human approver must review this exact external action. After approval, call consume_external_action with the same manifest and arguments plus approval_request_id. The client adapter must act only if granted is true.',
          });
        }
        const approvalToken = typeof args.approval_token === 'string' ? args.approval_token : undefined;
        const approvalRequestId = typeof args.approval_request_id === 'string' ? args.approval_request_id : undefined;
        if (!approvalToken && !approvalRequestId) {
          return invalidParams(id ?? null, 'approval_request_id is required after human approval; request it with request_approval for consume_external_action');
        }
        const result = await consumeExternalAction({
          environmentId, manifest, actionArgs, sessionId, actorId, ownerId,
          approvalToken, approvalRequestId,
        });
        return mcpToolResult(id, {
          ...result,
          execution_may_begin: result.granted,
          warning: result.granted
            ? 'Lex has granted this exact single-use action. The client adapter must execute only the exact governed action and emit its own result/audit event.'
            : undefined,
        });
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
      requireKnownToolCapability(dispatchToolName);
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
    if (!canCallTool(profile, dispatchToolName)) {
      return NextResponse.json({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Tool not found: ${toolName}` },
        id,
      });
    }
    const resolvedToolFn = resolveTool(dispatchToolName);

    if (!resolvedToolFn) {
      return NextResponse.json({
        jsonrpc: '2.0',
        error: { code: -32601, message: `Tool not found: ${toolName}` },
        id,
      });
    }
    let toolFn: ToolHandler = resolvedToolFn;

    if (!operator && (apiKey || sessionKeyId)) {
      const consumption = apiKey ? await validateAndConsumeKey(apiKey) : await consumeApiKeyById(sessionKeyId!);
      if (!consumption.valid) {
        logMcpAuth(toolName, credentialPath, 'rejected_key_consumption', profile);
        return unauthorized(id);
      }
      // Use the atomically re-read key after consumption for ownership and
      // profile selection, so a concurrent revoke/plan change cannot retain
      // stale privileges from the preflight validation above.
      ownerId = String(consumption.key?.id ?? 'anonymous');
      actorId = `api_key:${ownerId}`;
      profile = profileForApiKey(consumption.key?.plan);
      if (!canCallTool(profile, dispatchToolName)) return unauthorized(id);
    }

    const clientSessionId = (args.session_id as string | undefined)
      ?? defaultMcpSessionId(actorId);
    const ownerSessionPrefix = `${ownerId}:`;
    const diagnosticSessionTools = new Set([
      'get_constitutional_state', 'get_recent_receipts', 'explain_denial',
    ]);
    if (!operator && diagnosticSessionTools.has(dispatchToolName)
      && args.session_id !== undefined
      && !clientSessionId.startsWith(ownerSessionPrefix)) {
      return invalidParams(id ?? null, 'session_id must belong to the authenticated caller');
    }
    const sessionId = canonicalMcpSessionId(ownerId, clientSessionId, operator);
    try {
      await runZTrajMigrations();
      if (!NON_MUTATING_INSPECTION_TOOLS.has(dispatchToolName)
        && !(await ensureCanonicalTrajectoryState(sessionId))) {
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
      // Non-operator sessions are namespaced by authenticated API-key identity,
      // independent of plan/profile. A supplied label is never an authorization
      // credential; already-canonical own-prefix IDs are accepted without doubling.
      if (dispatchToolName === 'request_approval') {
        toolFn = async requestArgs => {
          const requestedTool = requestArgs.tool_name;
          const proposedArgs = requestArgs.arguments;
          if (typeof requestedTool !== 'string' || !isRecord(proposedArgs)) {
            return 'Error: tool_name and an arguments object are required.';
          }
          if (requestedTool === 'request_approval') return 'Error: request_approval cannot approve itself.';
          try { requireKnownToolCapability(requestedTool); } catch {
            return 'Error: the requested tool is not registered as a governed capability.';
          }
          if (!canCallTool(profile, requestedTool)) return 'Error: this caller is not authorized for the requested tool.';
          const rate = await checkRateLimit(`approval-request:${ownerId}`, 5, 60 * 60);
          if (rate.storageError) throw new Error('Approval request admission is unavailable.');
          if (!rate.allowed) return 'Error: approval request rate limit reached; try again later.';
          const exactArgs = { ...proposedArgs, session_id: sessionId };
          const created = await createApprovalRequest({ ownerId, sessionId, toolName: requestedTool, args: exactArgs });
          return JSON.stringify({
            request_id: created.requestId,
            expires_at: new Date(created.expiresAt).toISOString(),
            approval_url: new URL(`/approvals#${created.requestId}`, env.NEXT_PUBLIC_SITE_URL).toString(),
          });
        };
      }
      const scopedArgs = !operator
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
      const executionArgs = dispatchToolName === 'preview_patch_file'
        ? Object.fromEntries(Object.entries(baseToolArgs).filter(([key]) => key !== 'approval_token'))
        : baseToolArgs;
      const toolArgs = bindGovernanceToolSession(dispatchToolName, executionArgs, sessionId);
      const requestedCapability = getToolCapability(dispatchToolName);
      if (requestedCapability?.approvalRequired
        && args.approval_token === undefined
        && args.approval_request_id === undefined) {
        // Do the non-human governance work first. A human approval is useful
        // only after Lex establishes that this session is healthy enough to
        // reach the execution gate; otherwise we create an approval that can
        // never be consumed and force the user through avoidable friction.
        let canonical = await readCanonicalGovernanceState({
          sessionId,
          actorId,
          capability: requestedCapability.capability,
          authorization: 'approval_required',
        });
        if (canonical.available && shouldAdvanceRecoveryPlane(canonical.state)) {
          try {
            await advanceRecoveryPlane(sessionId);
            canonical = await readCanonicalGovernanceState({
              sessionId,
              actorId,
              capability: requestedCapability.capability,
              authorization: 'approval_required',
            });
          } catch {
            // The canonical read remains authoritative and fail-closed.
          }
        }
        if (!canonical.available) {
          return mcpToolResult(id, {
            status: 'denied',
            decision: 'DENIED_LOCKED',
            reason: canonical.reason ?? 'Canonical governance state unavailable; no approval was created.',
            approval_created: false,
          });
        }
        const preflight = canonicalExecutionAllowed(canonical.state);
        if (!preflight.allowed) {
          return mcpToolResult(id, {
            status: 'denied',
            decision: 'DENIED_BLOCKED',
            reason: preflight.reason ?? 'Canonical governance state denied execution; no approval was created.',
            recovery_state: canonical.state.recoveryState,
            M: canonical.state.M,
            n_stable: canonical.state.nStable,
            canary_passed: canonical.state.canaryPassed === true,
            approval_created: false,
            next_step: canonical.state.M >= 0.15 && canonical.state.nStable >= 3 && !canonical.state.canaryPassed
              ? 'Run the operator-only recovery canary for this exact session, then retry the action.'
              : 'Continue safe governed observations and retry after Lex reports a restorable state.',
          });
        }
        const configuredApprovalLimit = Number(env.LEX_APPROVAL_IMPLICIT_LIMIT ?? '20');
        const approvalLimit = Number.isSafeInteger(configuredApprovalLimit) && configuredApprovalLimit > 0
          ? Math.min(configuredApprovalLimit, 1000)
          : 20;
        const approvalRate = await checkRateLimit(`approval-implicit:${ownerId}`, approvalLimit, 3600);
        if (approvalRate.storageError) {
          return NextResponse.json({
            jsonrpc: '2.0',
            error: { code: -32003, message: 'Approval admission temporarily unavailable; no request was created' },
            id,
          }, { status: 503 });
        }
        if (!approvalRate.allowed) {
          return NextResponse.json({
            jsonrpc: '2.0',
            error: { code: -32029, message: 'Implicit approval request rate limit reached; no request was created' },
            id,
          }, { status: 429, headers: { 'Retry-After': String(approvalRate.retryAfter) } });
        }
        try {
          const pending = await createApprovalRequest({
            ownerId,
            sessionId,
            toolName: dispatchToolName,
            args: toolArgs,
          });
          return mcpToolResult(id, {
            status: 'approval_required',
            request_id: pending.requestId,
            tool_name: dispatchToolName,
            expires_at: new Date(pending.expiresAt).toISOString(),
            approval_url: new URL(`/approvals#${pending.requestId}`, env.NEXT_PUBLIC_SITE_URL).toString(),
            recovery_state: canonical.state.recoveryState,
            M: canonical.state.M,
            n_stable: canonical.state.nStable,
            canary_passed: canonical.state.canaryPassed === true,
            next_step: 'A human approver must review this exact action. After approval, retry the same tool with approval_request_id and unchanged arguments.',
          });
        } catch {
          return NextResponse.json({
            jsonrpc: '2.0',
            error: { code: -32003, message: 'Could not create a pending approval request; no action was started' },
            id,
          }, { status: 503 });
        }
      }
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
      // Recovery pulses mutate canonical trajectory state, so authorization must
      // be checked before trajectory-plan dispatch can execute any handler.
      if ((dispatchToolName === 'run_recovery_canary' || dispatchToolName === 'advance_recovery_plane') && !operator && !isCanaryOwnerAllowed(ownerId)) {
        logMcpAuth(toolName, credentialPath, 'rejected_operator_authority_required', profile);
        return unauthorized(id);
      }
      const TRAJECTORY_META_TOOLS = new Set(['declare_trajectory_plan', 'get_trajectory_status', 'clear_trajectory_plan', 'request_approval']);
      // Diagnostics must remain reachable when a plan is stale, locked, or
      // out of sequence. They still pass through executeGovernedTool below,
      // so authentication, capability, and constitutional checks are intact;
      // they simply do not consume or require a plan step.
      const TRAJECTORY_DIAGNOSTIC_TOOLS = new Set([
        'get_constitutional_state', 'get_recent_receipts', 'explain_denial', 'preview_patch_file', 'run_recovery_canary', 'advance_recovery_plane',
      ]);
      const trajectoryBypass = TRAJECTORY_META_TOOLS.has(toolName)
        || TRAJECTORY_DIAGNOSTIC_TOOLS.has(dispatchToolName);
      const trajectoryState = trajectoryBypass ? undefined : await getTrajectoryState(sessionId);
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
        const attemptedCapability = getToolCapability(dispatchToolName);
        const attemptedAction: TrajectoryAction = {
          actionId: trajectoryActionId(dispatchToolName, claimedState.currentStep),
          toolName: dispatchToolName,
          declaredIntent: expected?.toolName === dispatchToolName ? expected.declaredIntent : `Undeclared call to ${dispatchToolName}`,
          risk: expected?.toolName === dispatchToolName ? expected.risk : trajectoryRiskForCapability(attemptedCapability?.capability),
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

      if ((dispatchToolName === 'run_recovery_canary' || dispatchToolName === 'advance_recovery_plane') && !operator && !isCanaryOwnerAllowed(ownerId)) {
        logMcpAuth(toolName, credentialPath, 'rejected_operator_authority_required', profile);
        return unauthorized(id);
      }
      if (dispatchToolName === 'run_recovery_canary') {
        let rawProbeResult: string | undefined;
        const trackedCanaryHandler: ToolHandler = async (handlerArgs, signal) => {
          rawProbeResult = await toolFn(handlerArgs, signal);
          return rawProbeResult;
        };
        const controller = new AbortController();
        const outcome = await withDeadline(executeGovernedToolStructured(
          dispatchToolName,
          toolArgs,
          trackedCanaryHandler,
          sessionId,
          args.task_context as string | undefined,
          actorId,
          controller.signal,
          ownerId,
          ownerId,
        ), 30_000, controller);

        if (outcome.timedOut) {
          return mcpToolResult(id, {
            execution_status: 'unknown_after_deadline',
            evidence_persisted: false,
            message: 'The canary result is unknown; no recovery evidence was recorded. Inspect the governed receipt and retry only after confirming the probe outcome.',
          });
        }

        const execution = outcome.value;
        let probe: Record<string, unknown> | null = null;
        try {
          const parsed = JSON.parse(rawProbeResult ?? '') as unknown;
          if (isRecord(parsed)) probe = parsed;
        } catch {
          probe = null;
        }

        let evidencePersisted = false;
        let evidenceStatus: 'passed' | 'failed' | 'not_recorded' = 'not_recorded';
        let evidenceReason = typeof probe?.reason === 'string' ? probe.reason : undefined;
        const hasSnapshot = Boolean(
          probe &&
          probe.session_id === sessionId &&
          typeof probe.state_fingerprint === 'string' &&
          /^[a-f0-9]{64}$/.test(probe.state_fingerprint) &&
          typeof probe.state_version === 'string' &&
          typeof probe.trajectory_updated_at === 'string' &&
          typeof probe.C === 'number' && Number.isFinite(probe.C) &&
          typeof probe.R === 'number' && Number.isFinite(probe.R) &&
          typeof probe.S === 'number' && Number.isFinite(probe.S) &&
          typeof probe.n_stable === 'number' && Number.isFinite(probe.n_stable) &&
          typeof probe.sigma_viol === 'number' && Number.isFinite(probe.sigma_viol)
        );

        if (
          hasSnapshot &&
          (probe?.status === 'passed' || probe?.status === 'failed') &&
          execution.receiptId
        ) {
          const fingerprint = String(probe.state_fingerprint);
          const current = await readCanonicalGovernanceState({
            sessionId,
            actorId,
            capability: 'read',
          });
          const invariantMode = process.env.CANARY_MODE === 'invariant';
          // Every canary mode must bind evidence to the state that was actually probed.
          // Invariant mode adds bounded validity checks; it must not waive snapshot identity.
          const snapshotStillCurrent = current.available
            && current.state.stateFingerprint === fingerprint
            && (!invariantMode || (
              current.state.version === String(probe.state_version)
              && current.state.M >= CONSTITUTION.TAU_RECOVERY
              && current.state.sigmaViol === 0
              && current.state.nStable >= CONSTITUTION.N_MIN
            ));
          const status = probe.status === 'passed' && execution.approved && snapshotStillCurrent
            ? 'passed'
            : 'failed';
          if (probe.status === 'passed' && !snapshotStillCurrent) {
            evidenceReason = 'Canonical state changed before evidence persistence; rerun the read-only canary on the current snapshot.';
          } else if (probe.status === 'passed' && !execution.approved) {
            evidenceReason = 'The governed executor did not approve the canary call; no pass can be recorded.';
          }

          try {
            await recordRecoveryCanaryEvidence({
              sessionId,
              actorId,
              status,
              stateFingerprint: fingerprint,
              policyVersion: String(probe.state_version),
              probeTool: String(probe.probe_tool ?? 'get_constitutional_state'),
              receiptId: execution.receiptId,
              C: Number(probe.C),
              R: Number(probe.R),
              S: Number(probe.S),
              nStable: Number(probe.n_stable),
              sigmaViol: Number(probe.sigma_viol),
              trajectoryUpdatedAt: String(probe.trajectory_updated_at),
              recoveryState: String(probe.recovery_state ?? 'RESTORING'),
              issuedAt: String(probe.issued_at ?? new Date().toISOString()),
              expiresAt: String(probe.expires_at ?? new Date(Date.now() + 60 * 60 * 1000).toISOString()),
              reason: evidenceReason,
            });
            const confirmed = await readCanonicalGovernanceState({
              sessionId,
              actorId,
              capability: 'read',
            });
            evidencePersisted = confirmed.available
              && confirmed.state.stateFingerprint === fingerprint
              && confirmed.state.version === String(probe.state_version)
              && confirmed.state.canaryPassed === (status === 'passed')
              && confirmed.state.canaryReceiptId === execution.receiptId;
            evidenceStatus = evidencePersisted ? status : 'not_recorded';
            if (!evidencePersisted) evidenceReason = 'Evidence was written but could not be confirmed against the current exact snapshot; execution remains fail-closed.';
          } catch {
            evidenceReason = 'Canary ran, but durable evidence storage failed; no write authority is granted.';
          }
        } else if (probe?.status === 'not_run') {
          evidenceReason = typeof probe.reason === 'string' ? probe.reason : 'Canary prerequisites were not met; no evidence was recorded.';
        } else if (rawProbeResult && !probe) {
          evidenceReason = 'Canary returned an unreadable result; no evidence was recorded.';
        }

        return mcpToolResult(id, {
          execution: execution.result,
          recovery_canary: {
            status: evidenceStatus,
            evidence_persisted: evidencePersisted,
            receipt_id: execution.receiptId,
            state_fingerprint: typeof probe?.state_fingerprint === 'string' ? probe.state_fingerprint : null,
            reason: evidenceReason ?? null,
            grants_write_authority: false,
          },
        });
      }

      const controller = new AbortController();
      const outcome = await withDeadline(executeGovernedTool(
        dispatchToolName,
        toolArgs,
        toolFn,
        sessionId,
        args.task_context as string | undefined,
        actorId,
        controller.signal,
        ownerId,
        ownerId,
      ), 30_000, controller);

      const result = outcome.timedOut
        ? 'EXECUTION_STATUS=unknown_after_deadline. Cancellation was requested, but the tool or remote system may already have completed the action. Verify its state and receipt before retrying.'
        : outcome.value;

      return mcpToolResult(id, result);
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
