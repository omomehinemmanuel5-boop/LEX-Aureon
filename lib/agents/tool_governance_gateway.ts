import crypto from 'crypto';

export type GovernanceRisk = 'read' | 'write' | 'external' | 'destructive';
export type VerificationStatus = 'verified' | 'unknown' | 'not_started' | 'failed';

export interface GovernancePolicyDecision {
  decision: 'allow' | 'deny' | 'approval_required';
  risk: GovernanceRisk;
  requiresApproval: boolean;
  policyVersion: string;
  reasons: string[];
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

const POLICY_VERSION = 'tool-gateway-2026-09-28.1';
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
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(args))).digest('hex');
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
  approvalGranted?: boolean;
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
  if (requiresApproval && !input.approvalGranted) {
    reasons.push(`Risk level ${risk} requires an explicit approval bound to this action.`);
    return {
      decision: 'approval_required', risk, requiresApproval, policyVersion: POLICY_VERSION, reasons,
      constraints: { actorId: input.actorId, sessionId: input.sessionId, toolName: input.toolName },
    };
  }
  reasons.push(`Caller is authorized for ${input.toolName}.`);
  reasons.push(`Classified as ${risk}; arguments are receipt-hashed without diagnostic disclosure.`);
  return {
    decision: 'allow', risk, requiresApproval, policyVersion: POLICY_VERSION, reasons,
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
