import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeGovernedTool, executeGovernedToolStructured, recordRecoveryCanaryEvidence, readCanonicalGovernanceState, canonicalExecutionAllowed, advanceRecoveryPlane, shouldAdvanceRecoveryPlane, ensureCanonicalTrajectoryState, toolFn, definitions, validateApiKey, validateAndConsumeKey, checkRateLimit, isOperatorSecret, interceptToolCall, createGovernanceApprovalToken, createApprovalRequest } = vi.hoisted(() => ({
  executeGovernedTool: vi.fn(),
  executeGovernedToolStructured: vi.fn(),
  ensureCanonicalTrajectoryState: vi.fn(async () => true),
  recordRecoveryCanaryEvidence: vi.fn(async () => {}),
  readCanonicalGovernanceState: vi.fn(),
  canonicalExecutionAllowed: vi.fn(() => ({ allowed: true })),
  advanceRecoveryPlane: vi.fn(async () => {}),
  shouldAdvanceRecoveryPlane: vi.fn((state: { trajectoryAvailable?: boolean; M?: number; nStable?: number; canaryPassed?: boolean }) =>
    state.trajectoryAvailable === true && (state.M ?? 0) >= 0.05 && state.canaryPassed !== true
      && ((state.M ?? 0) < 0.15 || (state.nStable ?? 0) < 3)),
  toolFn: vi.fn(async () => 'TOOL_RESULT'),
  validateApiKey: vi.fn(async () => ({ valid: true, key: {} })),
  validateAndConsumeKey: vi.fn(async () => ({ valid: true, key: {} })),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59, retryAfter: 0, storageError: false })),
  isOperatorSecret: vi.fn(),
  interceptToolCall: vi.fn(async () => ({ approved: true, decision: 'approved', reason: 'allowed', receipt_id: 'approval-receipt' })),
  createGovernanceApprovalToken: vi.fn(() => 'approval-token'),
  createApprovalRequest: vi.fn(async () => ({ requestId: 'a'.repeat(22), expiresAt: Date.now() + 900_000 })),
  definitions: [
    { name: 'request_approval', description: 'request', parameters: { type: 'object' } },
    { name: 'run_governance', description: 'govern', parameters: { type: 'object' } },
    { name: 'get_constitutional_state', description: 'state', parameters: { type: 'object' } },
    { name: 'run_recovery_canary', description: 'canary', parameters: { type: 'object' } },
    { name: 'read_file', description: 'read', parameters: { type: 'object' } },
    { name: 'write_file', description: 'write', parameters: { type: 'object' } },
    { name: 'dispatch_workflow', description: 'dispatch', parameters: { type: 'object' } },
    { name: 'query_database', description: 'database', parameters: { type: 'object' } },
    { name: 'authorize_tool_action', description: 'authorize', parameters: { type: 'object' } },
  ],
}));

const externalBrokerMocks = vi.hoisted(() => ({
  discoverExternalTool: vi.fn(async () => ({ name: 'edit_record', capability: 'write', approvalRequired: true })),
  governExternalAction: vi.fn(async () => ({
    approved: false, decision: 'approval_required', risk: 'write',
    capability: { name: 'edit_record' }, receiptId: 'external-review',
    approvalRequired: true, reason: 'Human approval required.',
  })),
  consumeExternalAction: vi.fn(async () => ({ granted: false, reason: 'not consumed' })),
}));

vi.mock('../lib/agents/external_capability_broker', () => externalBrokerMocks);

vi.mock('next/server', () => ({
  NextResponse: class MockNextResponse {
    status = 200;
    body: unknown;
    constructor(body: unknown = null, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(body: unknown, init?: { status?: number }) {
      return new MockNextResponse(body, init);
    }
  },
}));

vi.mock('@/lib/api_keys', () => ({
  validateAndConsumeKey,
  validateApiKey,
}));

vi.mock('@/lib/rate_limit', () => ({ checkRateLimit }));

vi.mock('@/lib/lex_crs_agent/mcp_access', async () => {
  const actual = await vi.importActual<typeof import('../lib/lex_crs_agent/mcp_access')>('../lib/lex_crs_agent/mcp_access');
  return { ...actual, isOperatorSecret };
});

vi.mock('@/lib/db', () => ({
  recordMcpClientIdentity: vi.fn(async () => {}),
  runZTrajMigrations: vi.fn(async () => {}),
}));

vi.mock('@/lib/approval_requests', () => ({ createApprovalRequest }));

vi.mock('../lib/agents/canonical_governance_state', () => ({
  ensureCanonicalTrajectoryState,
  readCanonicalGovernanceState,
  canonicalExecutionAllowed,
}));

vi.mock('../lib/agents/recovery_runtime', () => ({ advanceRecoveryPlane, shouldAdvanceRecoveryPlane }));

vi.mock('../lib/agents/recovery_canary_evidence', () => ({ recordRecoveryCanaryEvidence }));

vi.mock('../lib/lex_crs_agent/tools', () => ({
  TOOL_DEFINITIONS: definitions,
  TOOL_REGISTRY: {
    request_approval: toolFn,
    run_governance: toolFn,
    get_constitutional_state: toolFn,
    run_recovery_canary: toolFn,
    read_file: toolFn,
    write_file: toolFn,
  },
}));

vi.mock('../lib/lex_crs_agent/tools/patch_file', () => ({
  PATCH_FILE_DEFINITION: { name: 'patch_file', description: 'patch', inputSchema: { type: 'object' } },
  patch_file: toolFn,
}));

vi.mock('../lib/agents/constitutional_tool_executor', () => ({
  executeGovernedTool,
  executeGovernedToolStructured,
}));

vi.mock('@/lib/agents/tool_interceptor', () => ({ interceptToolCall }));

vi.mock('@/lib/agents/tool_governance_gateway', async () => {
  const actual = await vi.importActual<typeof import('../lib/agents/tool_governance_gateway')>(
    '../lib/agents/tool_governance_gateway',
  );
  return { ...actual, createGovernanceApprovalToken };
});

// fix (2026-09-06): route.ts now checks getTrajectoryState(sessionId) before
// every dispatch (trajectory-aware routing). This test is specifically about
// the BARE per-call dispatch boundary — no trajectory involved — so mock
// the store to always report "no active trajectory," matching this test's
// actual scenario, rather than letting it fall through to a real (Turso)
// DB call this test doesn't otherwise set up.
vi.mock('../lib/agents/trajectory_session_store', () => ({
  getTrajectoryState: vi.fn(async () => undefined),
  setTrajectoryState: vi.fn(async () => {}),
  clearTrajectoryState: vi.fn(async () => {}),
  isTrajectoryActive: () => false,
}));

import { POST } from '../app/api/mcp/route';

function request(body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // validateAndConsumeKey is mocked to always resolve { valid: true }
      // above, so the actual value here is irrelevant — it just needs to
      // be present, since /api/mcp now rejects any tools/call request
      // with no API key before it ever reaches executeGovernedTool.
      'x-lex-api-key': 'test-key',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

describe('MCP constitutional dispatch boundary', () => {
  it('publishes approval_request_id for approval-gated tools without adding it to read-only tools', async () => {
    validateApiKey.mockResolvedValue({ valid: true, key: { id: 'private-test-1', plan: 'private_test' } });
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 'approval-schema-catalog',
    }));
    expect(response.status).toBe(200);
    const body = response.body as unknown as { result: { tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }> } };
    const writeTool = body.result.tools.find(tool => tool.name === 'write_file');
    const readTool = body.result.tools.find(tool => tool.name === 'read_file');
    expect(writeTool).toBeDefined();
    expect(writeTool?.inputSchema.properties).toHaveProperty('approval_request_id');
    expect(readTool).toBeDefined();
    expect(readTool?.inputSchema.properties?.approval_request_id).toBeUndefined();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    validateApiKey.mockResolvedValue({ valid: true, key: {} });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key: {} });
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59, retryAfter: 0, storageError: false });
    isOperatorSecret.mockReturnValue(false);
    toolFn.mockResolvedValue('TOOL_RESULT');
    readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: {
        sessionId: 'owner-a:session', actorId: 'api_key:owner-a', C: 1, R: 1, S: 1, M: 1,
        healthBand: 'OPTIMAL', recoveryState: 'NORMAL', sigmaViol: 0, toolCalls: 0,
        trajectoryAvailable: true, nStable: 3, canaryPassed: true,
        stateFingerprint: 'a'.repeat(64), trajectoryUpdatedAt: '2026-10-15T00:00:00.000Z',
        authorization: 'approval_required', policyRisk: 'write', version: 'test', observedAt: '2026-10-15T00:00:00.000Z',
      },
    });
    recordRecoveryCanaryEvidence.mockResolvedValue(undefined);
    executeGovernedTool.mockResolvedValue('approved:    true\\ncache_hit:   false\\nTOOL_RESULT');
    executeGovernedToolStructured.mockImplementation(async (_name, args, handler) => {
      const raw = await handler(args);
      return { result: raw, approved: true, receiptId: 'canary-test-receipt' };
    });
  });

  it('logs only the MCP credential path and identifies the Connect Lex challenge path', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const authenticated = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_constitutional_state', arguments: { session_id: 'public-inspector:session' } },
      id: 'credential-path-api-key',
    }));
    expect(authenticated.status).toBe(200);
    expect(log).toHaveBeenCalledWith('[mcp-auth]', expect.stringContaining('"credential_path":"api_key"'));
    expect(log.mock.calls.map(call => String(call[1])).join('\n')).not.toContain('test-key');

    log.mockClear();
    const missingCredential = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_constitutional_state', arguments: {} },
      id: 'credential-path-missing',
    }, { 'x-lex-api-key': '' }));
    expect(missingCredential.status).toBe(200);
    expect((missingCredential.body as { result?: { content?: Array<{ text?: string }>; _meta?: Record<string, unknown> } }).result?.content?.[0]?.text)
      .toContain('Connect Lex Aureon');
    expect(log).toHaveBeenCalledWith('[mcp-auth]', expect.stringContaining('"credential_path":"missing"'));
    expect(log).toHaveBeenCalledWith('[mcp-auth]', expect.stringContaining('"outcome":"rejected_missing_credential"'));
    log.mockRestore();
  });

  it('does not bootstrap z_traj for read-only constitutional inspection', async () => {
    const key = { id: 'public-inspector', plan: 'free' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_constitutional_state', arguments: { session_id: 'public-inspector:session' } },
      id: 'read-only-no-bootstrap',
    }));
    expect(response.status).toBe(200);
    expect(ensureCanonicalTrajectoryState).not.toHaveBeenCalled();
    expect(executeGovernedTool).toHaveBeenCalledTimes(1);
  });

  it('allows the canary for an authenticated operator-profile key without the operator-secret header', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'run_recovery_canary', arguments: { session_id: 'private-test-1:canary-session' } },
      id: 'operator-profile-canary',
    }));
    expect(response.status).toBe(200);
    expect(executeGovernedToolStructured).toHaveBeenCalledTimes(1);
    expect(toolFn).toHaveBeenCalledTimes(1);
  });

  it('routes every exposed tool call through the constitutional executor', async () => {
    const tools = [
      ['run_governance', { prompt: 'test' }],
      ['get_constitutional_state', { session_id: 'anonymous:mine' }],
    ] as const;

    for (const [name, args] of tools) {
      const response = await POST(request({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: args },
        id: name,
      }));
      expect(response.status).toBe(200);
    }

    expect(executeGovernedTool).toHaveBeenCalledTimes(tools.length);
    expect(executeGovernedTool.mock.calls.map((call) => call[0])).toEqual([
      'run_governance',
      'get_constitutional_state',
    ]);
  });

  it('wraps plain-text tool results in an object-shaped structuredContent field', async () => {
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'run_governance', arguments: { prompt: 'test' } },
      id: 'structured-content',
    }));
    const payload = response.body as unknown as { result: { structuredContent: unknown } };
    expect(payload.result.structuredContent).toEqual({ value: 'approved:    true\\ncache_hit:   false\\nTOOL_RESULT' });
    expect(Array.isArray(payload.result.structuredContent)).toBe(false);
  });

  it('cannot set an approval request status or owner through MCP arguments', async () => {
    const key = { id: 'owner-a', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    executeGovernedTool.mockImplementation(async (_name, args, handler) =>
      (handler as (input: Record<string, unknown>) => Promise<string>)(args as Record<string, unknown>));
    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: {
        name: 'request_approval',
        arguments: {
          tool_name: 'write_file',
          arguments: { path: 'README.md', content: 'safe edit', message: 'test' },
          status: 'approved', owner_id: 'victim', decided_by: 'client',
        },
      },
      id: 'request-approval',
    }));
    expect(response.status).toBe(200);
    expect(createApprovalRequest).toHaveBeenCalledWith({
      ownerId: 'owner-a', toolName: 'write_file',
      sessionId: expect.stringMatching(/^owner-a:/),
      args: {
        path: 'README.md', content: 'safe edit', message: 'test',
        session_id: expect.stringMatching(/^owner-a:/),
      },
    });
  });

  it('does not expose or execute infrastructure tools for public API keys', async () => {
    const listResponse = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1,
    }));
    const listed = (listResponse.body as unknown as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(listed.map(tool => tool.name)).toEqual([
      'request_approval',
      'run_governance',
      'get_constitutional_state',
      'discover_external_tool',
      'govern_external_action',
      'consume_external_action',
    ]);

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '.env' } },
      id: 2,
    }));

    expect(response.status).toBe(200);
    expect((response.body as unknown as { error: { code: number } }).error.code).toBe(-32601);
    expect(executeGovernedTool).not.toHaveBeenCalled();
  });

  it('exposes authorization-control tools to authenticated private-test keys', async () => {
    validateApiKey.mockResolvedValue({ valid: true, key: { id: 'private-test-1', plan: 'private_test' } });

    const response = await POST(request({ jsonrpc: '2.0', method: 'tools/list', id: 31 }));
    const tools = (response.body as unknown as { result: { tools: Array<{ name: string }> } }).result.tools;
    const names = tools.map(tool => tool.name);

    expect(names).toContain('authorize_tool_action');
    expect(names).toContain('authorize_external_action');
    expect(names).toContain('read_file');
    expect(names).toContain('dispatch_workflow');
    expect(names).toContain('query_database');
    expect(names).toContain('run_recovery_canary');
    expect(isOperatorSecret).toHaveBeenCalled();
  });

  it('refuses a public-profile canary call before execution or evidence persistence', async () => {
    const key = { id: 'public-canary', plan: 'free' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    isOperatorSecret.mockReturnValue(false);

    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'run_recovery_canary', arguments: { session_id: 'canary-session' } },
      id: 'non-operator-canary',
    }));

    expect(response.status).toBe(200);
    expect((response.body as { error?: { code?: number } }).error?.code).toBe(-32601);
    expect(executeGovernedToolStructured).not.toHaveBeenCalled();
    expect(executeGovernedTool).not.toHaveBeenCalled();
    expect(toolFn).not.toHaveBeenCalled();
    expect(recordRecoveryCanaryEvidence).not.toHaveBeenCalled();
  });

  it('persists an operator canary only after its governed receipt and exact snapshot are confirmed', async () => {
    isOperatorSecret.mockReturnValue(true);
    const fingerprint = 'a'.repeat(64);
    const state = {
      sessionId: 'canary-session', actorId: 'operator',
      C: 1 / 3, R: 1 / 3, S: 1 / 3, M: 1 / 3,
      healthBand: 'OPTIMAL', recoveryState: 'RESTORING', sigmaViol: 0,
      toolCalls: 3, trajectoryAvailable: true, nStable: 3,
      canaryPassed: false, canaryReceiptId: null,
      stateFingerprint: fingerprint, trajectoryUpdatedAt: '2026-10-10T00:00:00.000Z',
      authorization: 'authorized', policyRisk: 'read',
      version: 'canonical-governance-2026-10-10.1', observedAt: '2026-10-10T00:00:00.000Z',
    };
    const confirmedState = {
      ...state,
      recoveryState: 'NORMAL',
      canaryPassed: true,
      canaryReceiptId: 'canary-test-receipt',
    };
    readCanonicalGovernanceState
      .mockResolvedValueOnce({ available: true, state })
      .mockResolvedValueOnce({ available: true, state: confirmedState });
    toolFn.mockResolvedValueOnce(JSON.stringify({
      status: 'passed', probe_tool: 'get_constitutional_state',
      session_id: 'canary-session', state_fingerprint: fingerprint,
      state_version: state.version, trajectory_updated_at: state.trajectoryUpdatedAt,
      C: state.C, R: state.R, S: state.S, M: state.M,
      n_stable: state.nStable, sigma_viol: state.sigmaViol,
    }));

    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'run_recovery_canary', arguments: { session_id: 'canary-session' } },
      id: 'canary-run',
    }));

    expect(response.status).toBe(200);
    expect(executeGovernedToolStructured).toHaveBeenCalledTimes(1);
    expect(executeGovernedToolStructured.mock.calls[0]?.[0]).toBe('run_recovery_canary');
    expect(toolFn).toHaveBeenCalledOnce();
    expect(executeGovernedTool).not.toHaveBeenCalled();
    expect(recordRecoveryCanaryEvidence).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'canary-session', actorId: 'operator',
      stateFingerprint: fingerprint, receiptId: 'canary-test-receipt', status: 'passed',
    }));
    const result = (response.body as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    expect(result.recovery_canary).toMatchObject({
      status: 'passed', evidence_persisted: true,
      receipt_id: 'canary-test-receipt', state_fingerprint: fingerprint,
      grants_write_authority: false,
    });
  });

  it('does not activate a canary if the canonical snapshot changes before persistence', async () => {
    isOperatorSecret.mockReturnValue(true);
    const probedFingerprint = 'a'.repeat(64);
    const currentFingerprint = 'b'.repeat(64);
    const currentState = {
      sessionId: 'canary-race-session', actorId: 'operator',
      C: 1 / 3, R: 1 / 3, S: 1 / 3, M: 1 / 3,
      healthBand: 'OPTIMAL', recoveryState: 'RESTORING', sigmaViol: 0,
      toolCalls: 3, trajectoryAvailable: true, nStable: 3,
      canaryPassed: false, canaryReceiptId: null,
      stateFingerprint: currentFingerprint, trajectoryUpdatedAt: '2026-10-10T00:00:01.000Z',
      authorization: 'authorized', policyRisk: 'read',
      version: 'canonical-governance-2026-10-10.1', observedAt: '2026-10-10T00:00:01.000Z',
    };
    readCanonicalGovernanceState
      .mockResolvedValueOnce({ available: true, state: currentState })
      .mockResolvedValueOnce({ available: true, state: currentState });
    toolFn.mockResolvedValueOnce(JSON.stringify({
      status: 'passed', probe_tool: 'get_constitutional_state',
      session_id: 'canary-race-session', state_fingerprint: probedFingerprint,
      state_version: currentState.version, trajectory_updated_at: '2026-10-10T00:00:00.000Z',
      C: currentState.C, R: currentState.R, S: currentState.S, M: currentState.M,
      n_stable: currentState.nStable, sigma_viol: currentState.sigmaViol,
    }));

    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'run_recovery_canary', arguments: { session_id: 'canary-race-session' } },
      id: 'canary-race',
    }));

    expect(response.status).toBe(200);
    expect(recordRecoveryCanaryEvidence).toHaveBeenCalledWith(expect.objectContaining({
      stateFingerprint: probedFingerprint,
      status: 'failed',
      receiptId: 'canary-test-receipt',
    }));
    const result = (response.body as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    expect(result.recovery_canary).toMatchObject({
      evidence_persisted: false,
      grants_write_authority: false,
    });
  });

  it('returns a one-tap human approval request for a first private-test write call', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const actionArgs = { path: 'README.md', content: 'test', message: 'test' };

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'write_file', arguments: actionArgs },
      id: 31,
    }));

    expect(response.status).toBe(200);
    expect(createGovernanceApprovalToken).not.toHaveBeenCalled();
    expect(executeGovernedTool).not.toHaveBeenCalled();
    expect(createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'private-test-1',
      toolName: 'write_file',
      args: expect.objectContaining(actionArgs),
    }));
    const approvalResult = (response.body as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    expect(approvalResult).toMatchObject({
      status: 'approval_required',
      request_id: 'a'.repeat(22),
      recovery_state: 'NORMAL',
      M: 1,
      n_stable: 3,
      canary_passed: true,
    });
    expect(approvalResult.approval_url).toMatch(/^https:\/\/[^/]+\/approvals$/);
  });

  it('does not mutate a passing VERIFIED snapshot while creating a one-tap write approval', async () => {
    const key = { id: 'private-test-verified', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: {
        sessionId: 'private-test-verified:session', actorId: 'api_key:private-test-verified',
        C: 0.2, R: 0.4, S: 0.4, M: 0.2,
        healthBand: 'STRESSED', recoveryState: 'VERIFIED', sigmaViol: 0,
        toolCalls: 0, trajectoryAvailable: true, nStable: 3, canaryPassed: true,
        stateFingerprint: 'b'.repeat(64), trajectoryUpdatedAt: '2026-10-17T00:00:00.000Z',
        authorization: 'authorized', policyRisk: 'write', version: 'test', observedAt: '2026-10-17T00:00:00.000Z',
      },
    });
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'write_file', arguments: { path: 'verified.ts', content: 'export {}' } },
      id: 'verified-one-tap',
    }));

    expect(response.status).toBe(200);
    expect(advanceRecoveryPlane).not.toHaveBeenCalled();
    const approvalResult = (response.body as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    expect(approvalResult).toMatchObject({
      status: 'approval_required',
      recovery_state: 'VERIFIED',
      M: 0.2,
      n_stable: 3,
      canary_passed: true,
    });
  });

  it('does not self-approve writes even when the private-test caller IP changes', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const actionArgs = { path: 'README.md', content: 'test', message: 'test' };

    for (const [index, ip] of ['198.51.100.10', '203.0.113.9'].entries()) {
      const response = await POST(request({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'write_file', arguments: actionArgs },
        id: index + 1,
      }, { 'x-forwarded-for': ip }));
      expect(response.status).toBe(200);
    }

    expect(createGovernanceApprovalToken).not.toHaveBeenCalled();
    expect(createApprovalRequest).toHaveBeenCalledTimes(2);
    expect(executeGovernedTool).not.toHaveBeenCalled();
  });

  it('lets a private-test key request human approval without granting the write itself', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const actionArgs = { path: 'README.md', content: 'test', message: 'test' };

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'authorize_tool_action',
        arguments: {
          tool_name: 'write_file',
          arguments: actionArgs,
          session_id: 'private-test-session',
        },
      },
      id: 32,
    }));

    expect(response.status).toBe(200);
    expect(validateAndConsumeKey).toHaveBeenCalledWith('test-key');
    expect(isOperatorSecret).toHaveBeenCalled();
    expect(interceptToolCall).toHaveBeenCalledWith(expect.objectContaining({
      name: 'write_file',
      session_id: 'private-test-1:private-test-session',
      actor_id: 'api_key:private-test-1',
    }));
    expect(createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'private-test-1',
      sessionId: 'private-test-1:private-test-session',
      toolName: 'write_file',
      args: { ...actionArgs, session_id: 'private-test-1:private-test-session' },
    }));
    expect(createGovernanceApprovalToken).not.toHaveBeenCalled();
    expect((response.body as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent)
      .toMatchObject({ status: 'approval_required', request_id: 'a'.repeat(22) });
  });
  it('does not double-prefix an already owner-scoped approval session', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const actionArgs = { path: 'README.md', content: 'test', message: 'test' };

    await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'authorize_tool_action',
        arguments: {
          tool_name: 'write_file',
          arguments: actionArgs,
          session_id: 'private-test-1:already-scoped',
        },
      },
      id: 35,
    }));

    expect(interceptToolCall).toHaveBeenCalledWith(expect.objectContaining({
      session_id: 'private-test-1:already-scoped',
    }));
    expect(createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'private-test-1:already-scoped',
      args: expect.objectContaining({ session_id: 'private-test-1:already-scoped' }),
    }));
  });

  it('uses the same owner-scoped default session for approval creation and governance review', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const actionArgs = { path: 'README.md', content: 'test', message: 'test' };

    await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'authorize_tool_action',
        arguments: { tool_name: 'write_file', arguments: actionArgs },
      },
      id: 36,
    }));

    const reviewedCall = interceptToolCall.mock.calls[0] as unknown as [{ session_id?: string }] | undefined;
    const reviewedSession = reviewedCall?.[0]?.session_id;
    expect(reviewedSession).toMatch(/^private-test-1:mcp-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}$/);
    expect(createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: reviewedSession,
      args: expect.objectContaining({ session_id: reviewedSession }),
    }));
  });

  it('owner-scopes external-action approval sessions the same way as internal actions', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const manifest = {
      name: 'edit_record',
      description: 'Update a record',
      inputSchema: { type: 'object', properties: { record_id: { type: 'string' } } },
    };

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'authorize_external_action',
        arguments: {
          environment_id: 'test-env',
          manifest,
          action_args: { record_id: 'synthetic-only' },
          target_actor_id: 'api_key:private-test-1',
          session_id: 'external-session',
        },
      },
      id: 'external-session-scope',
    }));

    expect(response.status).toBe(200);
    expect(externalBrokerMocks.governExternalAction).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'private-test-1:external-session',
      actorId: 'api_key:private-test-1',
    }));
    expect(createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'private-test-1',
      sessionId: 'private-test-1:external-session',
      toolName: 'consume_external_action',
      args: expect.objectContaining({ session_id: 'private-test-1:external-session' }),
    }));

    externalBrokerMocks.consumeExternalAction.mockResolvedValueOnce({ granted: true, reason: 'consumed once' });
    const consumeResponse = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'consume_external_action',
        arguments: {
          environment_id: 'test-env',
          manifest,
          action_args: { record_id: 'synthetic-only' },
          session_id: 'external-session',
          approval_request_id: 'a'.repeat(22),
        },
      },
      id: 'external-session-consume',
    }));
    expect(consumeResponse.status).toBe(200);
    expect(externalBrokerMocks.consumeExternalAction).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'private-test-1:external-session',
      actorId: 'api_key:private-test-1',
      ownerId: 'private-test-1',
      approvalRequestId: 'a'.repeat(22),
    }));
    const consumePayload = (consumeResponse.body as unknown as {
      result: { structuredContent: Record<string, unknown> };
    }).result.structuredContent;
    expect(consumePayload).toMatchObject({ granted: true, execution_may_begin: true });
  });

  it('does not create an external approval while canonical governance is blocked', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: { trajectoryAvailable: true, M: 0.04, nStable: 0, canaryPassed: false },
    });
    canonicalExecutionAllowed.mockReturnValueOnce({ allowed: false });
    const before = createApprovalRequest.mock.calls.length;
    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: {
        name: 'authorize_external_action',
        arguments: {
          environment_id: 'test-env',
          manifest: { name: 'edit_record', description: 'Update a record', inputSchema: { type: 'object' } },
          action_args: { record_id: 'blocked' },
          target_actor_id: 'api_key:private-test-1',
        },
      },
      id: 'blocked-external-approval',
    }));
    expect(response.status).toBe(200);
    expect(createApprovalRequest.mock.calls.length).toBe(before);
    const payload = (response.body as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    expect(payload).toMatchObject({ status: 'denied', approval_created: false });
  });

  it('does not grant an external permit when canonical governance blocks final consumption', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: { trajectoryAvailable: true, M: 0.04, nStable: 0, canaryPassed: false },
    });
    canonicalExecutionAllowed.mockReturnValueOnce({ allowed: false });
    const before = externalBrokerMocks.consumeExternalAction.mock.calls.length;
    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: {
        name: 'consume_external_action',
        arguments: {
          environment_id: 'test-env',
          manifest: { name: 'edit_record', description: 'Update a record', inputSchema: { type: 'object' } },
          action_args: { record_id: 'blocked' },
          approval_request_id: 'a'.repeat(22),
        },
      },
      id: 'blocked-external-consume',
    }));
    expect(response.status).toBe(200);
    expect(externalBrokerMocks.consumeExternalAction.mock.calls.length).toBe(before);
    const payload = (response.body as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    expect(payload).toMatchObject({ status: 'denied', approval_created: false });
  });

  it('returns MCP content for a denied authorization decision without minting a token', async () => {
    isOperatorSecret.mockReturnValue(true);
    interceptToolCall.mockResolvedValueOnce({
      approved: false,
      decision: 'DENIED_BLOCKED',
      reason: 'synthetic denial',
      receipt_id: 'denial-receipt',
    });

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'authorize_tool_action',
        arguments: { tool_name: 'write_file', arguments: { path: 'README.md' }, session_id: 'private-test-session' },
      },
      id: 34,
    }));
    const result = (response.body as unknown as {
      result: { approved: boolean; content: Array<{ type: string; text: string }>; structuredContent: Record<string, unknown> };
    }).result;

    expect(result.structuredContent).toMatchObject({ approved: false, reason: 'synthetic denial' });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
    expect(createGovernanceApprovalToken).not.toHaveBeenCalled();
  });

  it('keeps public API keys from authorizing consequential actions', async () => {
    validateApiKey.mockResolvedValue({ valid: true, key: { id: 'public-1', plan: 'free' } });

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'authorize_tool_action', arguments: { tool_name: 'write_file', arguments: {} } },
      id: 33,
    }));

    expect(response.status).toBe(401);
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
    expect(interceptToolCall).not.toHaveBeenCalled();
    expect(createGovernanceApprovalToken).not.toHaveBeenCalled();
  });

  it('accepts diagnostic session IDs already prefixed for the authenticated key', async () => {
    await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_constitutional_state', arguments: { session_id: 'anonymous:shared-label' } },
      id: 3,
    }));

    const scopedArgs = executeGovernedTool.mock.calls[0]?.[1] as { session_id?: string };
    expect(scopedArgs.session_id).toBe('anonymous:shared-label');
  });

  it('gives two non-operator owners separate sessions for the same raw label', async () => {
    for (const owner of ['owner-a', 'owner-b']) {
      validateApiKey.mockResolvedValueOnce({ valid: true, key: { id: owner, plan: 'sovereign' } });
      validateAndConsumeKey.mockResolvedValueOnce({ valid: true, key: { id: owner, plan: 'sovereign' } });
      await POST(request({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'run_governance', arguments: { prompt: 'hello', session_id: 'same-raw-session' } },
        id: owner,
      }));
    }
    const scopedSessions = executeGovernedTool.mock.calls.map(call =>
      (call[1] as { session_id?: string }).session_id,
    );
    expect(scopedSessions).toEqual(['owner-a:same-raw-session', 'owner-b:same-raw-session']);
  });

  it('rejects a non-operator diagnostic read naming another owner session', async () => {
    validateApiKey.mockResolvedValueOnce({ valid: true, key: { id: 'owner-a', plan: 'sovereign' } });
    validateAndConsumeKey.mockResolvedValueOnce({ valid: true, key: { id: 'owner-a', plan: 'sovereign' } });
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_constitutional_state', arguments: { session_id: 'owner-b:private-session' } },
      id: 'cross-owner-read',
    }));
    expect(response.status).toBe(200);
    expect((response.body as { error?: { code?: number; message?: string } }).error).toMatchObject({
      code: -32602,
      message: expect.stringContaining('session_id must belong to the authenticated caller'),
    });
    expect(executeGovernedTool).not.toHaveBeenCalled();
  });

  it('binds run_governance to the resolved operator session when no session_id is supplied', async () => {
    isOperatorSecret.mockReturnValue(true);
    await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'run_governance', arguments: { prompt: 'test' } },
      id: 4,
    }, { 'x-lex-operator-secret': 'operator-secret' }));

    const call = executeGovernedTool.mock.calls[0] as unknown as [string, { session_id?: string }, unknown, string];
    expect(call[0]).toBe('run_governance');
    expect(call[1].session_id).toBe(call[3]);
    expect(call[3]).toMatch(/^mcp-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}$/);
    expect(validateApiKey).not.toHaveBeenCalled();
  });

  it('does not invoke the executor for an unknown tool', async () => {
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'unknown_tool', arguments: {} },
      id: 1,
    }));

    expect(response.status).toBe(200);
    expect(executeGovernedTool).not.toHaveBeenCalled();
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
  });

  it('rejects malformed tool parameters before quota consumption or execution', async () => {
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'run_governance', arguments: [] },
      id: 4,
    }));

    expect(response.status).toBe(200);
    expect((response.body as unknown as { error: { code: number } }).error.code).toBe(-32602);
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
    expect(executeGovernedTool).not.toHaveBeenCalled();
  });

  it('does not debit quota for capability-denied calls', async () => {
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'read_file', arguments: { path: '.env' } },
      id: 5,
    }));

    expect((response.body as unknown as { error: { code: number } }).error.code).toBe(-32601);
    expect(validateApiKey).toHaveBeenCalledTimes(1);
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON-RPC envelopes before authentication', async () => {
    const response = await POST(request({
      jsonrpc: '1.0',
      method: 'tools/call',
      id: 6,
    }));

    expect((response.body as unknown as { error: { code: number } }).error.code).toBe(-32600);
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
  });

  it('fails closed before parsing or authenticating when MCP admission is unavailable', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, retryAfter: 5, storageError: true });

    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call', params: { name: 'run_governance' }, id: 7,
    }));

    expect(response.status).toBe(503);
    expect((response.body as unknown as { error: { code: number } }).error.code).toBe(-32003);
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
    expect(executeGovernedTool).not.toHaveBeenCalled();
  });

  it('rejects oversized declared request bodies before admission or authentication', async () => {
    const response = await POST(request(
      { jsonrpc: '2.0', method: 'tools/call', id: 8 },
      { 'content-length': String(128 * 1024 + 1) },
    ));

    expect(response.status).toBe(413);
    expect((response.body as unknown as { error: { code: number } }).error.code).toBe(-32010);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(validateApiKey).not.toHaveBeenCalled();
    expect(validateAndConsumeKey).not.toHaveBeenCalled();
  });
});
