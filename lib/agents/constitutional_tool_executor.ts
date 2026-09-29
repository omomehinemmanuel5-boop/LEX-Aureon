/**
 * Constitutional tool executor.
 *
 * Execution results may be cached for read-only operations, but authorization
 * is recomputed for every request. The cache never stores or reuses a
 * governance decision; kernel state is checked by the interceptor on each call.
 */

import crypto from 'crypto';
import { interceptToolCall } from './tool_interceptor';
import { requireKnownToolCapability, type ToolCapabilityRecord } from './tool_capability_registry';
import { canonicalExecutionAllowed, readCanonicalGovernanceState, type CanonicalGovernanceState } from './canonical_governance_state';
import { ConstitutionalExecutionCache } from './constitutional_execution_cache';
import { dependencyFailurePolicy } from './dependency_failure_policy';
import { writeGovernanceReceipt } from './governance_commit';
import { getClient } from '../db';
import type { ToolCallDecision } from './types';
import {
  consumeGovernanceApprovalToken,
  evaluateToolGovernance,
  hashGovernanceArguments,
  redactGovernanceText,
  redactGovernanceValue,
  verifyToolResult,
  type GovernancePolicyDecision,
  type PostActionVerification,
} from './tool_governance_gateway';

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
  const argsHash = hashGovernanceArguments(args).slice(0, 32);
  return `${sessionId}:${toolName}:${argsHash}`;
}

function report(
  toolName: string,
  decision: ToolCallDecision,
  result?: string,
  cacheHit = false,
  policy?: GovernancePolicyDecision,
  verification?: PostActionVerification,
  canonicalState?: CanonicalGovernanceState,
  postActionCanonicalState?: CanonicalGovernanceState,
): string {
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
    ...(policy ? [
      `policy_decision: ${policy.decision}`,
      `policy_version: ${policy.policyVersion}`,
      `governance_risk: ${policy.risk}`,
      `approval_required: ${policy.requiresApproval}`,
      ...(policy.approvalId ? [`approval_id: ${policy.approvalId}`] : []),
    ] : []),
    `cache_hit:   ${cacheHit}`,
    ...(verification ? [
      `post_action_verification: ${verification.status}`,
      `verification_summary: ${verification.summary}`,
    ] : []),
    ...(canonicalState ? [
      `canonical_state_version: ${canonicalState.version}`,
      `canonical_crs: ${canonicalState.healthBand === 'UNINITIALIZED' ? 'UNINITIALIZED (no z_traj row)' : `C=${canonicalState.C.toFixed(3)} R=${canonicalState.R.toFixed(3)} S=${canonicalState.S.toFixed(3)} M=${canonicalState.M.toFixed(3)}`}`,
      `canonical_health_band: ${canonicalState.healthBand}`,
      `canonical_sigma_viol: ${canonicalState.healthBand === 'UNINITIALIZED' ? 'UNAVAILABLE' : canonicalState.sigmaViol.toFixed(3)}`,
      `trajectory_state_available: ${canonicalState.trajectoryAvailable}`,
    ] : []),
    ...(postActionCanonicalState ? [
      `post_action_canonical_crs: ${postActionCanonicalState.healthBand === 'UNINITIALIZED' ? 'UNINITIALIZED (no z_traj row)' : `C=${postActionCanonicalState.C.toFixed(3)} R=${postActionCanonicalState.R.toFixed(3)} S=${postActionCanonicalState.S.toFixed(3)} M=${postActionCanonicalState.M.toFixed(3)}`}`,
      `post_action_canonical_health_band: ${postActionCanonicalState.healthBand}`,
      `post_action_canonical_sigma_viol: ${postActionCanonicalState.healthBand === 'UNINITIALIZED' ? 'UNAVAILABLE' : postActionCanonicalState.sigmaViol.toFixed(3)}`,
      `post_action_state_available: ${postActionCanonicalState.trajectoryAvailable}`,
    ] : []),
    '',
  ];
  if (result !== undefined) lines.push(result);
  return lines.join('\n');
}

function safeTaskContext(
  toolName: string,
  args: Record<string, unknown>,
  taskContext?: string,
  capability?: ToolCapabilityRecord,
): string {
  // A caller-supplied task context remains authoritative when present. When
  // it is absent, do not collapse the governance measurement to the generic
  // `Tool call: <name>` fallback: that text contains no intent signal and
  // makes C/R effectively measure the wrapper itself rather than the action.
  // Derive a short, capability-aware intent from non-secret structural fields.
  const target = String(
    args.path
    ?? args.file
    ?? args.target
    ?? args.repo
    ?? args.workflow
    ?? '',
  ).trim();

  const verb = capability?.capability === 'read'
    ? 'Read'
    : capability?.capability === 'write'
      ? 'Write'
      : capability?.capability === 'external' || capability?.capability === 'network'
        ? 'Perform external action'
        : capability?.capability === 'delegate'
          ? 'Delegate'
          : capability?.capability === 'execute'
            ? 'Execute'
            : capability?.capability === 'financial'
              ? 'Perform financial action'
              : capability?.capability === 'identity'
                ? 'Perform identity action'
                : capability?.capability === 'destructive'
                  ? 'Perform destructive action'
                  : 'Invoke';

  const derivedContext = [
    `${verb} using ${toolName}`,
    target ? `Target: ${target}` : '',
  ].filter(Boolean).join('. ');

  const candidate = taskContext
    ?? (args.message as string | undefined)
    ?? (args.query as string | undefined)
    ?? (args.sql as string | undefined)
    ?? derivedContext;

  const redacted = redactGovernanceValue(candidate);
  return typeof redacted === 'string'
    ? redactGovernanceText(redacted).slice(0, 4096)
    : derivedContext;
}

export interface GovernedToolExecution {
  result: string;
  approved: boolean;
  decision: string;
  receiptId: string | null;
  risk?: string;
  policy?: GovernancePolicyDecision;
  verification?: PostActionVerification;
}

export async function executeGovernedToolStructured(
  toolName: string,
  args: Record<string, unknown>,
  toolFn: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>,
  sessionId: string,
  taskContext?: string,
  actorId = 'internal-agent',
  signal?: AbortSignal,
  environmentId = 'internal',
): Promise<GovernedToolExecution> {
  // Reference-monitor admission: capability must be explicitly registered.
  // Never infer authority from an unknown tool name or caller-supplied label.
  let capability: ToolCapabilityRecord;
  try {
    capability = requireKnownToolCapability(toolName);
  } catch (error) {
    // Environment discovery is advisory intelligence, never execution authority.
    // A discovered capability must be explicitly registered before the
    // reference monitor can authorize the underlying tool function.
    const reason = error instanceof Error
      ? error.message
      : 'Unknown tool capability; execution denied.';
    const unknownDecision: ToolCallDecision = {
      approved: false,
      decision: 'DENIED_BLOCKED',
      reason,
      crs: { C: 0, R: 0, S: 0, M: 0, risk_level: 'BLOCKED' },
      receipt_id: `capability-${crypto.randomUUID()}`,
      sigma_viol: 1,
      health_band: 'LOCKED',
      warning: 'Reference monitor fail-closed: explicitly register the tool capability before execution.',
    };
    const verification = verifyToolResult(toolName, undefined, 'destructive');
    return {
      result: report(toolName, unknownDecision, undefined, false, undefined, verification),
      approved: false,
      decision: unknownDecision.decision,
      receiptId: unknownDecision.receipt_id ?? null,
      risk: 'unknown',
      verification,
    };
  }

  const canonicalRead = await readCanonicalGovernanceState({
    sessionId,
    actorId,
    capability: capability.capability,
    authorization: capability.approvalRequired ? 'approval_required' : 'authorized',
  });

  if (!canonicalRead.available) {
    const unavailableDecision: ToolCallDecision = {
      approved: false,
      decision: 'DENIED_LOCKED',
      reason: canonicalRead.reason ?? 'Canonical governance state unavailable; execution denied by fail-closed policy.',
      crs: { C: 0, R: 0, S: 0, M: 0, risk_level: 'BLOCKED' },
      receipt_id: `canonical-${crypto.randomUUID()}`,
      sigma_viol: 1,
      health_band: 'CRITICAL',
      warning: 'Canonical governance state unavailable; the reference monitor refused execution.',
    };
    const verification = verifyToolResult(toolName, undefined, 'destructive');
    return {
      result: report(toolName, unavailableDecision, undefined, false, undefined, verification),
      approved: false,
      decision: unavailableDecision.decision,
      receiptId: unavailableDecision.receipt_id,
      risk: 'unknown',
      verification,
    };
  }

  const canonicalGate = canonicalExecutionAllowed(canonicalRead.state, capability.bootstrapAllowed === true);
  if (!canonicalGate.allowed) {
    const canonicalDecision: ToolCallDecision = {
      approved: false,
      decision: 'DENIED_BLOCKED',
      reason: canonicalGate.reason ?? 'Canonical governance state denied execution.',
      crs: {
        C: canonicalRead.state.C,
        R: canonicalRead.state.R,
        S: canonicalRead.state.S,
        M: canonicalRead.state.M,
        risk_level: 'BLOCKED',
      },
      receipt_id: `canonical-${crypto.randomUUID()}`,
      sigma_viol: canonicalRead.state.sigmaViol,
      health_band: canonicalRead.state.healthBand === 'UNINITIALIZED'
        ? 'LOCKED'
        : canonicalRead.state.healthBand === 'CRITICAL' ? 'CRITICAL' : 'STRESSED',
      warning: 'Canonical governance state is authoritative for execution health.',
    };
    const verification = verifyToolResult(toolName, undefined, capability.capability === 'read' ? 'read' : 'write');
    return {
      result: report(toolName, canonicalDecision, undefined, false, undefined, verification, canonicalRead.state),
      approved: false,
      decision: canonicalDecision.decision,
      receiptId: canonicalDecision.receipt_id,
      risk: capability.capability,
      verification,
    };
  }

  const decision = await interceptToolCall({
    id: crypto.randomUUID(),
    name: toolName,
    arguments: args,
    session_id: sessionId,
    actor_id: actorId,
    task_context: safeTaskContext(toolName, args, taskContext, capability),
  });
  const policy = evaluateToolGovernance({
    toolName,
    args,
    sessionId,
    actorId,
    authorized: true,
    approvalToken: args.approval_token,
  });

  if (!decision.approved) {
    const verification = verifyToolResult(toolName, undefined, policy.risk);
    return {
      result: report(toolName, decision, undefined, false, policy, verification, canonicalRead.state),
      approved: false,
      decision: decision.decision,
      receiptId: decision.receipt_id ?? null,
      risk: policy.risk,
      policy,
      verification,
    };
  }

  if (policy.decision !== 'allow') {
    const approvalDecision: ToolCallDecision = {
      ...decision,
      approved: false,
      decision: 'DENIED_BLOCKED',
      reason: policy.reasons.join(' '),
      warning: 'The centralized tool policy requires an action-bound approval before this risk class can execute.',
    };
    const verification = verifyToolResult(toolName, undefined, policy.risk);
    return {
      result: report(toolName, approvalDecision, undefined, false, policy, verification, canonicalRead.state),
      approved: false,
      decision: approvalDecision.decision,
      receiptId: approvalDecision.receipt_id ?? null,
      risk: policy.risk,
      policy,
      verification,
    };
  }

  if (policy.requiresApproval) {
    const consumed = await consumeGovernanceApprovalToken({
      token: args.approval_token,
      actorId,
      sessionId,
      toolName,
      args,
    });
    if (!consumed.consumed) {
      const replayDecision: ToolCallDecision = {
        ...decision,
        approved: false,
        decision: 'DENIED_BLOCKED',
        reason: consumed.reason,
        warning: 'The action-bound approval could not be consumed exactly once; the tool function was not invoked.',
      };
      const verification = verifyToolResult(toolName, undefined, policy.risk);
      return {
        result: report(toolName, replayDecision, undefined, false, policy, verification, canonicalRead.state),
        approved: false,
        decision: replayDecision.decision,
        receiptId: replayDecision.receipt_id ?? null,
        risk: policy.risk,
        policy,
        verification,
      };
    }
  }

  // The cached value itself is never an authorization artifact. Recheck the
  // kernel immediately before serving it; if that state read fails, emit a
  // separate actor-attributed denial receipt where storage is available.
  if (READ_TOOLS.has(toolName)) {
    const kernelState = await getCurrentKernelM(sessionId);
    if (!kernelState.available) {
      const unavailableDecision = dependencyFailureDecision(toolName);
      const argsHash = hashGovernanceArguments(args).slice(0, 32);
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
        result: report(toolName, unavailableDecision, undefined, false, policy, verifyToolResult(toolName, undefined, policy.risk), canonicalRead.state),
        approved: false,
        decision: unavailableDecision.decision,
        receiptId: unavailableDecision.receipt_id,
        risk: policy.risk,
        policy,
        verification: verifyToolResult(toolName, undefined, policy.risk),
      };
    }
    if (kernelState.m < KERNEL_CRITICAL) {
      const criticalDecision = await interceptToolCall({
        id: crypto.randomUUID(),
        name: toolName,
        arguments: args,
        session_id: sessionId,
        actor_id: actorId,
        task_context: safeTaskContext(toolName, args, taskContext, capability),
      });
      return {
        result: report(toolName, criticalDecision, undefined, false, policy, verifyToolResult(toolName, undefined, policy.risk), canonicalRead.state),
        approved: false,
        decision: criticalDecision.decision,
        receiptId: criticalDecision.receipt_id ?? null,
        risk: policy.risk,
        policy,
        verification: verifyToolResult(toolName, undefined, policy.risk),
      };
    }
  }

  if (signal?.aborted) {
    const verification = verifyToolResult(toolName, undefined, policy.risk);
    return {
      result: report(toolName, decision, 'EXECUTION_STATUS=not_started_after_cancellation; the authorization decision was recorded, but the tool function was not invoked.', false, policy, verification, canonicalRead.state),
      approved: false,
      decision: 'EXECUTION_CANCELLED_BEFORE_START',
      receiptId: decision.receipt_id ?? null,
      risk: policy.risk,
      policy,
      verification,
    };
  }

  const cached = await cache.getOrExecuteAuthorized({
    key: keyFor(sessionId, toolName, args),
    toolName,
    decision,
    execute: () => toolFn(args, signal),
  });

  const verification = verifyToolResult(toolName, cached.value, policy.risk);
  const postActionRead = await readCanonicalGovernanceState({
    sessionId,
    actorId,
    capability: capability.capability,
    authorization: capability.approvalRequired ? 'approval_required' : 'authorized',
  });
  const postActionState = postActionRead.available ? postActionRead.state : undefined;
  const postActionWarning = postActionState && postActionState.M < canonicalRead.state.M
    ? ` Post-action canonical M changed from ${canonicalRead.state.M.toFixed(3)} to ${postActionState.M.toFixed(3)}; subsequent consequential execution must use the post-action state.`
    : '';
  const reportedValue = postActionWarning
    ? `${cached.value}\\n\\nPOST_ACTION_GOVERNANCE: ${postActionWarning.trim()}`
    : cached.value;
  return {
    result: report(toolName, cached.decision, reportedValue, cached.cacheHit, policy, verification, canonicalRead.state, postActionState),
    approved: cached.decision.approved,
    decision: cached.decision.decision,
    receiptId: cached.decision.receipt_id ?? null,
    risk: policy.risk,
    policy,
    verification,
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
  environmentId = 'internal',
): Promise<string> {
  const execution = await executeGovernedToolStructured(
    toolName,
    args,
    toolFn,
    sessionId,
    taskContext,
    actorId,
    signal,
    environmentId,
  );
  return execution.result;
}
