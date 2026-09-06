import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeGovernedTool, executeGovernedTrajectoryAction } = vi.hoisted(() => ({
  executeGovernedTool: vi.fn(),
  executeGovernedTrajectoryAction: vi.fn(),
}));

vi.mock('next/server', () => ({
  NextResponse: class MockNextResponse {
    status = 200;
    body: unknown;
    constructor(body: unknown = null, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    static json(body: unknown) {
      return new MockNextResponse(body);
    }
  },
}));

vi.mock('@/lib/api_keys', () => ({
  validateAndConsumeKey: vi.fn(async () => ({ valid: true, key: {} })),
}));

vi.mock('@/lib/db', () => ({
  recordMcpClientIdentity: vi.fn(async () => {}),
}));

// Canned response, does NOT invoke the real toolFn — this test is about
// dispatch ROUTING decisions (which executor gets called, with what
// arguments), not about exercising real tool business logic or making
// real network calls. Trajectory state for the routing tests is set up
// directly via the real, unmocked declare_trajectory_plan/tools below,
// not by relying on this mock to run real tool code.
vi.mock('@/lib/agents/constitutional_tool_executor', () => ({
  executeGovernedTool,
}));

// Keep the real trajectoryActionId (pure, deterministic) — only replace
// executeGovernedTrajectoryAction, so the dispatch code under test computes
// the same actionId a real declared plan would have.
vi.mock('@/lib/agents/trajectory_executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/agents/trajectory_executor')>();
  return { ...actual, executeGovernedTrajectoryAction };
});

// lib/lex_crs_agent/tools is intentionally NOT mocked — TOOL_REGISTRY needs
// to really contain declare_trajectory_plan etc. for resolveTool() to find
// them. We call declare_trajectory_plan directly (not through POST) to set
// up state, since executeGovernedTool above is a canned mock that doesn't
// invoke the real toolFn it's given.
import { declare_trajectory_plan } from '../lib/lex_crs_agent/tools';
import { getTrajectoryState, clearTrajectoryState } from '../lib/agents/trajectory_session_store';
import { POST } from '../app/api/mcp/route';

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lex-api-key': 'test-key' },
    body: JSON.stringify(body),
  });
}

async function call(name: string, args: Record<string, unknown>) {
  return POST(request({ jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args }, id: name }));
}

describe('trajectory-aware MCP dispatch', () => {
  const sessionId = 'trajectory-dispatch-test-session';

  beforeEach(() => {
    vi.clearAllMocks();
    clearTrajectoryState(sessionId);
    executeGovernedTool.mockResolvedValue('approved:    true\ncache_hit:   false\nBARE_RESULT');
    executeGovernedTrajectoryAction.mockResolvedValue({
      state: { plan: { planId: 'p', goal: 'g', authorizedScope: [], riskCeiling: 'read', actions: [] }, currentStep: 1, completed: [], driftScore: 0, locked: false },
      result: 'TRAJECTORY_RESULT',
      action: { actionId: 'x', toolName: 'read_file', declaredIntent: '', risk: 'read' },
    });
  });

  it('with no declared plan, dispatches through bare executeGovernedTool as before', async () => {
    expect(getTrajectoryState(sessionId)).toBeUndefined();
    await call('read_file', { path: 'README.md', session_id: sessionId });
    expect(executeGovernedTool).toHaveBeenCalledTimes(1);
    expect(executeGovernedTrajectoryAction).not.toHaveBeenCalled();
  });

  it('declare_trajectory_plan itself is a real, callable pure function that stores real state', async () => {
    const text = await declare_trajectory_plan({
      goal: 'Read then search',
      authorized_scope: ['read_file', 'search_code'],
      risk_ceiling: 'read',
      actions: [
        { toolName: 'read_file', declaredIntent: 'read the readme', risk: 'read' },
        { toolName: 'search_code', declaredIntent: 'search for a symbol', risk: 'read' },
      ],
      session_id: sessionId,
    });
    expect(text).toContain('Trajectory plan declared');
    const state = getTrajectoryState(sessionId);
    expect(state).toBeDefined();
    expect(state!.plan.actions).toHaveLength(2);
    expect(state!.plan.actions[0].toolName).toBe('read_file');
  });

  it('once a plan is active for the session, the next tools/call routes through executeGovernedTrajectoryAction, not the bare path', async () => {
    await declare_trajectory_plan({
      goal: 'Read then search',
      authorized_scope: ['read_file', 'search_code'],
      risk_ceiling: 'read',
      actions: [
        { toolName: 'read_file', declaredIntent: 'read the readme', risk: 'read' },
        { toolName: 'search_code', declaredIntent: 'search for a symbol', risk: 'read' },
      ],
      session_id: sessionId,
    });

    await call('read_file', { path: 'README.md', session_id: sessionId });

    expect(executeGovernedTrajectoryAction).toHaveBeenCalledTimes(1);
    expect(executeGovernedTool).not.toHaveBeenCalled();

    const [passedState, passedAction] = executeGovernedTrajectoryAction.mock.calls[0];
    expect(passedState.currentStep).toBe(0);
    expect(passedAction.toolName).toBe('read_file');
    expect(passedAction.declaredIntent).toBe('read the readme');
  });

  it('a call to a tool NOT matching the next declared step still routes through the trajectory gate (which will deny it), not the bare path', async () => {
    await declare_trajectory_plan({
      goal: 'Read only',
      authorized_scope: ['read_file'],
      risk_ceiling: 'read',
      actions: [{ toolName: 'read_file', declaredIntent: 'read the readme', risk: 'read' }],
      session_id: sessionId,
    });

    // search_code was never declared — this must still go through the
    // trajectory gate (responsible for denying it), not silently fall
    // through to bare per-call governance and be approved.
    await call('search_code', { query: 'foo', session_id: sessionId });

    expect(executeGovernedTrajectoryAction).toHaveBeenCalledTimes(1);
    expect(executeGovernedTool).not.toHaveBeenCalled();
    const [, passedAction] = executeGovernedTrajectoryAction.mock.calls[0];
    expect(passedAction.toolName).toBe('search_code');
    expect(passedAction.declaredIntent).toBe('Undeclared call to search_code');
    expect(passedAction.risk).toBe('destructive');
  });

  it('declare_trajectory_plan and get_trajectory_status calls themselves are never trajectory-gated', async () => {
    await declare_trajectory_plan({
      goal: 'Plan A',
      authorized_scope: ['read_file'],
      risk_ceiling: 'read',
      actions: [{ toolName: 'read_file', declaredIntent: 'x', risk: 'read' }],
      session_id: sessionId,
    });

    await call('declare_trajectory_plan', {
      goal: 'Plan B', authorized_scope: ['search_code'], risk_ceiling: 'read',
      actions: [{ toolName: 'search_code', declaredIntent: 'y', risk: 'read' }], session_id: sessionId,
    });
    await call('get_trajectory_status', { session_id: sessionId });

    expect(executeGovernedTrajectoryAction).not.toHaveBeenCalled();
  });

  it('once the returned state is no longer active (completed/locked), the stored trajectory is cleared and the next call falls back to bare governance', async () => {
    await declare_trajectory_plan({
      goal: 'One step',
      authorized_scope: ['read_file'],
      risk_ceiling: 'read',
      actions: [{ toolName: 'read_file', declaredIntent: 'x', risk: 'read' }],
      session_id: sessionId,
    });

    executeGovernedTrajectoryAction.mockResolvedValueOnce({
      state: { plan: { planId: 'p', goal: 'g', authorizedScope: ['read_file'], riskCeiling: 'read', actions: [{ actionId: 'a', toolName: 'read_file', declaredIntent: 'x', risk: 'read' }] }, currentStep: 1, completed: ['a'], driftScore: 0, locked: false },
      result: 'DONE',
      action: { actionId: 'a', toolName: 'read_file', declaredIntent: 'x', risk: 'read' },
    });

    await call('read_file', { path: 'README.md', session_id: sessionId }); // completes the plan
    expect(getTrajectoryState(sessionId)).toBeUndefined();

    await call('read_file', { path: 'README.md', session_id: sessionId }); // now bare again
    expect(executeGovernedTool).toHaveBeenCalledTimes(1);
    expect(executeGovernedTrajectoryAction).toHaveBeenCalledTimes(1); // only the first (completing) call
  });
});
