/**
 * Constitutional tool executor.
 *
 * Execution results may be cached for read-only operations, but authorization
 * is recomputed for every request. The cache never stores or reuses a
 * governance decision; kernel state is checked by the interceptor on each call.
 */

import crypto from 'crypto';
import { interceptToolCall } from './tool_interceptor';
import { ConstitutionalExecutionCache } from './constitutional_execution_cache';
import { dependencyFailurePolicy } from './dependency_failure_policy';
import { writeGovernanceReceipt } from './governance_commit';
import { getClient } from '../db';
import type { ToolCallDecision } from './types';

const READ_TOOLS = new Set([
  'read_file', 'read_directory', 'list_directory', 'list_files', 'read_memory',
  'search_memory', 'fetch_page', 'curl', 'http_get', 'get_file',
  'cat', 'head', 'tail', 'grep', 'find', 'ls', 'dir', 'glob',
  'read_json', 'parse_csv',
]);

const KERNEL_CRITICAL = 0.05;

const cache = new ConstitutionalExecutionCache<string, ToolCallDecision>({
  ttlMs: 60_000,
  isCacheable: (toolName) => READ_TOOLS.has(toolName),
  authorize: async () => {
    throw new Error('Authorization must be supplied by executeGovernedTool.');
  },
  isApproved: (decision) => decision.approved,
});

async function getCurrentKernelM(sessionId: string): Promise<{ available: boolean; m: number }> {
  try {
    const db = getClient();
    const result = await db.execute({
      sql: 'SELECT last_m FROM z_traj WHERE session_id = ? LIMIT 1',
      args: [sessionId],
    });
    if (!result.rows.length) return { available: true, m: 1.0 };
    return { available: true, m: Number(result.rows[0].last_m ?? 1.0) };
  } catch {
    return { available: false, m: 0 };
  }
}

function dependencyFailureDecision(toolName: string): ToolCallDecision {
  const policy = dependencyFailurePolicy(READ_TOOLS.has(toolName) ? 'read' : 'high_risk');
  return {
    approved: false,
    decision: 'DENIED_LOCKED',
    reason: policy.reason,
    crs: { C: 0, R: 0, S: 0, M: 0, risk_level: 'BLOCKED' },
    receipt_id: `dependency-${crypto.randomUUID()}`,
    sigma_viol: 1,
    health_band: 'LOCKED',
    warning: 'Governance state unavailable; execution denied by fail-closed policy.',
  };
}

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
    ...(decision.warning ? [`warning:     ${decision.warning}`] : []),
    `authorization_rechecked: true`,
    `cache_hit:   ${cacheHit}`,
    '',
  ];
  if (result !== undefined) lines.push(result);
  return lines.join('\n');
}

export interface GovernedToolExecution {
  result: string;
  approved: boolean;
  decision: string;
  receiptId: string | null;
}

export async function executeGovernedToolStructured(
  toolName: string,
  args: Record<string, unknown>,
  toolFn: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>,
  sessionId: string,
  taskContext?: string,
  actorId = 'internal-agent',
  signal?: AbortSignal,
): Promise<GovernedToolExecution> {
  const decision = await interceptToolCall({
    id: crypto.randomUUID(),
    name: toolName,
    arguments: args,
    session_id: sessionId,
    actor_id: actorId,
    task_context: taskContext
      ?? (args.message as string | undefined)
      ?? (args.query as string | undefined)
      ?? (args.sql as string | undefined)
      ?? `Tool call: ${toolName}. Target: ${JSON.stringify(args).slice(0, 200)}`,
  });

  if (!decision.approved) {
    return {
      result: report(toolName, decision),
      approved: false,
      decision: decision.decision,
      receiptId: decision.receipt_id ?? null,
    };
  }

  // The cached value itself is never an authorization artifact. Recheck the
  // kernel immediately before serving it; if that state read fails, emit a
  // separate actor-attributed denial receipt where storage is available.
  if (READ_TOOLS.has(toolName)) {
    const kernelState = await getCurrentKernelM(sessionId);
    if (!kernelState.available) {
      const unavailableDecision = dependencyFailureDecision(toolName);
      const argsHash = crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex').slice(0, 32);
      try {
        await writeGovernanceReceipt({
          receipt_id: unavailableDecision.receipt_id,
          session_id: sessionId,
          actor_id: actorId,
          tool_name: toolName,
          args_hash: argsHash,
          decision: unavailableDecision.decision,
          crs: unavailableDecision.crs,
          reason: unavailableDecision.reason,
          sigma_viol: unavailableDecision.sigma_viol,
        });
      } catch {
        unavailableDecision.warning = 'Governance state unavailable; execution denied, but the denial receipt could not be persisted.';
      }
      return {
        result: report(toolName, unavailableDecision),
        approved: false,
        decision: unavailableDecision.decision,
        receiptId: unavailableDecision.receipt_id,
      };
    }
    if (kernelState.m < KERNEL_CRITICAL) {
      const criticalDecision = await interceptToolCall({
        id: crypto.randomUUID(),
        name: toolName,
        arguments: args,
        session_id: sessionId,
        actor_id: actorId,
        task_context: taskContext
          ?? (args.message as string | undefined)
          ?? (args.query as string | undefined)
          ?? (args.sql as string | undefined)
          ?? `Tool call: ${toolName}. Target: ${JSON.stringify(args).slice(0, 200)}`,
      });
      return {
        result: report(toolName, criticalDecision),
        approved: false,
        decision: criticalDecision.decision,
        receiptId: criticalDecision.receipt_id ?? null,
      };
    }
  }

  if (signal?.aborted) {
    return {
      result: report(toolName, decision, 'EXECUTION_STATUS=not_started_after_cancellation; the authorization decision was recorded, but the tool function was not invoked.'),
      approved: false,
      decision: 'EXECUTION_CANCELLED_BEFORE_START',
      receiptId: decision.receipt_id ?? null,
    };
  }

  const cached = await cache.getOrExecuteAuthorized({
    key: keyFor(sessionId, toolName, args),
    toolName,
    decision,
    execute: () => toolFn(args, signal),
  });

  return {
    result: report(toolName, cached.decision, cached.value, cached.cacheHit),
    approved: cached.decision.approved,
    decision: cached.decision.decision,
    receiptId: cached.decision.receipt_id ?? null,
  };
}

/** Backward-compatible string API for existing callers. */
export async function executeGovernedTool(
  toolName: string,
  args: Record<string, unknown>,
  toolFn: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>,
  sessionId: string,
  taskContext?: string,
  actorId = 'internal-agent',
  signal?: AbortSignal,
): Promise<string> {
  const execution = await executeGovernedToolStructured(
    toolName,
    args,
    toolFn,
    sessionId,
    taskContext,
    actorId,
    signal,
  );
  return execution.result;
}
