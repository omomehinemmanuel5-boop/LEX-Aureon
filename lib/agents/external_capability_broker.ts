import crypto from 'crypto';
import {
  discoverToolManifests,
  getDiscoveredToolCapability,
  type ToolManifest,
  type ResolvedToolCapability,
} from './tool_capability_discovery';
import { interceptToolCall } from './tool_interceptor';
import {
  createGovernanceApprovalToken,
  verifyGovernanceApprovalToken,
  consumeGovernanceApprovalToken,
} from './tool_governance_gateway';

export type ExternalActionDecision =
  | 'allow'
  | 'approval_required'
  | 'deny';

export interface ExternalActionEnvelope {
  environmentId: string;
  toolName: string;
  manifestHash: string;
  actionArgs: Record<string, unknown>;
}

function stableToolName(environmentId: string, toolName: string): string {
  return `external:${environmentId}:${toolName}`;
}

function actionEnvelope(input: {
  environmentId: string;
  capability: ResolvedToolCapability;
  actionArgs: Record<string, unknown>;
}): ExternalActionEnvelope {
  return {
    environmentId: input.environmentId,
    toolName: input.capability.name,
    manifestHash: input.capability.manifestHash,
    actionArgs: input.actionArgs,
  };
}

function tokenArgs(envelope: ExternalActionEnvelope): Record<string, unknown> {
  return {
    environment_id: envelope.environmentId,
    tool_name: envelope.toolName,
    manifest_hash: envelope.manifestHash,
    action_args: envelope.actionArgs,
  };
}

function riskFor(capability: ResolvedToolCapability): 'read' | 'write' | 'external' | 'destructive' {
  switch (capability.capability) {
    case 'read': return 'read';
    case 'write': return 'write';
    case 'external':
    case 'network':
    case 'delegate': return 'external';
    case 'destructive':
    case 'execute':
    case 'financial':
    case 'identity': return 'destructive';
  }
}

export async function discoverExternalTool(
  environmentId: string,
  manifest: ToolManifest,
): Promise<ResolvedToolCapability> {
  const results = await discoverToolManifests(environmentId, [manifest]);
  return results[0];
}

export async function governExternalAction(input: {
  environmentId: string;
  manifest: ToolManifest;
  actionArgs: Record<string, unknown>;
  sessionId: string;
  actorId: string;
  approvalToken?: unknown;
  taskContext?: string;
}): Promise<{
  approved: boolean;
  decision: ExternalActionDecision;
  risk: string;
  capability: ResolvedToolCapability;
  receiptId?: string;
  approvalRequired: boolean;
  approvalToken?: string;
  reason: string;
}> {
  const capability = await discoverExternalTool(input.environmentId, input.manifest);
  const envelope = actionEnvelope({
    environmentId: input.environmentId,
    capability,
    actionArgs: input.actionArgs,
  });
  const toolName = stableToolName(input.environmentId, capability.name);
  const review = await interceptToolCall({
    id: crypto.randomUUID(),
    name: toolName,
    arguments: tokenArgs(envelope),
    session_id: input.sessionId,
    actor_id: input.actorId,
    task_context: input.taskContext ?? `Govern external action ${capability.name}`,
  });

  if (!review.approved) {
    return {
      approved: false,
      decision: 'deny',
      risk: riskFor(capability),
      capability,
      receiptId: review.receipt_id,
      approvalRequired: capability.approvalRequired,
      reason: review.reason,
    };
  }

  if (capability.approvalRequired) {
    const verified = verifyGovernanceApprovalToken({
      token: input.approvalToken,
      actorId: input.actorId,
      sessionId: input.sessionId,
      toolName,
      args: tokenArgs(envelope),
    });
    if (!verified.valid) {
      return {
        approved: false,
        decision: 'approval_required',
        risk: riskFor(capability),
        capability,
        receiptId: review.receipt_id,
        approvalRequired: true,
        reason: verified.reason,
      };
    }
    return {
      approved: true,
      decision: 'allow',
      risk: riskFor(capability),
      capability,
      receiptId: review.receipt_id,
      approvalRequired: true,
      approvalToken: input.approvalToken as string,
      reason: 'Exact discovered capability and action passed Lex governance; execution must still pass consume_external_action immediately before the client-side adapter runs.',
    };
  }

  return {
    approved: true,
    decision: 'allow',
    risk: 'read',
    capability,
    receiptId: review.receipt_id,
    approvalRequired: false,
    reason: 'Discovered read-only capability passed Lex governance.',
  };
}

export async function authorizeExternalAction(input: {
  environmentId: string;
  manifest: ToolManifest;
  actionArgs: Record<string, unknown>;
  sessionId: string;
  taskContext?: string;
}): Promise<{
  approved: boolean;
  approvalToken?: string;
  approvalId?: string;
  receiptId?: string;
  risk?: string;
  reason: string;
}> {
  const capability = await discoverExternalTool(input.environmentId, input.manifest);
  const envelope = actionEnvelope({
    environmentId: input.environmentId,
    capability,
    actionArgs: input.actionArgs,
  });
  const toolName = stableToolName(input.environmentId, capability.name);
  const review = await interceptToolCall({
    id: crypto.randomUUID(),
    name: toolName,
    arguments: tokenArgs(envelope),
    session_id: input.sessionId,
    actor_id: 'operator',
    task_context: input.taskContext ?? `Operator authorization for external action ${capability.name}`,
  });
  if (!review.approved) {
    return {
      approved: false,
      receiptId: review.receipt_id,
      risk: riskFor(capability),
      reason: review.reason,
    };
  }
  const approvalId = crypto.randomUUID();
  const approvalToken = createGovernanceApprovalToken({
    actorId: 'external-client',
    sessionId: input.sessionId,
    toolName,
    args: tokenArgs(envelope),
    approvalId,
  });
  return {
    approved: true,
    approvalToken,
    approvalId,
    receiptId: review.receipt_id,
    risk: riskFor(capability),
    reason: 'Operator-authorized, action-bound external execution permit issued.',
  };
}

export async function consumeExternalAction(input: {
  environmentId: string;
  manifest: ToolManifest;
  actionArgs: Record<string, unknown>;
  sessionId: string;
  approvalToken: string;
}): Promise<{ granted: boolean; approvalId?: string; reason: string }> {
  const capability = await getDiscoveredToolCapability(input.environmentId, input.manifest.name);
  if (!capability) return { granted: false, reason: 'Discovered capability is missing or expired; rediscover before execution.' };
  const envelope = actionEnvelope({
    environmentId: input.environmentId,
    capability,
    actionArgs: input.actionArgs,
  });
  const toolName = stableToolName(input.environmentId, capability.name);
  const consumed = await consumeGovernanceApprovalToken({
    token: input.approvalToken,
    actorId: 'external-client',
    sessionId: input.sessionId,
    toolName,
    args: tokenArgs(envelope),
  });
  return {
    granted: consumed.consumed,
    approvalId: consumed.approvalId,
    reason: consumed.reason,
  };
}
