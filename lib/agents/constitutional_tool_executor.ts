/**
 * Constitutional tool executor.
 *
 * Execution results may be cached for read-only operations, but authorization
 * is recomputed for every request. This prevents stale approvals from being
 * reused after CRS/session state changes.
 */

import crypto from 'crypto';
import { interceptToolCall } from './tool_interceptor';
import { ConstitutionalExecutionCache } from './constitutional_execution_cache';
import type { ToolCallDecision } from './types';

const READ_TOOLS = new Set([
  'read_file', 'read_directory', 'list_files', 'read_memory',
  'search_memory', 'fetch_page', 'curl', 'http_get', 'get_file',
  'cat', 'head', 'tail', 'grep', 'find', 'ls', 'dir', 'glob',
  'read_json', 'parse_csv',
]);

const cache = new ConstitutionalExecutionCache<string, ToolCallDecision>({
  ttlMs: 60_000,
  isCacheable: (toolName) => READ_TOOLS.has(toolName),
  authorize: async (toolName) => {
    // The full tool input is bound per request by executeGovernedTool below.
    throw new Error(`Authorization context missing for ${toolName}`);
  },
  isApproved: (decision) => decision.approved,
});

function keyFor(sessionId: string, toolName: string, args: Record<string, unknown>): string {
  const argsHash = crypto.createHash('sha256')
    .update(JSON.stringify(args))
    .digest('hex')
    .slice(0, 32);
  return `${sessionId}:${toolName}:${argsHash}`;
}

function report(toolName: string, decision: ToolCallDecision, result?: string, cacheHit = false): string {
  const lines = [
    `── Constitutional tool-call decision [${toolName}]${cacheHit ? ' — CACHED EXECUTION' : ''} ──`,
    `decision:    ${decision.decision}`,
    `approved:    ${decision.approved}`,
    `crs:         C=${decision.crs.C.toFixed(3)} R=${decision.crs.R.toFixed(3)} S=${decision.crs.S.toFixed(3)} M=${decision.crs.M.toFixed(3)}`,
    `risk_level:  ${decision.crs.risk_level}`,
    `health_band: ${decision.health_band}`,
    `sigma_viol:  ${decision.sigma_viol.toFixed(3)}`,
    `receipt_id:  ${decision.receipt_id}`,
    `reason:      ${decision.reason}`,
    `authorization_rechecked: true`,
    `cache_hit:   ${cacheHit}`,
    '',
  ];
  if (result !== undefined) lines.push(result);
  return lines.join('\n');
}

/**
 * Govern a tool request first, then optionally reuse only its execution result.
 * The cache is never consulted until the current request has been authorized.
 */
export async function executeGovernedTool(
  toolName: string,
  args: Record<string, unknown>,
  toolFn: (args: Record<string, unknown>) => Promise<string>,
  sessionId: string,
  taskContext?: string,
): Promise<string> {
  const decision = await interceptToolCall({
    id: crypto.randomUUID(),
    name: toolName,
    arguments: args,
    session_id: sessionId,
    task_context: taskContext
      ?? (args.message as string | undefined)
      ?? (args.query as string | undefined)
      ?? (args.sql as string | undefined)
      ?? `Tool call: ${toolName}. Target: ${JSON.stringify(args).slice(0, 200)}`,
  });

  if (!decision.approved) return report(toolName, decision);

  // The existing cache primitive is intentionally not used to authorize this
  // request: authorization has already happened with the complete ToolCallInput.
  // It is used here as an execution-result cache by binding the current decision
  // into the per-request cache call.
  const requestCache = new ConstitutionalExecutionCache<string, ToolCallDecision>({
    ttlMs: 60_000,
    isCacheable: (name) => READ_TOOLS.has(name),
    authorize: async () => decision,
    isApproved: (current) => current.approved,
  });

  try {
    const cached = await requestCache.getOrExecute({
      key: keyFor(sessionId, toolName, args),
      toolName,
      execute: () => toolFn(args),
    });
    return report(toolName, cached.decision, cached.value, cached.cacheHit);
  } catch (error) {
    if (error instanceof Error && error.message === 'Tool execution denied by constitutional governance.') {
      return report(toolName, decision);
    }
    throw error;
  }
}
