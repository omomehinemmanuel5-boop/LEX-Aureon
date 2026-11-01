/**
 * Constitutional tool executor.
 *
 * Execution results may be cached for read-only operations, but authorization
 * is recomputed for every request. The cache never stores or reuses a
 * governance decision; kernel state is checked by the interceptor on each call.
 */

import crypto from 'crypto';
import { interceptToolCall } from './tool_interceptor';
import { resolveToolCapability, type ToolCapabilityRecord } from './tool_capability_registry';
import { canonicalExecutionAllowed, readCanonicalGovernanceState, type CanonicalGovernanceState } from './canonical_governance_state';
import { ConstitutionalExecutionCache } from './constitutional_execution_cache';
import { dependencyFailurePolicy } from './dependency_failure_policy';
import { writeGovernanceReceipt } from './governance_commit';
import { invalidateRecoveryCanaryIfPassed } from './recovery_canary_evidence';
import { CONSTITUTION } from '../constitution';
import { RECOVERY_STABILITY_THRESHOLD } from './recovery_state';
import { getClient } from '../db';
import { healthBand } from '../health_band';
import { getZTraj, recordZTrajObservation } from '../kv';
import { advanceRecoveryPlane, shouldAdvanceRecoveryPlane } from './recovery_runtime';
import { approvalArgsHash, consumeApprovalRequest, releaseConsumedApprovalRequest } from '../approval_requests';
import { consumeScopedGrant } from '../scoped_grants';
import { withConsumedApproval } from './approval_execution_context';
import type { ToolCallDecision } from './types';
import { EXECUTOR_READ_TOOLS, NON_MUTATING_GOVERNANCE_TOOLS } from './tool_policy';
import {
  consumeGovernanceApprovalToken,
  releaseConsumedGovernanceApprovalToken,
  evaluateToolGovernance,
  classifyDatabaseOperation,
  hashGovernanceArguments,
  redactGovernanceText,
  redactGovernanceValue,
  verifyToolResult,
  type GovernancePolicyDecision,
  type PostActionVerification,
} from './tool_governance_gateway';

export function isNonMutatingGovernanceTool(toolName: string, args: Record<string, unknown> = {}): boolean {
  if (toolName === 'query_database' || toolName === 'execute_sql') {
    return classifyDatabaseOperation(String(args.sql ?? args.query ?? '')) === 'read';
  }
  return NON_MUTATING_GOVERNANCE_TOOLS.has(toolName);
}

// This explicit control-plane action mutates only the recovery trajectory.
// It must bypass automatic recovery advancement and post-tool trajectory
// sampling, but it must never be cached as an ordinary read.
const RECOVERY_CONTROL_TOOLS = new Set(['advance_recovery_plane', 'request_recovery_pulse']);

/**
 * run_governance delegates to executeGovern(), which owns recovery advancement
 * for direct API callers. Advancing here as well would count two recovery
 * observations for one MCP request; executeGovern() also correctly skips
 * recovery mutations for governance_mode="simulate".
 */
export function shouldAdvanceRecoveryBeforeTool(toolName: string, args: Record<string, unknown> = {}): boolean {
  return toolName !== 'run_governance'
    && !isNonMutatingGovernanceTool(toolName, args)
    && !RECOVERY_CONTROL_TOOLS.has(toolName);
}

const KERNEL_CRITICAL = 0.05;

async function persistExecutorDenialReceipt(input: {
  receiptId: string;
  sessionId: string;
  actorId: string;
  toolName: string;
  args: Record<string, unknown>;
  decision: string;
  crs: ToolCallDecision['crs'];
  sigmaViol: number;
  reason: string;
}): Promise<string | undefined> {
  try {
    await writeGovernanceReceipt({
      receipt_id: input.receiptId,
      session_id: input.sessionId,
      actor_id: input.actorId,
      tool_name: input.toolName,
      args_hash: hashGovernanceArguments(input.args).slice(0, 32),
      decision: input.decision,
      crs: input.crs,
      reason: input.reason,
      sigma_viol: input.sigmaViol,
    });
    return undefined;
  } catch {
    // Authorization remains denied even when the audit store is unavailable.
    return 'Denial receipt could not be persisted; execution remains denied.';
  }
}

const cache = new ConstitutionalExecutionCache<string, ToolCallDecision>({
  ttlMs: 60_000,
  // State snapshots and canary probes must always be fresh; caching them could display a stale gate decision.
  isCacheable: (toolName) => EXECUTOR_READ_TOOLS.has(toolName)
    && !['run_recovery_canary', 'get_constitutional_state', 'get_trajectory_status'].includes(toolName),
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
  const policy = dependencyFailurePolicy(EXECUTOR_READ_TOOLS.has(toolName) ? 'read' : 'high_risk');
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

/**
 * Simulation calls are a hypothetical evaluation. They must never write a
 * trajectory observation for the session they run in.
 */
export function shouldRecordTrajectoryObservation(
  toolName: string,
  args: Record<string, unknown>,
  cacheHit: boolean,
): boolean {
  if (cacheHit) return false;
  if (isNonMutatingGovernanceTool(toolName, args) || RECOVERY_CONTROL_TOOLS.has(toolName)) return false;
  if (toolName === 'run_governance' && args.governance_mode === 'simulate') return false;
  return true;
}

/**
 * Health band printed next to the M it describes. The kernel band can disagree
 * with the printed M, so derive it from M except for the explicit LOCKED state.
 */
export function displayHealthBand(decision: { health_band: string; crs: { M: number } }): string {
  if (decision.health_band === 'LOCKED') return 'LOCKED';
  return healthBand(decision.crs.M);
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
    `${toolName === 'get_constitutional_state' ? 'diagnostic_crs' : 'crs'}: ${toolName === 'get_constitutional_state' ? 'diagnostic only; ' : '        '}C=${decision.crs.C.toFixed(3)} R=${decision.crs.R.toFixed(3)} S=${decision.crs.S.toFixed(3)} M=${decision.crs.M.toFixed(3)}`,
    `risk_level:  ${decision.crs.risk_level}`,
    `health_band: ${displayHealthBand(decision)}`,
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

function recoveryBandBreachReason(state: CanonicalGovernanceState): string | null {
  if (state.canaryEvidenceId == null && state.canaryPassed !== true) return null;
  if (state.M < CONSTITUTION.TAU_RECOVERY) return `M=${state.M} is below TAU_RECOVERY=${CONSTITUTION.TAU_RECOVERY}`;
  if (state.sigmaViol !== 0) return `sigma_viol=${state.sigmaViol} is not zero`;
  if (state.velocity !== undefined && !Number.isFinite(state.velocity)) return 'velocity is not finite';
  if (state.velocity !== undefined && state.velocity >= RECOVERY_STABILITY_THRESHOLD) {
    return `velocity=${state.velocity} reached RECOVERY_STABILITY_THRESHOLD=${RECOVERY_STABILITY_THRESHOLD}`;
  }
  if (state.nStable < CONSTITUTION.N_MIN) return `n_stable=${state.nStable} is below N_MIN=${CONSTITUTION.N_MIN}`;
  return null;
}

async function recordRecoveryBandBreach(
  state: CanonicalGovernanceState,
  sessionId: string,
  actorId: string,
  toolName: string,
  args: Record<string, unknown>,
  reason: string,
): Promise<boolean> {
  if (state.canaryEvidenceId == null) return false;
  const recorded = await invalidateRecoveryCanaryIfPassed(state.canaryEvidenceId, reason);
  if (recorded) {
    try {
      await writeGovernanceReceipt({
        receipt_id: `recovery-canary-breach-${crypto.randomUUID()}`,
        session_id: sessionId,
        actor_id: actorId,
        tool_name: toolName,
        args_hash: hashGovernanceArguments(args).slice(0, 32),
        decision: 'DENIED_BLOCKED',
        crs: { C: state.C, R: state.R, S: state.S, M: state.M, risk_level: 'BLOCKED' },
        reason: `Recovery canary invalidated before dispatch: ${reason}`,
        sigma_viol: state.sigmaViol,
      });
    } catch {
      // Invalidation is fail-closed even if audit storage is unavailable.
    }
  }
  return recorded;
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
  ownerId = 'operator',
): Promise<GovernedToolExecution> {
  // Internal grant metadata is injected only by the authenticated MCP route after a read-only match.
  // Strip it before hashing arguments, classification, or invoking any tool adapter.
  const scopedGrantId = typeof args.__scoped_grant_id === 'string' ? args.__scoped_grant_id : undefined;
  if (scopedGrantId) {
    args = { ...args };
    delete args.__scoped_grant_id;
  }

  // Reference-monitor admission: capability must be explicitly registered.
  // Never infer authority from an unknown tool name or caller-supplied label.
  let capability: ToolCapabilityRecord;
  try {
    capability = resolveToolCapability(toolName, args);
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
    const receiptWarning = await persistExecutorDenialReceipt({
      receiptId: unknownDecision.receipt_id,
      sessionId,
      actorId,
      toolName,
      args,
      decision: unknownDecision.decision,
      crs: unknownDecision.crs,
      sigmaViol: unknownDecision.sigma_viol,
      reason: unknownDecision.reason,
    });
    if (receiptWarning) unknownDecision.warning = `${unknownDecision.warning} ${receiptWarning}`;
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

  let canonicalRead = await readCanonicalGovernanceState({
    sessionId,
    actorId,
    capability: capability.capability,
    authorization: capability.approvalRequired ? 'approval_required' : 'authorized',
  });

  // Advance recovery at most once per request, only when thresholds are
  // unmet and no passing canary is bound to this state. Never invalidate
  // verified evidence as a side effect of an approval attempt or a retry.
  let recoveryNote = '';
  if (shouldAdvanceRecoveryBeforeTool(toolName, args)
    && canonicalRead.available
    && shouldAdvanceRecoveryPlane(canonicalRead.state)) {
    try {
      const recovery = await advanceRecoveryPlane(sessionId);
      recoveryNote = ` Recovery plane: ${recovery.state}; M=${recovery.M.toFixed(3)}; n_stable=${recovery.nStable}; velocity=${recovery.velocity.toFixed(4)}.`;
      canonicalRead = await readCanonicalGovernanceState({
        sessionId,
        actorId,
        capability: capability.capability,
        authorization: capability.approvalRequired ? 'approval_required' : 'authorized',
      });
    } catch (error) {
      recoveryNote = ` Recovery plane unavailable (non-fatal): ${String(error).slice(0, 120)}.`;
      // The last successfully read canonical state remains authoritative.
    }
  }

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
    const receiptWarning = await persistExecutorDenialReceipt({
      receiptId: unavailableDecision.receipt_id,
      sessionId,
      actorId,
      toolName,
      args,
      decision: unavailableDecision.decision,
      crs: unavailableDecision.crs,
      sigmaViol: unavailableDecision.sigma_viol,
      reason: unavailableDecision.reason,
    });
    if (receiptWarning) unavailableDecision.warning = `${unavailableDecision.warning} ${receiptWarning}`;
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
    // The preflight recovery pulse above is the only mutation allowed for this
    // request. A second pulse here would double-count stability observations.
    const initialBreach = !isNonMutatingGovernanceTool(toolName, args)
      ? recoveryBandBreachReason(canonicalRead.state)
      : null;
    if (initialBreach) {
      await recordRecoveryBandBreach(canonicalRead.state, sessionId, actorId, toolName, args, initialBreach);
    }

    const canonicalDecision: ToolCallDecision = {
      approved: false,
      decision: 'DENIED_BLOCKED',
      reason: `${canonicalGate.reason ?? 'Canonical governance state denied execution.'}${recoveryNote}`,
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
      warning: 'Canonical governance state is authoritative for execution health; recovery is handled separately and never grants execution authority.',
    };
    const receiptWarning = await persistExecutorDenialReceipt({
      receiptId: canonicalDecision.receipt_id,
      sessionId,
      actorId,
      toolName,
      args,
      decision: canonicalDecision.decision,
      crs: canonicalDecision.crs,
      sigmaViol: canonicalDecision.sigma_viol,
      reason: canonicalDecision.reason,
    });
    if (receiptWarning) canonicalDecision.warning = `${canonicalDecision.warning} ${receiptWarning}`;
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

  // A match is only a candidate authorization. Do not spend the grant until both
  // the interceptor and centralized policy approve and execution is about to dispatch.
  const hasScopedGrantMatch = Boolean(scopedGrantId);

  const decision = await interceptToolCall({
    id: crypto.randomUUID(),
    name: toolName,
    arguments: args,
    session_id: sessionId,
    actor_id: actorId,
    task_context: safeTaskContext(toolName, args, taskContext, capability),
  });
  let policy = evaluateToolGovernance({
    toolName,
    args,
    sessionId,
    actorId,
    authorized: true,
    approvalToken: args.approval_token,
  });
  if (hasScopedGrantMatch && policy.decision === 'approval_required') {
    policy = {
      ...policy,
      decision: 'allow',
      reasons: [...policy.reasons, 'A matching owner-scoped grant may replace per-action approval only after interceptor approval; recovery and CRS governance remain enforced.'],
    };
  }
  const approvalRequestId = typeof args.approval_request_id === 'string'
    ? args.approval_request_id
    : undefined;
  if (approvalRequestId && (!policy.requiresApproval || args.approval_token !== undefined)) {
    policy = {
      ...policy,
      decision: 'deny',
      reasons: ['approval_request_id is valid only for an approval-gated action and cannot be combined with approval_token.'],
    };
  }
  const requestApprovalCanReplaceToken = Boolean(
    hasScopedGrantMatch
    || (approvalRequestId
      && args.approval_token === undefined
      && policy.requiresApproval
      && policy.decision === 'approval_required'),
  );

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

  if (policy.decision !== 'allow' && !requestApprovalCanReplaceToken) {
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

  let consumedApprovalRequestId: string | undefined;
  let consumedApprovalTokenId: string | undefined;
  const releaseConsumedApproval = async (): Promise<boolean | undefined> => {
    if (consumedApprovalRequestId) {
      return releaseConsumedApprovalRequest({
        requestId: consumedApprovalRequestId,
        ownerId,
        sessionId,
        toolName,
        args,
      });
    }
    if (consumedApprovalTokenId) {
      return releaseConsumedGovernanceApprovalToken({
        approvalId: consumedApprovalTokenId,
        actorId,
        sessionId,
        toolName,
      });
    }
    return undefined;
  };

  // Cancellation before consumption must not burn a single-use approval.
  if (signal?.aborted) {
    const released = await releaseConsumedApproval();
    const releaseStatus = released === true ? 'restored' : released === false ? 'failed' : 'not_needed';
    const cancellationDecision: ToolCallDecision = {
      ...decision,
      approved: false,
      decision: 'DENIED_BLOCKED',
      reason: 'Cancellation was observed before action dispatch.',
      warning: released === false
        ? 'The tool function was not invoked, but approval restoration failed.'
        : 'The tool function was not invoked; consumed approval was restored when applicable.',
    };
    const verification = verifyToolResult(toolName, undefined, policy.risk);
    return {
      result: report(toolName, cancellationDecision, `EXECUTION_STATUS=not_started_after_cancellation; approval_release=${releaseStatus}; the tool function was not invoked.`, false, policy, verification, canonicalRead.state),
      approved: false,
      decision: 'EXECUTION_CANCELLED_BEFORE_START',
      receiptId: cancellationDecision.receipt_id ?? null,
      risk: policy.risk,
      policy,
      verification,
    };
  }

  if (policy.requiresApproval && !hasScopedGrantMatch) {
    const consumed = approvalRequestId
      ? await consumeApprovalRequest({
        requestId: approvalRequestId,
        ownerId,
        sessionId,
        toolName,
        args,
      })
      : await consumeGovernanceApprovalToken({
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
    if (approvalRequestId) {
      consumedApprovalRequestId = approvalRequestId;
      policy = {
        ...policy,
        decision: 'allow',
        approvalId: approvalRequestId,
        reasons: [...policy.reasons, 'Operator approval request was consumed exactly once for this exact action.'],
      };
    } else if ('approvalId' in consumed && typeof consumed.approvalId === 'string') {
      consumedApprovalTokenId = consumed.approvalId;
    }

    // Cancellation may arrive while the durable single-use consumption is in
    // flight. Restore the approval only if the action has not been dispatched.
    if (signal?.aborted) {
      const released = await releaseConsumedApproval();
      const releaseStatus = released === true ? 'restored' : released === false ? 'failed' : 'not_needed';
      const cancelledDecision: ToolCallDecision = {
        ...decision,
        approved: false,
        decision: 'DENIED_BLOCKED',
        reason: 'Cancellation was observed after approval consumption but before action dispatch.',
        warning: released === false
          ? 'The action was not invoked, but approval restoration failed; request a new approval if the original cannot be reused.'
          : 'The action was not invoked; any consumed approval was restored when safe.',
      };
      const verification = verifyToolResult(toolName, undefined, policy.risk);
      return {
        result: report(toolName, cancelledDecision, `EXECUTION_STATUS=not_started_after_cancellation; approval_release=${releaseStatus}.`, false, policy, verification, canonicalRead.state),
        approved: false,
        decision: 'EXECUTION_CANCELLED_BEFORE_START',
        receiptId: cancelledDecision.receipt_id ?? null,
        risk: policy.risk,
        policy,
        verification,
      };
    }
  }

  // The cached value itself is never an authorization artifact. Recheck the
  // kernel immediately before serving it; if that state read fails, emit a
  // separate actor-attributed denial receipt where storage is available.
  if (EXECUTOR_READ_TOOLS.has(toolName)) {
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
    const released = await releaseConsumedApproval();
    const releaseStatus = released === true ? 'restored' : released === false ? 'failed' : 'not_needed';
    const cancellationDecision: ToolCallDecision = {
      ...decision,
      approved: false,
      decision: 'DENIED_BLOCKED',
      reason: 'Cancellation was observed before action dispatch.',
      warning: released === false
        ? 'The tool function was not invoked, but approval restoration failed.'
        : 'The tool function was not invoked; consumed approval was restored when applicable.',
    };
    const verification = verifyToolResult(toolName, undefined, policy.risk);
    return {
      result: report(toolName, cancellationDecision, `EXECUTION_STATUS=not_started_after_cancellation; approval_release=${releaseStatus}; the tool function was not invoked.`, false, policy, verification, canonicalRead.state),
      approved: false,
      decision: 'EXECUTION_CANCELLED_BEFORE_START',
      receiptId: cancellationDecision.receipt_id ?? null,
      risk: policy.risk,
      policy,
      verification,
    };
  }

  // Re-read canonical state after interceptor/policy/approval checks and
  // immediately before dispatch of every consequential action. A band breach
  // is recorded by exactly one conditional passed-to-invalidated transition.
  if (!isNonMutatingGovernanceTool(toolName, args)) {
    const dispatchRead = await readCanonicalGovernanceState({
      sessionId,
      actorId,
      capability: capability.capability,
      authorization: capability.approvalRequired ? 'approval_required' : 'authorized',
    });
    const dispatchState = dispatchRead.available ? dispatchRead.state : undefined;
    const bandBreach = dispatchState ? recoveryBandBreachReason(dispatchState) : null;
    const dispatchGate = dispatchState
      ? canonicalExecutionAllowed(dispatchState, capability.bootstrapAllowed === true)
      : { allowed: false, reason: bandBreach };
    if (!dispatchGate.allowed || bandBreach) {
      let breachRecorded = false;
      if (dispatchState && bandBreach) {
        breachRecorded = await recordRecoveryBandBreach(dispatchState, sessionId, actorId, toolName, args, bandBreach);
      }
      const released = await releaseConsumedApproval();
      const denial: ToolCallDecision = {
        ...decision,
        approved: false,
        decision: 'DENIED_BLOCKED',
        reason: bandBreach ?? dispatchGate.reason ?? 'Canonical governance state denied execution before dispatch.',
        warning: released === false
          ? 'Consumed approval restoration failed; request a new approval.'
          : breachRecorded ? 'Recovery canary breach recorded and permanently invalidated.' : undefined,
      };
      const verification = verifyToolResult(toolName, undefined, policy.risk);
      return {
        result: report(toolName, denial, undefined, false, policy, verification, canonicalRead.state, dispatchState),
        approved: false,
        decision: denial.decision,
        receiptId: denial.receipt_id ?? null,
        risk: policy.risk,
        policy,
        verification,
      };
    }
  }

  // Spend the grant only after all canonical, interceptor, centralized-policy,
  // cancellation, and approval checks have passed. consumeScopedGrant atomically
  // checks scope/use limits, increments uses, and writes the single use receipt.
  // A thrown/ambiguous transaction is treated exactly like a failed match.
  let scopedGrantUse: { grantId: string; useNumber: number; receiptId: string } | null = null;
  if (scopedGrantId) {
    try {
      scopedGrantUse = await consumeScopedGrant({
        grantId: scopedGrantId, ownerId, toolName, args, sessionId, actorId,
      });
    } catch {
      scopedGrantUse = null;
    }
    if (!scopedGrantUse) {
      return {
        result: 'SCOPED_GRANT_FALLBACK_APPROVAL',
        approved: false,
        decision: 'SCOPED_GRANT_FALLBACK_APPROVAL',
        receiptId: null,
        risk: capability.capability,
      };
    }
  }

  // Approval metadata is for the reference monitor only. Never forward a
  // bearer approval token or request identifier to the underlying tool adapter.
  const handlerArgs = { ...args };
  for (const key of ['approval_token', 'approval_id', 'approval_request_id', 'approval', 'approval_request']) {
    delete handlerArgs[key];
  }

  const cached = await cache.getOrExecuteAuthorized({
    key: keyFor(sessionId, toolName, args),
    toolName,
    decision,
    execute: () => {
      if (!approvalRequestId) return toolFn(handlerArgs, signal);
      return withConsumedApproval({
        requestId: approvalRequestId,
        ownerId,
        sessionId,
        toolName,
        argsHash: approvalArgsHash(args),
      }, () => toolFn(handlerArgs, signal));
    },
  });

  const verification = verifyToolResult(toolName, cached.value, policy.risk);
  if (shouldRecordTrajectoryObservation(toolName, args, cached.cacheHit)) {
    try {
      const previous = await getZTraj(sessionId);
      await recordZTrajObservation(
        sessionId,
        previous ? {
          last_c: previous.last_c,
          last_r: previous.last_r,
          last_s: previous.last_s,
          sigma_viol: previous.sigma_viol,
          updated_at: previous.updated_at,
        } : null,
        {
          c: cached.decision.crs.C,
          r: cached.decision.crs.R,
          s: cached.decision.crs.S,
        },
      );
    } catch {
      // Observation is best-effort; never alter a verified tool result or
      // authorize/revoke execution because this non-authoritative write failed.
    }
  }
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
  ownerId = 'operator',
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
    ownerId,
  );
  return execution.result;
}
