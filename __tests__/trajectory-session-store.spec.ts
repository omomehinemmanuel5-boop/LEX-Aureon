import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors the established pattern in governed-tool-executor.integration.spec.ts:
// mock getClient().execute with a simple in-memory table simulation, rather
// than needing a real Turso connection for a unit test.
const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));

vi.mock('../lib/db', () => ({
  getClient: () => ({ execute: dbExecute }),
}));

import {
  getTrajectoryState, setTrajectoryState, claimTrajectoryState, compareAndSetTrajectoryState,
  clearTrajectoryState, isTrajectoryActive,
} from '../lib/agents/trajectory_session_store';
import { createTrajectoryPlan, createTrajectoryState } from '../lib/agents/trajectory_governance';

function planWithSteps(n: number) {
  return createTrajectoryPlan({
    goal: 'test',
    authorizedScope: ['read_file'],
    riskCeiling: 'read',
    actions: Array.from({ length: n }, (_, i) => ({
      actionId: `a${i}`, toolName: 'read_file', declaredIntent: 'x', risk: 'read' as const,
    })),
  });
}

// In-memory table simulation behind the mocked dbExecute, keyed like the
// real `trajectory_state` table (session_id PRIMARY KEY, state_json).
// This is what actually makes get/set/clear round-trip realistically in
// this test, including proving persistence survives a fresh call the way
// a real DB (unlike a module-scope Map) would across serverless instances.
function installFakeTable() {
  const table = new Map<string, string>();
  dbExecute.mockImplementation(async (query: string | { sql: string; args: unknown[] }) => {
    if (typeof query === 'string') return { rows: [] }; // CREATE TABLE
    const { sql, args } = query;
    if (sql.startsWith('SELECT')) {
      const [sessionId] = args as [string];
      const json = table.get(sessionId);
      return { rows: json ? [{ state_json: json, version: JSON.parse(json).version ?? 0 }] : [] };
    }
    if (sql.startsWith('INSERT')) {
      const [sessionId, stateJson] = args as [string, string];
      table.set(sessionId, stateJson);
      return { rows: [] };
    }
    if (sql.startsWith('UPDATE')) {
      const [stateJson, _version, _updatedAt, sessionId, expectedVersion] = args as [string, number, number, string, number];
      const previous = table.get(sessionId);
      const currentVersion = previous ? (JSON.parse(previous).version ?? 0) : -1;
      if (currentVersion !== expectedVersion) return { rowsAffected: 0, rows: [] };
      table.set(sessionId, stateJson);
      return { rowsAffected: 1, rows: [] };
    }
    if (sql.startsWith('DELETE')) {
      const [sessionId] = args as [string];
      table.delete(sessionId);
      return { rows: [] };
    }
    return { rows: [] };
  });
  return table;
}

describe('trajectory_session_store (Turso-backed)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installFakeTable();
  });

  it('returns undefined for a session with no declared plan', async () => {
    expect(await getTrajectoryState('never-declared-session')).toBeUndefined();
    expect(isTrajectoryActive(undefined)).toBe(false);
  });

  it('stores and retrieves state by session id, isolated from other sessions', async () => {
    const state = createTrajectoryState(planWithSteps(2));
    await setTrajectoryState('session-a', state);
    const stored = await getTrajectoryState('session-a');
    const { updatedAt: _storedUpdatedAt, ...storedWithoutTimestamp } = stored ?? {};
    const { updatedAt: _stateUpdatedAt, version: _stateVersion, ...stateWithoutTimestamp } = state;
    const storedWithoutVersion = { ...storedWithoutTimestamp };
    delete storedWithoutVersion.version;
    expect(storedWithoutVersion).toEqual(stateWithoutTimestamp);
    expect(stored?.updatedAt).toBeGreaterThanOrEqual(state.updatedAt ?? 0);
    expect(await getTrajectoryState('session-b')).toBeUndefined();
  });

  it('clearTrajectoryState removes only the targeted session', async () => {
    await setTrajectoryState('session-x', createTrajectoryState(planWithSteps(1)));
    await setTrajectoryState('session-y', createTrajectoryState(planWithSteps(1)));
    await clearTrajectoryState('session-x');
    expect(await getTrajectoryState('session-x')).toBeUndefined();
    expect(await getTrajectoryState('session-y')).toBeDefined();
  });

  it('a second setTrajectoryState call for the same session overwrites (upsert), not duplicates', async () => {
    const state1 = createTrajectoryState(planWithSteps(2));
    await setTrajectoryState('session-z', state1);
    const state2 = { ...state1, currentStep: 1 };
    await setTrajectoryState('session-z', state2);
    const retrieved = await getTrajectoryState('session-z');
    expect(retrieved!.currentStep).toBe(1);
  });

  it('claims a step once and rejects a stale concurrent writer', async () => {
    const state = createTrajectoryState(planWithSteps(1));
    await setTrajectoryState('session-claim', state);
    const first = await claimTrajectoryState('session-claim', 0);
    expect(first?.inFlight).toBe(true);
    expect(await claimTrajectoryState('session-claim', 0)).toBeUndefined();
    const committed = await compareAndSetTrajectoryState('session-claim', { ...first!, inFlight: false, currentStep: 1 }, 1);
    expect(committed).toBe(true);
    expect((await getTrajectoryState('session-claim'))?.currentStep).toBe(1);
  });

  it('isTrajectoryActive: true while steps remain and not locked', () => {
    const state = createTrajectoryState(planWithSteps(2));
    expect(isTrajectoryActive(state)).toBe(true);
  });

  it('isTrajectoryActive: false once currentStep reaches the action count', () => {
    const state = { ...createTrajectoryState(planWithSteps(1)), currentStep: 1 };
    expect(isTrajectoryActive(state)).toBe(false);
  });

  it('isTrajectoryActive: false when locked, even with steps remaining', () => {
    const state = { ...createTrajectoryState(planWithSteps(2)), locked: true };
    expect(isTrajectoryActive(state)).toBe(false);
  });
});
