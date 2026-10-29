import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  interceptToolCall: vi.fn(),
  readCanonicalGovernanceState: vi.fn(),
  canonicalExecutionAllowed: vi.fn(),
  advanceRecoveryPlane: vi.fn(),
  shouldAdvanceRecoveryPlane: vi.fn(() => false),
  rows: new Map<string, Record<string, unknown>>(),
}));

vi.mock('../lib/db', () => ({ getClient: () => ({ execute: mocks.dbExecute }) }));
vi.mock('../lib/agents/tool_interceptor', () => ({ interceptToolCall: mocks.interceptToolCall }));
vi.mock('../lib/agents/canonical_governance_state', () => ({
  readCanonicalGovernanceState: mocks.readCanonicalGovernanceState,
  canonicalExecutionAllowed: mocks.canonicalExecutionAllowed,
}));
vi.mock('../lib/agents/recovery_runtime', () => ({
  advanceRecoveryPlane: mocks.advanceRecoveryPlane,
  shouldAdvanceRecoveryPlane: mocks.shouldAdvanceRecoveryPlane,
}));

import { executeGovernedToolStructured } from '../lib/agents/constitutional_tool_executor';
import { createGovernanceApprovalToken } from '../lib/agents/tool_governance_gateway';
import { recordZTrajObservation, type ExpectedZTrajSample } from '../lib/kv';

const SESSION = 'observation-session';
const PREVIOUS = { c: 0.30, r: 0.35, s: 0.35 };
const MEASURED = { C: 0.30, R: 0.35, S: 0.35, M: 0.30, risk_level: 'LOW' };
const OLD_UPDATED_AT = '2026-10-01T00:00:00.000Z';

function row(overrides: Record<string, unknown> = {}) {
  return {
    session_id: SESSION,
    velocity: 0,
    n_stable: 0,
    drift_dir: 'stable',
    sigma_viol: 0,
    last_m: 0.30,
    last_c: PREVIOUS.c,
    last_r: PREVIOUS.r,
    last_s: PREVIOUS.s,
    z_c: 1 / 3,
    z_r: 1 / 3,
    z_s: 1 / 3,
    attack_pressure: 0,
    updated_at: OLD_UPDATED_AT,
    ...overrides,
  };
}

function expectedFrom(record: Record<string, unknown>): ExpectedZTrajSample {
  return {
    last_c: Number(record.last_c),
    last_r: Number(record.last_r),
    last_s: Number(record.last_s),
    sigma_viol: Number(record.sigma_viol ?? 0),
    updated_at: String(record.updated_at),
  };
}

function successDecision() {
  return {
    decision: 'ALLOW',
    approved: true,
    crs: MEASURED,
    health_band: 'OPTIMAL',
    sigma_viol: 0,
    receipt_id: 'observation-receipt',
    reason: 'test allow',
  };
}

function stateFor(sessionId: string, record?: Record<string, unknown>) {
  const current = record ?? row({ session_id: sessionId, last_c: 1 / 3, last_r: 1 / 3, last_s: 1 / 3, last_m: 1 / 3 });
  return {
    available: true,
    state: {
      sessionId,
      actorId: 'test-actor',
      C: Number(current.last_c),
      R: Number(current.last_r),
      S: Number(current.last_s),
      M: Number(current.last_m),
      healthBand: 'OPTIMAL',
      recoveryState: 'NORMAL',
      sigmaViol: Number(current.sigma_viol ?? 0),
      toolCalls: 0,
      trajectoryAvailable: Boolean(record),
      nStable: Number(current.n_stable ?? 0),
      canaryPassed: false,
      canaryReceiptId: null,
      stateFingerprint: 'f'.repeat(64),
      trajectoryUpdatedAt: String(current.updated_at),
      authorization: 'authorized',
      policyRisk: 'read',
      version: 'test-state',
      observedAt: '2026-10-12T00:00:00.000Z',
    },
  };
}

function selectTrajectory(sessionId: string) {
  return mocks.rows.get(sessionId);
}

function approvedArgs(toolName: string, args: Record<string, unknown>) {
  return {
    ...args,
    approval_token: createGovernanceApprovalToken({
      actorId: 'internal-agent', sessionId: SESSION, toolName, args,
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LEX_APPROVAL_SIGNING_SECRET = 'executor-observation-test-secret';
  mocks.rows.clear();
  mocks.rows.set(SESSION, row());
  mocks.interceptToolCall.mockResolvedValue(successDecision());
  mocks.advanceRecoveryPlane.mockResolvedValue({ advanced: false });
  mocks.canonicalExecutionAllowed.mockReturnValue({ allowed: true });
  mocks.readCanonicalGovernanceState.mockImplementation(async ({ sessionId }: { sessionId: string }) =>
    stateFor(sessionId, selectTrajectory(sessionId)));

  mocks.dbExecute.mockImplementation(async (statement: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof statement === 'string' ? statement : statement.sql;
    const args = typeof statement === 'string' ? [] : (statement.args ?? []);
    if (sql.includes('FROM z_traj')) {
      const found = mocks.rows.get(String(args[0]));
      return { rows: found ? [found] : [] };
    }
    if (sql.startsWith('UPDATE z_traj')) {
      const [sigmaViol, velocity, countStableObservation, testedVelocity, threshold, M, tauRecovery, lastM, lastC, lastR, lastS,
        updatedAt, sessionId, expectedC, expectedR, expectedS, expectedUpdatedAt, expectedSigmaViol] = args;
      const current = mocks.rows.get(String(sessionId));
      if (!current
        || Number(current.last_c) !== Number(expectedC)
        || Number(current.last_r) !== Number(expectedR)
        || Number(current.last_s) !== Number(expectedS)
        || String(current.updated_at) !== String(expectedUpdatedAt)
        || Number(current.sigma_viol) !== Number(expectedSigmaViol)) {
        return { rows: [], rowsAffected: 0 };
      }
      current.sigma_viol = sigmaViol;
      current.velocity = velocity;
      current.n_stable = Number(countStableObservation) === 1
        && Number(testedVelocity) < Number(threshold)
        && Number(M) >= Number(tauRecovery)
        ? Number(current.n_stable) + 1
        : 0;
      current.last_m = lastM;
      current.last_c = lastC;
      current.last_r = lastR;
      current.last_s = lastS;
      current.updated_at = updatedAt;
      return { rows: [], rowsAffected: 1 };
    }
    return { rows: [], rowsAffected: 1 };
  });
});

describe('governed tool stability observations', () => {
  it('does not count read-only inspections as recovery stability observations', async () => {
    const tool = vi.fn(async () => 'TOOL_OK');
    for (let count = 1; count <= 3; count += 1) {
      const result = await executeGovernedToolStructured(
        'read_file', { path: 'observation-' + count }, tool, SESSION,
      );
      expect(result.approved).toBe(true);
      expect(result.result).toContain('TOOL_OK');
      expect(mocks.rows.get(SESSION)?.n_stable).toBe(0);
    }
    expect(tool).toHaveBeenCalledTimes(3);
    expect(mocks.dbExecute.mock.calls.filter(([query]) =>
      typeof query === 'object' && query !== null && 'sql' in query
      && String((query as { sql: unknown }).sql).startsWith('UPDATE z_traj'),
    )).toHaveLength(0);
  });

  it('does not observe or advance recovery for a read-only query_database SELECT', async () => {
    const tool = vi.fn(async () => 'SELECT_RESULT');

    const result = await executeGovernedToolStructured(
      'query_database', { sql: 'SELECT 1' }, tool, SESSION,
    );

    expect(result.approved).toBe(true);
    expect(mocks.advanceRecoveryPlane).not.toHaveBeenCalled();
    expect(mocks.dbExecute.mock.calls.filter(([query]) =>
      typeof query === 'object' && query !== null && 'sql' in query
      && String((query as { sql: unknown }).sql).startsWith('UPDATE z_traj'),
    )).toHaveLength(0);
  });

  it('continues observing a mutating query_database UPDATE', async () => {
    const tool = vi.fn(async () => 'UPDATE_RESULT');

    const result = await executeGovernedToolStructured(
      'query_database', approvedArgs('query_database', { sql: 'UPDATE accounts SET active = 0' }), tool, SESSION,
    );

    expect(result.approved).toBe(true);
    expect(mocks.dbExecute.mock.calls.filter(([query]) =>
      typeof query === 'object' && query !== null && 'sql' in query
      && String((query as { sql: unknown }).sql).startsWith('UPDATE z_traj'),
    )).toHaveLength(1);
  });

  it.each(['get_workflow_artifact', 'review_agent_action', 'narrate_origin'])
    ('does not observe pure inspection tool %s', async (toolName) => {
      const tool = vi.fn(async () => 'INSPECTION_RESULT');
      const result = await executeGovernedToolStructured(
        toolName, approvedArgs(toolName, { fixture: toolName }), tool, SESSION,
      );

      expect(result.approved).toBe(true);
      expect(mocks.dbExecute.mock.calls.filter(([query]) =>
        typeof query === 'object' && query !== null && 'sql' in query
        && String((query as { sql: unknown }).sql).startsWith('UPDATE z_traj'),
      )).toHaveLength(0);
    });

  it.each(['dispatch_workflow', 'write_file'])
    ('continues observing mutating tool %s', async (toolName) => {
      const tool = vi.fn(async () => 'MUTATION_RESULT');
      const result = await executeGovernedToolStructured(
        toolName, approvedArgs(toolName, { fixture: toolName }), tool, SESSION,
      );

      expect(result.approved).toBe(true);
      expect(mocks.dbExecute.mock.calls.filter(([query]) =>
        typeof query === 'object' && query !== null && 'sql' in query
        && String((query as { sql: unknown }).sql).startsWith('UPDATE z_traj'),
      )).toHaveLength(1);
    });

  it('records nothing for a denied call', async () => {
    mocks.interceptToolCall.mockResolvedValueOnce({
      ...successDecision(), approved: false, decision: 'DENY',
    });
    const tool = vi.fn(async () => 'MUST_NOT_RUN');

    const result = await executeGovernedToolStructured('read_file', { path: 'denied' }, tool, SESSION);

    expect(result.approved).toBe(false);
    expect(tool).not.toHaveBeenCalled();
    expect(mocks.rows.get(SESSION)?.n_stable).toBe(0);
    expect(mocks.dbExecute.mock.calls.some(([query]) =>
      typeof query === 'object' && query !== null && 'sql' in query
      && String((query as { sql: unknown }).sql).startsWith('UPDATE z_traj'),
    )).toBe(false);
  });

  it('records nothing for a cache hit', async () => {
    const tool = vi.fn(async () => 'CACHED_TOOL_OK');
    const args = { path: 'same-cache-key' };
    const first = await executeGovernedToolStructured('read_file', args, tool, SESSION);
    const countAfterMiss = mocks.rows.get(SESSION)?.n_stable;
    const second = await executeGovernedToolStructured('read_file', args, tool, SESSION);

    expect(first.result).toContain('cache_hit:   false');
    expect(second.result).toContain('cache_hit:   true');
    expect(countAfterMiss).toBe(0);
    expect(mocks.rows.get(SESSION)?.n_stable).toBe(0);
    expect(tool).toHaveBeenCalledOnce();
    expect(mocks.dbExecute.mock.calls.filter(([query]) =>
      typeof query === 'object' && query !== null && 'sql' in query
      && String((query as { sql: unknown }).sql).startsWith('UPDATE z_traj'),
    )).toHaveLength(0);
  });

  it('does not record run_recovery_canary', async () => {
    const probe = vi.fn(async () => 'CANARY_PROBE_OK');
    const result = await executeGovernedToolStructured(
      'run_recovery_canary', { session_id: SESSION }, probe, SESSION,
    );

    expect(result.result).toContain('CANARY_PROBE_OK');
    expect(probe).toHaveBeenCalledOnce();
    expect(mocks.rows.get(SESSION)?.n_stable).toBe(0);
    expect(mocks.dbExecute.mock.calls.some(([query]) =>
      typeof query === 'object' && query !== null && 'sql' in query
      && String((query as { sql: unknown }).sql).startsWith('UPDATE z_traj'),
    )).toBe(false);
  });

  it('ignores caller-supplied CRS and n_stable values', async () => {
    const tool = vi.fn(async () => 'ARGS_IGNORED');
    await executeGovernedToolStructured('read_file', {
      path: 'forged-measurement',
      crs: { C: 0.01, R: 0.01, S: 0.98 },
      n_stable: 999,
    }, tool, SESSION);

    const updated = mocks.rows.get(SESSION)!;
    expect(updated.last_c).toBe(MEASURED.C);
    expect(updated.last_r).toBe(MEASURED.R);
    expect(updated.last_s).toBe(MEASURED.S);
    expect(updated.n_stable).toBe(0);
    expect(mocks.dbExecute.mock.calls.some(([query]) =>
      typeof query === 'object' && query !== null && 'sql' in query
      && String((query as { sql: unknown }).sql).startsWith('UPDATE z_traj'),
    )).toBe(false);
  });

  it('allows only one concurrent observation based on the same previous sample', async () => {
    const previous = expectedFrom(mocks.rows.get(SESSION)!);
    const results = await Promise.all([
      recordZTrajObservation(SESSION, previous, PREVIOUS),
      recordZTrajObservation(SESSION, previous, PREVIOUS),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(mocks.rows.get(SESSION)?.n_stable).toBe(1);
    const update = mocks.dbExecute.mock.calls.find(([query]) =>
      typeof query === 'object' && query !== null && 'sql' in query
      && String((query as { sql: unknown }).sql).startsWith('UPDATE z_traj'),
    )?.[0] as { sql: string } | undefined;
    expect(update?.sql).toContain(
      'WHERE session_id = ? AND last_c = ? AND last_r = ? AND last_s = ? AND updated_at = ?',
    );
    expect(mocks.dbExecute.mock.calls.some(([query]) =>
      typeof query === 'object' && query !== null && 'sql' in query
      && /INSERT\s+INTO\s+z_traj/i.test(String((query as { sql: unknown }).sql)),
    )).toBe(false);
  });

  it('records a zero-velocity baseline without incrementing stable observations', async () => {
    mocks.rows.set(SESSION, row({ velocity: 0.08, n_stable: 2 }));
    const previous = expectedFrom(mocks.rows.get(SESSION)!);

    const recorded = await recordZTrajObservation(SESSION, previous, PREVIOUS, false);

    expect(recorded).toBe(true);
    expect(mocks.rows.get(SESSION)?.velocity).toBe(0);
    expect(mocks.rows.get(SESSION)?.n_stable).toBe(0);
  });

  it('does not create an observation for a missing trajectory row', async () => {
    mocks.rows.delete(SESSION);
    const recorded = await recordZTrajObservation(SESSION, null, PREVIOUS);

    expect(recorded).toBe(false);
    expect(mocks.rows.has(SESSION)).toBe(false);
    expect(mocks.dbExecute).not.toHaveBeenCalled();
  });

  it('preserves the tool result and stable count when the conditional write fails', async () => {
    const tool = vi.fn(async () => 'RESULT_SURVIVES_OBSERVATION_FAILURE');
    mocks.dbExecute.mockImplementation(async (statement: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof statement === 'string' ? statement : statement.sql;
      const args = typeof statement === 'string' ? [] : (statement.args ?? []);
      if (sql.includes('FROM z_traj')) {
        const found = mocks.rows.get(String(args[0]));
        return { rows: found ? [found] : [] };
      }
      if (sql.startsWith('UPDATE z_traj')) throw new Error('simulated observation write failure');
      return { rows: [], rowsAffected: 1 };
    });

    const result = await executeGovernedToolStructured('read_file', { path: 'write-fails' }, tool, SESSION);

    expect(result.approved).toBe(true);
    expect(result.result).toContain('RESULT_SURVIVES_OBSERVATION_FAILURE');
    expect(tool).toHaveBeenCalledOnce();
    expect(mocks.rows.get(SESSION)?.n_stable).toBe(0);
  });
});
