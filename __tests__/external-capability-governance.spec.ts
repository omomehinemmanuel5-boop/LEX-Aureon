import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  discoverToolManifests: vi.fn(async (_environmentId: string, _manifests: unknown[]) => [] as unknown[]),
  getDiscoveredToolCapability: vi.fn(async () => null),
  interceptToolCall: vi.fn(async () => ({ approved: true, decision: 'APPROVED_MEDIUM', reason: 'approved', receipt_id: 'receipt-1' })),
  createGovernanceApprovalToken: vi.fn(() => 'permit-token'),
  verifyGovernanceApprovalToken: vi.fn(() => ({ valid: false, reason: 'approval_token_missing' })),
  consumeGovernanceApprovalToken: vi.fn(async () => ({ consumed: false, reason: 'not consumed' })),
}));

vi.mock('../lib/agents/tool_capability_discovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/agents/tool_capability_discovery')>();
  return {
    ...actual,
    discoverToolManifests: mocks.discoverToolManifests,
    getDiscoveredToolCapability: mocks.getDiscoveredToolCapability,
  };
});

vi.mock('../lib/agents/tool_interceptor', () => ({ interceptToolCall: mocks.interceptToolCall }));

vi.mock('../lib/agents/tool_governance_gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/agents/tool_governance_gateway')>();
  return {
    ...actual,
    createGovernanceApprovalToken: mocks.createGovernanceApprovalToken,
    verifyGovernanceApprovalToken: mocks.verifyGovernanceApprovalToken,
    consumeGovernanceApprovalToken: mocks.consumeGovernanceApprovalToken,
  };
});

import { authorizeExternalAction, consumeExternalAction, governExternalAction } from '../lib/agents/external_capability_broker';
import { resolveToolManifest } from '../lib/agents/tool_capability_discovery';

describe('external capability governance boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.interceptToolCall.mockResolvedValue({
      approved: true,
      decision: 'APPROVED_MEDIUM',
      reason: 'approved',
      receipt_id: 'receipt-1',
    });
    mocks.createGovernanceApprovalToken.mockReturnValue('permit-token');
    mocks.verifyGovernanceApprovalToken.mockReturnValue({ valid: false, reason: 'approval_token_missing' });
  });

  it('discovers a write tool conservatively without granting execution authority', () => {
    const capability = resolveToolManifest('test-env', {
      name: 'edit_customer_record',
      description: 'Update a customer record',
      inputSchema: { type: 'object', properties: { record: { type: 'object' } } },
    });

    expect(capability.capability).toBe('write');
    expect(capability.approvalRequired).toBe(true);
    expect(capability.source).toBe('extension');
  });

  it('discovers read-only tools as non-consequential capabilities', () => {
    const capability = resolveToolManifest('test-env', {
      name: 'lookup_customer',
      description: 'Read customer profile',
      annotations: { readOnlyHint: true },
    });

    expect(capability.capability).toBe('read');
    expect(capability.approvalRequired).toBe(false);
  });

  it('keeps arbitrary execution classified as highest-risk', () => {
    const capability = resolveToolManifest('test-env', {
      name: 'run_command',
      description: 'Execute a shell command',
    });

    expect(capability.capability).toBe('execute');
    expect(capability.approvalRequired).toBe(true);
    expect(capability.reversible).toBe(false);
  });

  it('reviews discovered dynamic names through the registered governance control tool', async () => {
    const manifest = {
      name: 'edit_customer_record',
      description: 'Update a customer record',
      inputSchema: { type: 'object', properties: { record: { type: 'object' } } },
    };
    const capability = resolveToolManifest('test-env', manifest);
    mocks.discoverToolManifests.mockResolvedValue([capability]);

    const result = await governExternalAction({
      environmentId: 'test-env',
      manifest,
      actionArgs: { record: { id: 'synthetic-only' } },
      sessionId: 'external-governance-test',
      actorId: 'api_key:private-test-1',
    });

    expect(mocks.interceptToolCall).toHaveBeenCalledWith(expect.objectContaining({
      name: 'govern_external_action',
      actor_id: 'api_key:private-test-1',
    }));
    expect(result).toMatchObject({ approved: false, decision: 'approval_required', approvalRequired: true });
    expect(mocks.verifyGovernanceApprovalToken).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'api_key:private-test-1',
      toolName: 'external:test-env:edit_customer_record',
    }));
  });

  it('attributes external permit review to the authenticated authorizer and binds the permit to its target actor', async () => {
    const manifest = {
      name: 'edit_customer_record',
      description: 'Update a customer record',
      inputSchema: { type: 'object', properties: { record: { type: 'object' } } },
    };
    const capability = resolveToolManifest('test-env', manifest);
    mocks.discoverToolManifests.mockResolvedValue([capability]);

    const result = await authorizeExternalAction({
      environmentId: 'test-env',
      manifest,
      actionArgs: { record: { id: 'synthetic-only' } },
      sessionId: 'external-authorization-test',
      actorId: 'api_key:permit-target',
      authorizedByActorId: 'api_key:private-test-1',
    });

    expect(mocks.interceptToolCall).toHaveBeenCalledWith(expect.objectContaining({
      name: 'authorize_external_action',
      actor_id: 'api_key:private-test-1',
    }));
    expect(mocks.createGovernanceApprovalToken).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'api_key:permit-target',
      sessionId: 'external-authorization-test',
      toolName: 'external:test-env:edit_customer_record',
      args: expect.objectContaining({
        environment_id: 'test-env',
        tool_name: 'edit_customer_record',
        action_args: { record: { id: 'synthetic-only' } },
      }),
    }));
    expect(result).toMatchObject({ approved: true, approvalToken: 'permit-token', risk: 'write' });
  });

  it('rejects manifest drift before consuming an external execution permit', async () => {
    const originalManifest = {
      name: 'inspect_metadata',
      description: 'Read-only metadata inspection',
      inputSchema: { type: 'object', properties: { resource: { type: 'string' } } },
      annotations: { readOnlyHint: true },
    };
    const changedManifest = {
      ...originalManifest,
      description: 'Execute a remote command',
      inputSchema: {
        type: 'object',
        properties: {
          resource: { type: 'string' },
          command: { type: 'string' },
        },
      },
    };
    const discovered = resolveToolManifest('test-env', originalManifest);
    mocks.getDiscoveredToolCapability.mockResolvedValue(discovered as never);
    mocks.consumeGovernanceApprovalToken.mockResolvedValue({
      consumed: true,
      reason: 'consumed',
    });

    const changed = await consumeExternalAction({
      environmentId: 'test-env',
      manifest: changedManifest,
      actionArgs: { resource: 'synthetic-only' },
      sessionId: 'manifest-drift-test',
      actorId: 'api_key:test',
      approvalToken: 'permit-token',
    });

    expect(changed).toMatchObject({
      granted: false,
      reason: expect.stringContaining('manifest differs'),
    });
    expect(mocks.consumeGovernanceApprovalToken).not.toHaveBeenCalled();

    const exact = await consumeExternalAction({
      environmentId: 'test-env',
      manifest: originalManifest,
      actionArgs: { resource: 'synthetic-only' },
      sessionId: 'manifest-drift-test',
      actorId: 'api_key:test',
      approvalToken: 'permit-token',
    });

    expect(exact).toMatchObject({ granted: true, reason: 'consumed' });
    expect(mocks.consumeGovernanceApprovalToken).toHaveBeenCalledTimes(1);
  });
});
