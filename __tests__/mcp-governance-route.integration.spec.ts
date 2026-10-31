import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { executeGovernedTool, executeGovernedToolStructured, recordRecoveryCanaryEvidence, readCanonicalGovernanceState, createCanonicalGovernanceStateReader, canonicalExecutionAllowed, advanceRecoveryPlane, shouldAdvanceRecoveryPlane, ensureCanonicalTrajectoryState, toolFn, definitions, patchDefinition, validateApiKey, validateAndConsumeKey, checkRateLimit, isOperatorSecret, interceptToolCall, createGovernanceApprovalToken, createApprovalRequest, getApprovalRequestStatus, validateMcpSession, findMatchingScopedGrant } = vi.hoisted(() => ({
  executeGovernedTool: vi.fn(),
  executeGovernedToolStructured: vi.fn(),
  ensureCanonicalTrajectoryState: vi.fn(async (sessionId: string) => ({ status: 'created' as const, sessionId, verified: true as const })),
  recordRecoveryCanaryEvidence: vi.fn(async () => {}),
  readCanonicalGovernanceState: vi.fn(),
  createCanonicalGovernanceStateReader: vi.fn(() => ({
    read: (...args: unknown[]) => readCanonicalGovernanceState(...args),
    refresh: (...args: unknown[]) => readCanonicalGovernanceState(...args),
  })),
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
  getApprovalRequestStatus: vi.fn(async () => ({ status: 'approved' as const })),
  validateMcpSession: vi.fn(),
  findMatchingScopedGrant: vi.fn(async (): Promise<unknown> => null),
  definitions: [
    { name: 'request_approval', description: 'request', parameters: { type: 'object' } },
    { name: 'run_governance', description: 'govern', parameters: { type: 'object' } },
    { name: 'get_constitutional_state', description: 'state', parameters: { type: 'object' } },
    { name: 'request_recovery_pulse', description: 'bounded client recovery', parameters: { type: 'object', properties: {} } },
    { name: 'run_recovery_canary', description: 'canary', parameters: { type: 'object' } },
    { name: 'advance_recovery_plane', description: 'recovery control', parameters: { type: 'object' } },
    { name: 'simulate_agent_plan', description: 'simulate', parameters: { type: 'object' } },
    { name: 'read_file', description: 'read', parameters: { type: 'object' } },
    { name: 'get_workflow_artifact', description: 'artifact metadata', parameters: { type: 'object' } },
    { name: 'review_agent_action', description: 'review', parameters: { type: 'object' } },
    { name: 'narrate_origin', description: 'origin', parameters: { type: 'object' } },
    { name: 'write_file', description: 'write', parameters: { type: 'object', properties: { branch: { type: 'string' } } } },
    { name: 'create_branch', description: 'create branch', parameters: { type: 'object', properties: { branch: { type: 'string' } }, required: ['branch'] } },
    { name: 'open_pr', description: 'open PR', parameters: { type: 'object', properties: { head: { type: 'string' }, title: { type: 'string' } }, required: ['head', 'title'] } },
    { name: 'dispatch_workflow', description: 'dispatch', parameters: { type: 'object' } },
    { name: 'query_database', description: 'database', parameters: { type: 'object' } },
    { name: 'authorize_tool_action', description: 'authorize', parameters: { type: 'object' } },
  ],
  patchDefinition: { name: 'patch_file', description: 'patch', inputSchema: { type: 'object', properties: { branch: { type: 'string' } } } },
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

vi.mock('@/lib/mcp_sessions', () => ({ validateMcpSession }));

vi.mock('@/lib/rate_limit', () => ({ checkRateLimit }));

vi.mock('@/lib/lex_crs_agent/mcp_access', async () => {
  const actual = await vi.importActual<typeof import('../lib/lex_crs_agent/mcp_access')>('../lib/lex_crs_agent/mcp_access');
  return { ...actual, isOperatorSecret };
});

vi.mock('@/lib/db', () => ({
  recordMcpClientIdentity: vi.fn(async () => {}),
  runZTrajMigrations: vi.fn(async () => {}),
}));

vi.mock('@/lib/approval_requests', () => ({ createApprovalRequest, getApprovalRequestStatus }));
vi.mock('@/lib/scoped_grants', () => ({ findMatchingScopedGrant }));

vi.mock('../lib/agents/canonical_governance_state', () => ({
  ensureCanonicalTrajectoryState,
  readCanonicalGovernanceState,
  createCanonicalGovernanceStateReader,
  canonicalExecutionAllowed,
}));

vi.mock('../lib/agents/recovery_runtime', () => ({ advanceRecoveryPlane, shouldAdvanceRecoveryPlane }));

vi.mock('../lib/agents/recovery_canary_evidence', () => ({ recordRecoveryCanaryEvidence }));

vi.mock('../lib/lex_crs_agent/tools', () => ({
  TOOL_DEFINITIONS: definitions,
  advance_recovery_plane: toolFn,
  TOOL_REGISTRY: {
    request_approval: toolFn,
    run_governance: toolFn,
    get_constitutional_state: toolFn,
    request_recovery_pulse: toolFn,
    run_recovery_canary: toolFn,
    advance_recovery_plane: toolFn,
    simulate_agent_plan: toolFn,
    read_file: toolFn,
    get_workflow_artifact: toolFn,
    review_agent_action: toolFn,
    narrate_origin: toolFn,
    write_file: toolFn,
    create_branch: toolFn,
    open_pr: toolFn,
    dispatch_workflow: toolFn,
    query_database: toolFn,
  },
}));

vi.mock('../lib/lex_crs_agent/tools/patch_file', () => ({
  PATCH_FILE_DEFINITION: patchDefinition,
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
import { measureToolCRS } from '../lib/agents/tool_crs';

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
  afterEach(() => vi.unstubAllEnvs());

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
    const createBranchTool = body.result.tools.find(tool => tool.name === 'create_branch');
    const openPrTool = body.result.tools.find(tool => tool.name === 'open_pr');
    expect(writeTool).toBeDefined();
    expect(writeTool?.inputSchema.properties).toHaveProperty('approval_request_id');
    expect(readTool).toBeDefined();
    expect(readTool?.inputSchema.properties?.approval_request_id).toBeUndefined();
    expect(createBranchTool?.inputSchema.properties).toHaveProperty('approval_request_id');
    expect(openPrTool?.inputSchema.properties).toHaveProperty('approval_request_id');
    expect(body.result.tools.map(tool => tool.name)).toEqual(expect.arrayContaining([
      'create_branch', 'open_pr', 'write_file', 'patch_file',
    ]));
    expect(createBranchTool).toBeDefined();
    expect(openPrTool).toBeDefined();
    expect(writeTool?.inputSchema.properties).toHaveProperty('branch');
    const patchTool = body.result.tools.find(tool => tool.name === 'patch_file');
    expect(patchTool?.inputSchema.properties).toHaveProperty('branch');
  });

  it('authorize_tool_action reports an existing approval status without creating or consuming a request', async () => {
    isOperatorSecret.mockReturnValue(true);
    getApprovalRequestStatus.mockResolvedValue({ status: 'approved' });
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'authorize_tool_action', arguments: {
        tool_name: 'create_branch',
        arguments: { branch: 'fix/approval-gate-test' },
        approval_request_id: 'existing-approved-request',
      } },
      id: 'approval-status-only',
    }));
    expect(response.status).toBe(200);
    expect((response.body as { result?: { structuredContent?: Record<string, unknown> } }).result?.structuredContent)
      .toMatchObject({ status: 'approved', execution_granted: false, request_id: 'existing-approved-request' });
    expect(getApprovalRequestStatus).toHaveBeenCalled();
    expect(createApprovalRequest).not.toHaveBeenCalled();
    expect(toolFn).not.toHaveBeenCalled();
  });

  it.each([
    ['create_branch', { branch: 'govern/scoped-grant' }],
    ['write_file', { branch: 'govern/scoped-grant', path: 'docs/scoped-grant.md', content: 'grant', message: 'test' }],
  ])('%s bypasses request creation only when the owner-scoped grant matcher finds a match', async (name, args) => {
    isOperatorSecret.mockReturnValue(true);
    findMatchingScopedGrant.mockResolvedValue({
      grant_id: 'grant-1', owner_id: 'operator', allowed_tools: [name], branch_prefixes: ['govern/'],
      path_prefixes: ['docs/'], max_uses: 1, uses: 0, expires_at: Date.now() + 30_000,
      revoked_at: null, created_at: Date.now(),
    });
    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: 'scoped-grant-' + name,
    }));
    expect(response.status).toBe(200);
    expect(findMatchingScopedGrant).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'operator', toolName: name, args: expect.objectContaining(args),
    }));
    expect(createApprovalRequest).not.toHaveBeenCalled();
    expect(executeGovernedTool).toHaveBeenCalledOnce();
    expect(executeGovernedTool.mock.calls[0]?.[1]).toMatchObject({ __scoped_grant_id: 'grant-1' });
  });

  it.each([
    ['create_branch', { branch: 'fix/approval-gate-test' }],
    ['open_pr', { head: 'fix/approval-gate-test', title: 'Approval gate test', body: 'Test body' }],
    ['dispatch_workflow', { workflow: 'ci.yml' }],
  ])('%s creates an approval request before invoking the GitHub handler', async (name, args) => {
    isOperatorSecret.mockReturnValue(true);
    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: 'approval-gate-' + name,
    }));
    expect(response.status).toBe(200);
    const body = response.body as { result?: { structuredContent?: Record<string, unknown> } };
    expect(body.result?.structuredContent).toMatchObject({ status: 'approval_required', request_id: 'a'.repeat(22), tool_name: name });
    expect(createApprovalRequest).toHaveBeenCalled();
    expect(toolFn).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LEX_CANARY_OWNER_IDS;
    validateApiKey.mockResolvedValue({ valid: true, key: {} });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key: {} });
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59, retryAfter: 0, storageError: false });
    isOperatorSecret.mockReturnValue(false);
    findMatchingScopedGrant.mockResolvedValue(null);
    validateMcpSession.mockResolvedValue({ valid: false, error: 'Invalid MCP session' });
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

  it.each([
    ['MCP session expired', 'Session expired. Reconnect Lex Aureon to refresh credentials, then retry this tool call.'],
    ['Invalid MCP session', 'Session token is invalid. Reconnect Lex Aureon, then retry this tool call.'],
    ['Session authentication unavailable', 'Session service temporarily unavailable. Retry this tool call shortly.'],
  ])('returns a specific tool error for %s', async (reason, expected) => {
    validateMcpSession.mockResolvedValue({ valid: false, error: reason });
    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'get_constitutional_state', arguments: {} },
      id: 'session-error',
    }, { 'x-lex-session-token': 'session-token', 'x-lex-api-key': '' }));
    expect(response.status).toBe(200);
    expect((response.body as unknown as { result: { content: Array<{ text: string }>; isError: boolean } }).result.isError).toBe(true);
    expect((response.body as unknown as { result: { content: Array<{ text: string }> } }).result.content[0].text).toBe(expected);
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

  it('does not bootstrap canonical trajectory for a simulated agent plan', async () => {
    const key = { id: 'simulation-owner', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'simulate_agent_plan', arguments: { actions: [] } },
      id: 'simulation-no-bootstrap',
    }));

    expect(response.status).toBe(200);
    expect(ensureCanonicalTrajectoryState).not.toHaveBeenCalled();
    expect(executeGovernedTool).toHaveBeenCalledTimes(1);
    expect(executeGovernedTool.mock.calls[0]?.[0]).toBe('simulate_agent_plan');
  });

  it.each([
    ['get_workflow_artifact', {}],
    ['review_agent_action', {}],
    ['narrate_origin', {}],
    ['query_database', { sql: 'SELECT 1' }],
  ])('does not record a trajectory observation for read-only %s', async (toolName, arguments_) => {
    validateApiKey.mockResolvedValue({ valid: true, key: { id: 'private-test-readonly', plan: 'private_test' } });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key: { id: 'private-test-readonly', plan: 'private_test' } });
    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: toolName, arguments: arguments_ },
      id: `read-only-${toolName}`,
    }));

    expect(response.status).toBe(200);
    expect(ensureCanonicalTrajectoryState).not.toHaveBeenCalled();
  });

  it.each([
    ['query_database', { sql: 'UPDATE accounts SET active = 0' }],
    ['query_database', { sql: 'DELETE FROM accounts' }],
    ['dispatch_workflow', { workflow: 'sync' }],
    ['write_file', { path: 'README.md', content: 'change' }],
  ])('keeps trajectory governance for mutating %s', async (toolName, arguments_) => {
    validateApiKey.mockResolvedValue({ valid: true, key: { id: 'private-test-mutating', plan: 'private_test' } });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key: { id: 'private-test-mutating', plan: 'private_test' } });
    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: toolName, arguments: arguments_ },
      id: `mutating-${toolName}`,
    }));

    expect(response.status).toBe(200);
    expect(ensureCanonicalTrajectoryState).toHaveBeenCalledTimes(1);
  });

  it('denies a private_test key from running the canary when its owner is not allowlisted', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'run_recovery_canary', arguments: { session_id: 'private-test-1:canary-session' } },
      id: 'private-test-not-allowlisted',
    }));
    expect(response.status).toBe(200);
    expect((response.body as { result?: { content?: Array<{ text?: string }>; isError?: boolean } }).result?.isError).toBe(true);
    expect((response.body as { result?: { content?: Array<{ text?: string }> } }).result?.content?.[0]?.text)
      .toContain('Your credential is valid');
    expect(executeGovernedToolStructured).not.toHaveBeenCalled();
    expect(toolFn).not.toHaveBeenCalled();
    expect(recordRecoveryCanaryEvidence).not.toHaveBeenCalled();
  });

  it('allows an explicitly allowlisted owner to reach the canary executor', async () => {
    process.env.LEX_CANARY_OWNER_IDS = 'private-test-allowlisted';
    const key = { id: 'private-test-allowlisted', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    executeGovernedToolStructured.mockResolvedValueOnce({
      approved: true, result: 'CANARY_RESULT', receiptId: 'canary-receipt',
    });

    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'run_recovery_canary', arguments: { session_id: 'private-test-allowlisted:canary-session' } },
      id: 'private-test-allowlisted',
    }));

    expect(response.status).toBe(200);
    expect(executeGovernedToolStructured).toHaveBeenCalledTimes(1);
    expect(executeGovernedToolStructured.mock.calls[0]?.[0]).toBe('run_recovery_canary');
  });

  it('denies a non-allowlisted private-test key from advancing recovery before trajectory dispatch', async () => {
    process.env.LEX_CANARY_OWNER_IDS = '';
    const key = { id: 'private-test-recovery', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    isOperatorSecret.mockReturnValue(false);

    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'advance_recovery_plane', arguments: { session_id: 'private-test-recovery:recovery-session' } },
      id: 'private-test-recovery-denied',
    }));

    expect(response.status).toBe(401);
    expect(executeGovernedToolStructured).not.toHaveBeenCalled();
    expect(executeGovernedTool).not.toHaveBeenCalled();
    expect(toolFn).not.toHaveBeenCalled();
  });

  it('does not let a canary-allowlisted owner mutate recovery without operator authority', async () => {
    process.env.LEX_CANARY_OWNER_IDS = 'trusted-owner';
    const key = { id: 'trusted-owner', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    isOperatorSecret.mockReturnValue(false);

    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'advance_recovery_plane', arguments: { session_id: 'trusted-owner:recovery-session' } },
      id: 'canary-owner-recovery-denied',
    }));

    expect(response.status).toBe(401);
    expect(executeGovernedToolStructured).not.toHaveBeenCalled();
    expect(toolFn).not.toHaveBeenCalled();
  });

  it('exposes a public recovery pulse and binds it to the authenticated caller session', async () => {
    const listed = await POST(request({ jsonrpc: '2.0', method: 'tools/list', id: 'public-recovery-tool-list' }));
    expect(listed.status).toBe(200);
    const listedTools = (listed.body as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(listedTools.map((tool) => tool.name)).toContain('request_recovery_pulse');

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'request_recovery_pulse', arguments: { session_id: 'spoofed:other-owner-session' } },
      id: 'public-recovery-pulse',
    }));
    expect(response.status).toBe(200);
    expect(executeGovernedTool).toHaveBeenCalledOnce();
    expect(executeGovernedTool.mock.calls[0]?.[0]).toBe('request_recovery_pulse');
    expect(executeGovernedTool.mock.calls[0]?.[1]).toHaveProperty('session_id');
    expect(executeGovernedTool.mock.calls[0]?.[1].session_id).not.toBe('spoofed:other-owner-session');
    expect(checkRateLimit).toHaveBeenCalledWith(expect.stringMatching(/^recovery-pulse:/), 6, 60);
  });

  it('lets an authenticated operator use the same client recovery tool with a server-bound operator session', async () => {
    isOperatorSecret.mockReturnValue(true);
    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'request_recovery_pulse', arguments: { session_id: 'caller-selected-session' } },
      id: 'operator-client-parity-pulse',
    }));
    expect(response.status).toBe(200);
    expect(executeGovernedTool).toHaveBeenCalledOnce();
    expect(executeGovernedTool.mock.calls[0]?.[0]).toBe('request_recovery_pulse');
    expect(executeGovernedTool.mock.calls[0]?.[1].session_id).not.toBe('caller-selected-session');
    expect(executeGovernedTool.mock.calls[0]?.[1]).toHaveProperty('session_id');
    expect(checkRateLimit).toHaveBeenCalledWith(expect.stringMatching(/^recovery-pulse:/), 6, 60);
  });

  it('routes an authorized recovery pulse through the governed control-plane executor', async () => {
    isOperatorSecret.mockReturnValue(true);
    executeGovernedToolStructured.mockResolvedValueOnce({
      approved: true,
      result: 'RECOVERY_PULSE_RESULT',
      receiptId: 'recovery-pulse-receipt',
    });

    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'advance_recovery_plane', arguments: { session_id: 'operator-recovery-session' } },
      id: 'operator-recovery-pulse',
    }));

    expect(response.status).toBe(200);
    expect(executeGovernedToolStructured).toHaveBeenCalledTimes(1);
    expect(executeGovernedToolStructured.mock.calls[0]?.[0]).toBe('advance_recovery_plane');
    expect(typeof executeGovernedToolStructured.mock.calls[0]?.[2]).toBe('function');
    expect(toolFn).not.toHaveBeenCalled();
    expect((response.body as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent)
      .toMatchObject({ execution: 'RECOVERY_PULSE_RESULT', receipt_id: 'recovery-pulse-receipt', grants_write_authority: false });
  });

  it('allows only an explicitly allowlisted API-key owner to run the canary', async () => {
    process.env.LEX_CANARY_OWNER_IDS = 'trusted-owner, another-owner';
    const key = { id: 'trusted-owner', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'run_recovery_canary', arguments: { session_id: 'trusted-owner:canary-session' } },
      id: 'allowlisted-owner-canary',
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

  it('allows a public-profile request_approval through CRS to create a pending request', async () => {
    const key = { id: 'public-approval-owner', plan: 'free' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    executeGovernedTool.mockImplementationOnce(async (name, args, handler, sessionId) => {
      const measurement = await measureToolCRS({
        id: 'public-request-approval',
        name: String(name),
        arguments: args as Record<string, unknown>,
        session_id: String(sessionId ?? 'public-approval-owner:session'),
      });
      if (measurement.unclassified || measurement.risk_level === 'BLOCKED') {
        return `DENIED:${measurement.blocked_pattern ?? 'blocked'}`;
      }
      return (handler as (input: Record<string, unknown>) => Promise<string>)(args as Record<string, unknown>);
    });

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'request_approval',
        arguments: {
          tool_name: 'run_governance',
          arguments: { prompt: 'Summarize the user-provided document' },
        },
      },
      id: 'public-request-approval',
    }));

    expect(response.status).toBe(200);
    const result = (response.body as { result?: { content?: Array<{ text?: string }> } }).result;
    expect(result?.content?.[0]?.text).not.toContain('unclassified_tool:request_approval');
    expect(createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 'public-approval-owner',
      toolName: 'run_governance',
      args: expect.objectContaining({ prompt: 'Summarize the user-provided document' }),
    }));
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
    const requestApprovalBody = response.body as { result?: { content?: Array<{ text?: string }> } };
    const requestApprovalText = requestApprovalBody.result?.content?.[0]?.text ?? '';
    expect(requestApprovalText).toMatch(/^\{"request_id":"a{22}","expires_at":"[^"]+","approval_url":"https:\/\/[^/]+\/approvals#a{22}"\}$/);
  });

  it('serves the actual operator tool definitions and branch schemas from tools/list', async () => {
    const actualTools = await vi.importActual<typeof import('../lib/lex_crs_agent/tools')>('../lib/lex_crs_agent/tools');
    const actualPatch = await vi.importActual<typeof import('../lib/lex_crs_agent/tools/patch_file')>('../lib/lex_crs_agent/tools/patch_file');
    const savedDefinitions = [...definitions];
    const savedPatch = { ...patchDefinition };
    try {
      (definitions as unknown as unknown[]).splice(0, definitions.length, ...(actualTools.TOOL_DEFINITIONS as unknown as unknown[]));
      Object.assign(patchDefinition, actualPatch.PATCH_FILE_DEFINITION);
      validateApiKey.mockResolvedValue({ valid: true, key: { id: 'operator-catalog-test', plan: 'private_test' } });

      const response = await POST(request({ jsonrpc: '2.0', method: 'tools/list', id: 'real-operator-catalog' }));
      expect(response.status).toBe(200);
      const body = response.body as unknown as { result: { tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }> } };
      const names = body.result.tools.map(tool => tool.name);
      expect(names).toContain('create_branch');
      expect(names).toContain('open_pr');
      const write = body.result.tools.find(tool => tool.name === 'write_file');
      const patch = body.result.tools.find(tool => tool.name === 'patch_file');
      expect(write?.inputSchema.properties).toHaveProperty('branch');
      expect(patch?.inputSchema.properties).toHaveProperty('branch');
    } finally {
      (definitions as unknown as unknown[]).splice(0, definitions.length, ...(savedDefinitions as unknown as unknown[]));
      Object.assign(patchDefinition, savedPatch);
    }
  });


  it('allows a public-profile request_approval call to reach approval creation', async () => {
    const key = { id: 'public-profile', plan: 'free' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    executeGovernedTool.mockImplementation(async (_name, args, handler) =>
      (handler as (input: Record<string, unknown>) => Promise<string>)(args as Record<string, unknown>));

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'request_approval',
        arguments: {
          tool_name: 'run_governance',
          arguments: { prompt: 'reviewed governance task' },
        },
      },
      id: 'public-request-approval',
    }));

    expect(response.status).toBe(200);
    expect(createApprovalRequest).toHaveBeenCalledWith(expect.objectContaining({
      toolName: 'run_governance',
      args: expect.objectContaining({ prompt: 'reviewed governance task' }),
    }));
    const payload = response.body as { result?: { content?: Array<{ text?: string }> } };
    const resultText = payload.result?.content?.[0]?.text ?? '';
    expect(resultText).not.toContain('unclassified_tool:request_approval');
    expect(resultText).toMatch(/"request_id":"a{22}"/);
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
      'simulate_agent_plan',
      'review_agent_action',
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
    expect(names).toContain('advance_recovery_plane');
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

  it('does not confirm invariant-mode canary evidence after the canonical fingerprint changes', async () => {
    vi.stubEnv('CANARY_MODE', 'invariant');
    isOperatorSecret.mockReturnValue(true);
    const probedFingerprint = 'a'.repeat(64);
    const changedFingerprint = 'b'.repeat(64);
    const currentState = {
      sessionId: 'canary-confirmation-race', actorId: 'operator',
      C: 1 / 3, R: 1 / 3, S: 1 / 3, M: 1 / 3,
      healthBand: 'OPTIMAL', recoveryState: 'RESTORING', sigmaViol: 0,
      toolCalls: 3, trajectoryAvailable: true, nStable: 3,
      canaryPassed: false, canaryReceiptId: null,
      stateFingerprint: probedFingerprint, trajectoryUpdatedAt: '2026-10-10T00:00:01.000Z',
      authorization: 'authorized', policyRisk: 'read',
      version: 'canonical-governance-2026-10-10.1', observedAt: '2026-10-10T00:00:01.000Z',
    };
    readCanonicalGovernanceState
      .mockResolvedValueOnce({ available: true, state: currentState }) // post-probe snapshot check
      .mockResolvedValueOnce({
        available: true,
        state: { ...currentState, stateFingerprint: changedFingerprint, canaryPassed: true, canaryReceiptId: 'canary-test-receipt' },
      }); // post-persistence confirmation
    toolFn.mockResolvedValueOnce(JSON.stringify({
      status: 'passed', probe_tool: 'get_constitutional_state',
      session_id: 'canary-confirmation-race', state_fingerprint: probedFingerprint,
      state_version: currentState.version, trajectory_updated_at: currentState.trajectoryUpdatedAt,
      C: currentState.C, R: currentState.R, S: currentState.S, M: currentState.M,
      n_stable: currentState.nStable, sigma_viol: currentState.sigmaViol,
    }));

    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'run_recovery_canary', arguments: { session_id: 'canary-confirmation-race' } },
      id: 'canary-confirmation-race',
    }));

    expect(response.status).toBe(200);
    expect(recordRecoveryCanaryEvidence).toHaveBeenCalledWith(expect.objectContaining({
      stateFingerprint: probedFingerprint, status: 'passed',
    }));
    const result = (response.body as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    expect(result.recovery_canary).toMatchObject({
      evidence_persisted: false,
      grants_write_authority: false,
    });
  });

  it('does not activate a canary if the canonical snapshot changes before persistence', async () => {
    vi.stubEnv('CANARY_MODE', 'invariant');
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
    expect(approvalResult.approval_url).toMatch(/^https:\/\/[^/]+\/approvals#a{22}$/);
    expect(checkRateLimit).toHaveBeenCalledWith('approval-implicit:private-test-1', 20, 3600);
  });

  it('advances bounded recovery before an approved retry can be stopped by trajectory admission', async () => {
    const key = { id: 'private-test-recovery-retry', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: {
        sessionId: 'private-test-recovery-retry:session',
        actorId: 'api_key:private-test-recovery-retry',
        C: 0.2, R: 0.4, S: 0.4, M: 0.2,
        healthBand: 'STRESSED', recoveryState: 'RESTORING', sigmaViol: 0,
        toolCalls: 0, trajectoryAvailable: true, nStable: 0, velocity: 0,
        canaryPassed: false, stateFingerprint: 'c'.repeat(64),
        trajectoryUpdatedAt: '2026-10-17T00:00:00.000Z',
        authorization: 'approval_required', policyRisk: 'write',
        version: 'test', observedAt: '2026-10-17T00:00:00.000Z',
      },
    });
    canonicalExecutionAllowed.mockReturnValueOnce({
      allowed: false,
    });

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'write_file',
        arguments: {
          path: 'recovery-retry.ts',
          content: 'export const safe = true;',
          message: 'approved retry',
          approval_request_id: 'a'.repeat(22),
        },
      },
      id: 'approved-retry-recovery-preflight',
    }));

    expect(response.status).toBe(200);
    expect(advanceRecoveryPlane).toHaveBeenCalledTimes(1);
    expect(executeGovernedTool).not.toHaveBeenCalled();
    const result = (response.body as unknown as {
      result: { structuredContent: Record<string, unknown> };
    }).result.structuredContent;
    expect(result).toMatchObject({
      status: 'denied',
      decision: 'DENIED_BLOCKED',
      recovery_state: 'RESTORING',
      n_stable: 0,
      canary_passed: false,
      approval_created: false,
    });
  });

  it('allows an approved retry through recovery preflight only when canonical recovery is eligible', async () => {
    const key = { id: 'private-test-recovery-eligible', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    readCanonicalGovernanceState.mockResolvedValue({
      available: true,
      state: {
        sessionId: 'private-test-recovery-eligible:session',
        actorId: 'api_key:private-test-recovery-eligible',
        C: 1 / 3, R: 1 / 3, S: 1 / 3, M: 1 / 3,
        healthBand: 'OPTIMAL', recoveryState: 'NORMAL', sigmaViol: 0,
        toolCalls: 3, trajectoryAvailable: true, nStable: 3, velocity: 0,
        canaryPassed: true, canaryReceiptId: 'verified-canary-receipt',
        stateFingerprint: 'd'.repeat(64),
        trajectoryUpdatedAt: '2026-10-23T00:00:00.000Z',
        authorization: 'approval_required', policyRisk: 'write',
        version: 'test', observedAt: '2026-10-23T00:00:00.000Z',
      },
    });
    executeGovernedTool.mockResolvedValue('approved: true\\ncache_hit: false\\nTOOL_RESULT');

    const response = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'write_file',
        arguments: {
          path: 'recovery-eligible.ts',
          content: 'export const safe = true;',
          message: 'approved eligible retry',
          approval_request_id: 'a'.repeat(22),
        },
      },
      id: 'approved-retry-recovery-eligible',
    }));

    expect(response.status).toBe(200);
    expect(canonicalExecutionAllowed).toHaveBeenCalled();
    expect(advanceRecoveryPlane).not.toHaveBeenCalled();
    expect(executeGovernedTool).toHaveBeenCalled();
    expect(executeGovernedTool.mock.calls[0]?.[0]).toBe('write_file');
    expect(executeGovernedTool.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ path: 'recovery-eligible.ts' }),
    );
  });

  it('fails closed when implicit approval rate-limit storage is unavailable', async () => {
    const key = { id: 'private-test-rate-limit', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    checkRateLimit
      .mockResolvedValueOnce({ allowed: true, remaining: 59, retryAfter: 0, storageError: false })
      .mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfter: 60, storageError: true });

    const response = await POST(request({
      jsonrpc: '2.0', method: 'tools/call',
      params: { name: 'write_file', arguments: { path: 'README.md', content: 'test' } },
      id: 'implicit-approval-storage-error',
    }));

    expect(response.status).toBe(503);
    expect(createApprovalRequest).not.toHaveBeenCalled();
    expect(executeGovernedTool).not.toHaveBeenCalled();
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

  it('preserves a passing canary while issuing a one-tap approval in VERIFIED state', async () => {
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
    const authorizationResult = (response.body as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    expect(authorizationResult.approval_url).toMatch(/^https:\/\/[^/]+\/approvals#a{22}$/);
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
    expect(reviewedSession).toMatch(/^private-test-1:mcp-[a-f0-9]{12}$/);
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
    const externalApprovalResult = (response.body as unknown as { result: { structuredContent: Record<string, unknown> } }).result.structuredContent;
    expect(externalApprovalResult.approval_url).toMatch(/^https:\/\/[^/]+\/approvals#a{22}$/);

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
    expect(call[3]).toMatch(/^mcp-[a-f0-9]{12}$/);
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
