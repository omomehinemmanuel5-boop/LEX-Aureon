import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeGovernedTool, executeGovernedToolStructured, recordRecoveryCanaryEvidence, readCanonicalGovernanceState, toolFn, definitions, validateApiKey, validateAndConsumeKey, checkRateLimit, isOperatorSecret, interceptToolCall, createGovernanceApprovalToken } = vi.hoisted(() => ({
  executeGovernedTool: vi.fn(),
  executeGovernedToolStructured: vi.fn(),
  recordRecoveryCanaryEvidence: vi.fn(async () => {}),
  readCanonicalGovernanceState: vi.fn(),
  toolFn: vi.fn(async () => 'TOOL_RESULT'),
  validateApiKey: vi.fn(async () => ({ valid: true, key: {} })),
  validateAndConsumeKey: vi.fn(async () => ({ valid: true, key: {} })),
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59, retryAfter: 0, storageError: false })),
  isOperatorSecret: vi.fn(),
  interceptToolCall: vi.fn(async () => ({ approved: true, decision: 'approved', reason: 'allowed', receipt_id: 'approval-receipt' })),
  createGovernanceApprovalToken: vi.fn(() => 'approval-token'),
  definitions: [
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

vi.mock('../lib/agents/canonical_governance_state', () => ({
  ensureCanonicalTrajectoryState: vi.fn(async () => true),
  readCanonicalGovernanceState,
}));

vi.mock('../lib/agents/recovery_canary_evidence', () => ({ recordRecoveryCanaryEvidence }));

vi.mock('../lib/lex_crs_agent/tools', () => ({
  TOOL_DEFINITIONS: definitions,
  TOOL_REGISTRY: {
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
  beforeEach(() => {
    vi.clearAllMocks();
    validateApiKey.mockResolvedValue({ valid: true, key: {} });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key: {} });
    checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59, retryAfter: 0, storageError: false });
    isOperatorSecret.mockReturnValue(false);
    toolFn.mockResolvedValue('TOOL_RESULT');
    readCanonicalGovernanceState.mockResolvedValue({ available: false, state: {} });
    recordRecoveryCanaryEvidence.mockResolvedValue(undefined);
    executeGovernedTool.mockResolvedValue('approved:    true\\ncache_hit:   false\\nTOOL_RESULT');
    executeGovernedToolStructured.mockImplementation(async (_name, args, handler) => {
      const raw = await handler(args);
      return { result: raw, approved: true, receiptId: 'canary-test-receipt' };
    });
  });

  it('routes every exposed tool call through the constitutional executor', async () => {
    const tools = [
      ['run_governance', { prompt: 'test' }],
      ['get_constitutional_state', { session_id: 'mine' }],
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

  it('does not expose or execute infrastructure tools for public API keys', async () => {
    const listResponse = await POST(request({
      jsonrpc: '2.0',
      method: 'tools/list',
      id: 1,
    }));
    const listed = (listResponse.body as unknown as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(listed.map(tool => tool.name)).toEqual([
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

  it('persists a private-test canary only after its governed receipt and exact snapshot are confirmed', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const fingerprint = 'a'.repeat(64);
    const state = {
      sessionId: 'canary-session', actorId: 'api_key:private-test-1',
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
    expect(executeGovernedTool).not.toHaveBeenCalled();
    expect(recordRecoveryCanaryEvidence).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'canary-session', actorId: 'api_key:private-test-1',
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
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
    const probedFingerprint = 'a'.repeat(64);
    const currentFingerprint = 'b'.repeat(64);
    const currentState = {
      sessionId: 'canary-race-session', actorId: 'api_key:private-test-1',
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

  it('automatically issues an exact action-bound approval for private-test consequential calls', async () => {
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
    expect(createGovernanceApprovalToken).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'api_key:private-test-1',
      sessionId: expect.stringMatching(/^mcp-\d{4}-\d{2}-\d{2}-[a-f0-9]{12}$/),
      toolName: 'write_file',
      args: actionArgs,
    }));
    const executedArgs = executeGovernedTool.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(executedArgs.approval_token).toBe('approval-token');
  });

  it('keeps default governance-session binding stable when the proxy IP changes', async () => {
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

    expect(createGovernanceApprovalToken).toHaveBeenCalledTimes(2);
    const sessionIds = createGovernanceApprovalToken.mock.calls.map(([input]) => input.sessionId);
    expect(sessionIds[0]).toBe(sessionIds[1]);
  });

  it('lets a private-test key authorize a consequential action under its own identity and quota', async () => {
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
    expect(validateAndConsumeKey).toHaveBeenCalledTimes(1);
    expect(isOperatorSecret).toHaveBeenCalled();
    expect(interceptToolCall).toHaveBeenCalledWith(expect.objectContaining({
      name: 'write_file',
      arguments: actionArgs,
      session_id: 'private-test-session',
      actor_id: 'api_key:private-test-1',
    }));
    expect(createGovernanceApprovalToken).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'api_key:private-test-1',
      sessionId: 'private-test-session',
      toolName: 'write_file',
      args: actionArgs,
    }));
    const result = (response.body as unknown as {
      result: {
        approved: boolean;
        approval_token: string;
        content: Array<{ type: string; text: string }>;
        structuredContent: Record<string, unknown>;
      };
    }).result;
    expect(result.structuredContent).toMatchObject({ approved: true, approval_token: 'approval-token' });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
    expect(result.structuredContent).toMatchObject({ approved: true, approval_token: 'approval-token' });
  });

  it('returns MCP content for a denied authorization decision without minting a token', async () => {
    const key = { id: 'private-test-1', plan: 'private_test' };
    validateApiKey.mockResolvedValue({ valid: true, key });
    validateAndConsumeKey.mockResolvedValue({ valid: true, key });
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

  it('namespaces public session IDs by the authenticated key', async () => {
    await POST(request({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'get_constitutional_state', arguments: { session_id: 'shared-label' } },
      id: 3,
    }));

    const scopedArgs = executeGovernedTool.mock.calls[0]?.[1] as { session_id?: string };
    expect(scopedArgs.session_id).toBe('anonymous:shared-label');
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
