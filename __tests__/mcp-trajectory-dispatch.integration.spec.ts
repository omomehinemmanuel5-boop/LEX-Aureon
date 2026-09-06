import { beforeEach, describe, expect, it, vi } from 'vitest';

const { executeGovernedTool, executeGovernedTrajectoryAction, dbExecute } = vi.hoisted(() => ({
  executeGovernedTool: vi.fn(),
  executeGovernedTrajectoryAction: vi.fn(),
  dbExecute: vi.fn(),
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

// The trajectory session store (imported both by route.ts via '@/lib/...'
// and by declare_trajectory_plan via '../agents/...') is Turso-backed as of
// the 2026-09-06 fix. Mock its underlying getClient() with a simple
// in-memory table simulation — same approach as trajectory-session-store.spec.ts
// — rather than needing a real DB connection for this dispatch-routing test.
vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: dbExecute }),
}));

function installFakeTrajectoryTable() {
  const table = new Map<string, string>();
  dbExecute.mockImplementation(async (query: string | { sql: string; args: unknown[] }) => {
    if (typeof query === 'string') return { rows: [] };
    const { sql, args } = query;
    if (sql.startsWith('SELECT')) {
      const [sessionId] = args as [string];
      const json = table.get(sessionId);
      return { rows: json ? [{ state_json: json }] : [] };
    }
    if (sql.startsWith('INSERT')) {
      const [sessionId, stateJson] = args as [string, string];
      table.set(sessionId, stateJson);
      return { rows: [] };
    }
    if (sql.startsWith('DELETE')) {
      const [sessionId] = args as [string];
      table.delete(sessionId);
      return { rows: [] };
    }
    return { rows: [] };
  });
}

// Canned response, does NOT invoke the real toolFn — this test is about
// dispatch ROUTING decisions (which executor gets called, with what
// arguments), not about exercising real tool business logic or making
// real network calls.
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

  beforeEach(async () => {
    vi.clearAllMocks();
    installFakeTrajectoryTable();
    await clearTrajectoryState(sessionId);
    executeGovernedTool.mockResolvedValue('approved:    true\ncache_hit:   false\nBARE_RESULT');
    // Dynamic, not static: reflects the REAL state/plan passed in (advancing
    // currentStep by one), so tests that declare a real plan and then check
    // persisted state afterward see a realistic result — not a fixed canned
    // shape unrelated to what was actually declared. Individual tests that
    // need a specific denial/completion shape override this with
    // mockResolvedValueOnce before making that call.
    executeGovernedTrajectoryAction.mockImplementation(async (state, action) => ({
      state: { ...state, currentStep: state.currentStep + 1, completed: [...state.completed, action.actionId] },
      result: 'TRAJECTORY_RESULT',
      action,
    }));
  });

  it('with no declared plan, dispatches through bare executeGovernedTool as before', async () => {
    expect(await getTrajectoryState(sessionId)).toBeUndefined();
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
    const state = await getTrajectoryState(sessionId);
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
    expect(await getTrajectoryState(sessionId)).toBeUndefined();

    await call('read_file', { path: 'README.md', session_id: sessionId }); // now bare again
    expect(executeGovernedTool).toHaveBeenCalledTimes(1);
    expect(executeGovernedTrajectoryAction).toHaveBeenCalledTimes(1); // only the first (completing) call
  });

  it('regression: state actually survives a fresh call the way it would across a serverless cold start (the original bug)', async () => {
    // This is the exact scenario that broke live: declare, then read the
    // state back as if from a completely separate request/instance —
    // proven here by NOT sharing any in-process object between the write
    // and the read, only the fake DB table underneath dbExecute.
    await declare_trajectory_plan({
      goal: 'Cold start regression check',
      authorized_scope: ['read_file'],
      risk_ceiling: 'read',
      actions: [
        { toolName: 'read_file', declaredIntent: 'step one', risk: 'read' },
        { toolName: 'read_file', declaredIntent: 'step two', risk: 'read' },
      ],
      session_id: sessionId,
    });

    await call('read_file', { path: 'a.md', session_id: sessionId });

    // After one successful step of a two-step plan, state must still be
    // there and still active — this is exactly what was lost before.
    const state = await getTrajectoryState(sessionId);
    expect(state).toBeDefined();
    expect(state!.currentStep).toBe(1);
    expect(state!.plan.actions).toHaveLength(2);
  });
});
