import crypto from 'crypto';
import { getClient } from '../db';

export type GovernanceRisk = 'read' | 'write' | 'external' | 'destructive';
export type VerificationStatus = 'verified' | 'unknown' | 'not_started' | 'failed';

export interface GovernancePolicyDecision {
  decision: 'allow' | 'deny' | 'approval_required';
  risk: GovernanceRisk;
  requiresApproval: boolean;
  policyVersion: string;
  reasons: string[];
  approvalId?: string;
  constraints: {
    actorId: string;
    sessionId: string;
    toolName: string;
  };
}

export interface PostActionVerification {
  status: VerificationStatus;
  summary: string;
}

const POLICY_VERSION = 'tool-gateway-2026-09-28.2';
const APPROVAL_TOKEN_VERSION = 'approval-v1';
const APPROVAL_TTL_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 30 * 1000;
const READ_TOOLS = new Set([
  'read_file', 'read_directory', 'list_directory', 'list_files', 'read_memory',
  'search_memory', 'fetch_page', 'curl', 'http_get', 'get_file', 'cat', 'head',
  'tail', 'grep', 'find', 'ls', 'dir', 'glob', 'read_json', 'parse_csv',
  'get_constitutional_state', 'get_trajectory_status', 'review_agent_action',
  'simulate_agent_plan', 'explain_denial', 'run_governance', 'declare_trajectory_plan',
  'clear_trajectory_plan', 'get_build_status', 'get_workflow_run',
  'get_workflow_log', 'get_workflow_artifact', 'get_recent_receipts',
]);
const EXTERNAL_TOOLS = new Set([
  'dispatch_workflow', 'send_email', 'publish_post', 'create_issue', 'create_pull_request',
  'deploy', 'create_deployment', 'http_post', 'http_put', 'http_patch', 'curl_post',
]);
const DESTRUCTIVE_TOOLS = new Set([
  'delete_file', 'delete_directory', 'delete_repository', 'delete_branch', 'revoke_key',
  'change_access', 'change_billing', 'drop_table', 'execute_destructive_sql',
]);
const SECRET_KEY = /(?:pass(?:word|phrase)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|access[_-]?key)/i;
const MAX_REDACTION_DEPTH = 8;

function stableValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACTION_DEPTH) return '[depth-limited]';
  if (Array.isArray(value)) return value.map(item => stableValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item, depth + 1)]));
  }
  return value;
}

/** Redacts credential-like values before diagnostics or human-readable output. */
export function redactGovernanceValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACTION_DEPTH) return '[redacted-depth-limit]';
  if (Array.isArray(value)) return value.map(item => redactGovernanceValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : redactGovernanceValue(item, depth + 1),
    ]));
  }
  if (typeof value === 'string' && value.length > 4096) return `${value.slice(0, 4096)}…[truncated]`;
  return value;
}

/** Redacts common inline credential forms in free-form prompts and context. */
export function redactGovernanceText(text: string): string {
  return text
    .replace(/\bauthorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi, 'Authorization=[REDACTED]')
    .replace(/\b(password|passphrase|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
}

/** Stable hash for receipts and cache keys; raw arguments never enter the receipt text. */
export function hashGovernanceArguments(args: Record<string, unknown>): string {
  const actionArgs = Object.fromEntries(Object.entries(args)
    .filter(([key]) => key !== 'approval_token' && key !== 'approval_id'));
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(actionArgs))).digest('hex');
}

interface GovernanceApprovalClaims {
  v: typeof APPROVAL_TOKEN_VERSION;
  jti: string;
  actorId: string;
  sessionId: string;
  toolName: string;
  argsHash: string;
  iat: number;
  exp: number;
}

function approvalSigningSecret(): string | undefined {
  return process.env.LEX_APPROVAL_SIGNING_SECRET || process.env.AUDITOR_SECRET || undefined;
}

function encodeApprovalPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function approvalSignature(signingInput: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
}

/** Creates a short-lived approval bound to one actor, session, tool, and action. */
export function createGovernanceApprovalToken(input: {
  actorId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  approvalId?: string;
  nowMs?: number;
  ttlMs?: number;
}): string {
  const secret = approvalSigningSecret();
  if (!secret) throw new Error('Approval signing secret is not configured.');
  const now = input.nowMs ?? Date.now();
  const claims: GovernanceApprovalClaims = {
    v: APPROVAL_TOKEN_VERSION,
    jti: input.approvalId ?? crypto.randomUUID(),
    actorId: input.actorId,
    sessionId: input.sessionId,
    toolName: input.toolName,
    argsHash: hashGovernanceArguments(input.args),
    iat: now,
    exp: now + Math.min(input.ttlMs ?? APPROVAL_TTL_MS, APPROVAL_TTL_MS),
  };
  const encodedClaims = encodeApprovalPart(claims);
  const signingInput = `${APPROVAL_TOKEN_VERSION}.${encodedClaims}`;
  return `${signingInput}.${approvalSignature(signingInput, secret)}`;
}

function verifyGovernanceApprovalToken(input: {
  token: unknown;
  actorId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  nowMs?: number;
}): { valid: boolean; approvalId?: string; expiresAt?: number; reason: string } {
  const secret = approvalSigningSecret();
  if (!secret) return { valid: false, reason: 'Approval signing secret is not configured.' };
  if (typeof input.token !== 'string') return { valid: false, reason: 'No signed approval token was supplied.' };
  const parts = input.token.split('.');
  if (parts.length !== 3 || parts[0] !== APPROVAL_TOKEN_VERSION) {
    return { valid: false, reason: 'Approval token format or version is invalid.' };
  }
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(approvalSignature(signingInput, secret));
  const received = Buffer.from(parts[2]);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { valid: false, reason: 'Approval token signature is invalid.' };
  }
  let claims: GovernanceApprovalClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as GovernanceApprovalClaims;
  } catch {
    return { valid: false, reason: 'Approval token claims are not valid JSON.' };
  }
  const now = input.nowMs ?? Date.now();
  if (claims.v !== APPROVAL_TOKEN_VERSION || !claims.jti || !Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)) {
    return { valid: false, reason: 'Approval token claims are incomplete.' };
  }
  if (claims.iat > now + CLOCK_SKEW_MS || claims.exp <= now) {
    return { valid: false, reason: 'Approval token is expired or not yet valid.' };
  }
  if (claims.actorId !== input.actorId || claims.sessionId !== input.sessionId || claims.toolName !== input.toolName) {
    return { valid: false, reason: 'Approval token is bound to a different actor, session, or tool.' };
  }
  if (claims.argsHash !== hashGovernanceArguments(input.args)) {
    return { valid: false, reason: 'Approval token is bound to different action arguments.' };
  }
  return { valid: true, approvalId: claims.jti, expiresAt: claims.exp, reason: 'Signed approval token is valid and action-bound.' };
}

/**
 * Atomically consumes a valid approval ID. The unique primary key makes the
 * check-and-consume operation safe across concurrent application instances.
 */
export async function consumeGovernanceApprovalToken(input: {
  token: unknown;
  actorId: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  nowMs?: number;
}): Promise<{ consumed: boolean; approvalId?: string; reason: string }> {
  const verified = verifyGovernanceApprovalToken(input);
  if (!verified.valid || !verified.approvalId || !verified.expiresAt) {
    return { consumed: false, reason: verified.reason };
  }
  try {
    const db = getClient();
    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS governance_approval_consumptions (
        approval_id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        consumed_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
      args: [],
    });
    await db.execute({
      sql: 'DELETE FROM governance_approval_consumptions WHERE expires_at < ?',
      args: [input.nowMs ?? Date.now()],
    });
    const inserted = await db.execute({
      sql: `INSERT OR IGNORE INTO governance_approval_consumptions
        (approval_id, actor_id, session_id, tool_name, consumed_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      args: [verified.approvalId, input.actorId, input.sessionId, input.toolName, input.nowMs ?? Date.now(), verified.expiresAt],
    });
    if ((inserted.rowsAffected ?? 0) !== 1) {
      return { consumed: false, approvalId: verified.approvalId, reason: 'Approval token has already been consumed.' };
    }
    return { consumed: true, approvalId: verified.approvalId, reason: 'Approval token consumed exactly once.' };
  } catch {
    return { consumed: false, approvalId: verified.approvalId, reason: 'Approval consumption store unavailable; execution denied by fail-closed policy.' };
  }
}

export function classifyGovernanceRisk(toolName: string): GovernanceRisk {
  if (DESTRUCTIVE_TOOLS.has(toolName) || /(?:delete|destroy|drop|revoke|billing|access)/i.test(toolName)) {
    return 'destructive';
  }
  if (EXTERNAL_TOOLS.has(toolName) || /(?:dispatch|publish|deploy|send|create_.*(?:issue|pull|deployment))/i.test(toolName)) {
    return 'external';
  }
  if (READ_TOOLS.has(toolName) || /^(?:get|list|read|search|review|simulate|explain|check|verify)/i.test(toolName)) {
    return 'read';
  }
  return 'write';
}

/**
 * Central policy decision used by every execution surface. Authentication and
 * trajectory checks remain separate concerns; this function only evaluates the
 * tool/action envelope and returns a structured, machine-readable decision.
 */
export function evaluateToolGovernance(input: {
  toolName: string;
  args: Record<string, unknown>;
  sessionId: string;
  actorId: string;
  authorized: boolean;
  approvalToken?: unknown;
  nowMs?: number;
}): GovernancePolicyDecision {
  const risk = classifyGovernanceRisk(input.toolName);
  const requiresApproval = risk === 'external' || risk === 'destructive';
  const reasons: string[] = [];
  if (!input.authorized) {
    reasons.push('Caller or capability scope does not authorize this tool.');
    return {
      decision: 'deny', risk, requiresApproval, policyVersion: POLICY_VERSION, reasons,
      constraints: { actorId: input.actorId, sessionId: input.sessionId, toolName: input.toolName },
    };
  }
  const approval = requiresApproval
    ? verifyGovernanceApprovalToken({
      token: input.approvalToken,
      actorId: input.actorId,
      sessionId: input.sessionId,
      toolName: input.toolName,
      args: input.args,
      nowMs: input.nowMs,
    })
    : { valid: true, reason: 'Approval is not required for this risk class.' };
  if (requiresApproval && !approval.valid) {
    reasons.push(approval.reason);
    return {
      decision: 'approval_required', risk, requiresApproval, policyVersion: POLICY_VERSION, reasons,
      constraints: { actorId: input.actorId, sessionId: input.sessionId, toolName: input.toolName },
    };
  }
  reasons.push(`Caller is authorized for ${input.toolName}.`);
  reasons.push(`Classified as ${risk}; arguments are receipt-hashed without diagnostic disclosure.`);
  if (approval.approvalId) reasons.push(`Signed approval ${approval.approvalId} is bound to this action.`);
  return {
    decision: 'allow', risk, requiresApproval, policyVersion: POLICY_VERSION, reasons,
    ...(approval.approvalId ? { approvalId: approval.approvalId } : {}),
    constraints: { actorId: input.actorId, sessionId: input.sessionId, toolName: input.toolName },
  };
}

/**
 * Conservative generic verification: reads with a non-empty result are
 * verifiable at the tool boundary; writes/externals remain unknown until a
 * caller supplies a resource-specific verifier. Denials never count as success.
 */
export function verifyToolResult(toolName: string, result: string | undefined, risk = classifyGovernanceRisk(toolName)): PostActionVerification {
  if (result === undefined) return { status: 'not_started', summary: 'Tool was not invoked.' };
  if (!result.trim()) return { status: 'failed', summary: 'Tool returned an empty result.' };
  if (result.includes('approved:    false') || result.includes('EXECUTION_STATUS=not_started')) {
    return { status: 'failed', summary: 'Tool result indicates execution was denied or did not start.' };
  }
  if (risk === 'read') return { status: 'verified', summary: 'Non-empty read result returned by the tool.' };
  return { status: 'unknown', summary: 'Tool returned, but resource state requires a tool-specific post-action verifier.' };
}

export const TOOL_GOVERNANCE_POLICY_VERSION = POLICY_VERSION;
