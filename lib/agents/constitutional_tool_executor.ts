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
  'read_file', 'read_directory', 'list_directory', 'list_files', 'read_memory',
  'search_memory', 'fetch_page', 'curl', 'http_get', 'get_file',
  'cat', 'head', 'tail', 'grep', 'find', 'ls', 'dir', 'glob',
  'read_json', 'parse_csv',
]);

const cache = new ConstitutionalExecutionCache<string, ToolCallDecision>({
  ttlMs: 60_000,
  isCacheable: (toolName) => READ_TOOLS.has(toolName),
  authorize: async () => {
    throw new Error('Authorization must be supplied by executeGovernedTool.');
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

  // Authorization has already been performed with the complete ToolCallInput.
  // Only the execution result is eligible for reuse.
  const cached = await cache.getOrExecuteAuthorized({
    key: keyFor(sessionId, toolName, args),
    toolName,
    decision,
    execute: () => toolFn(args),
  });

  return report(toolName, cached.decision, cached.value, cached.cacheHit);
}
