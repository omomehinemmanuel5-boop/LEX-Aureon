import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getClient } from '../lib/db';
import { readRecoveryCanaryEvidence } from '../lib/agents/recovery_canary_evidence';

describe('recovery canary write-count expiry against real SQLite', () => {
  let directory: string;
  let client: ReturnType<typeof getClient>;
  const sessionId = 'sqlite-canary-write-count-session';

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'canary-invariant-sqlite-'));
    vi.stubEnv('TURSO_DATABASE_URL', `file:${join(directory, 'canary.sqlite')}`);
    vi.stubEnv('TURSO_AUTH_TOKEN', 'sqlite-test-token');
    vi.stubEnv('CANARY_MODE', 'invariant');
    vi.stubEnv('CANARY_MAX_GOVERNED_WRITES', '4');
    vi.stubEnv('CANARY_WINDOW_MS', '3600000');
    client = getClient();
    await client.execute(`CREATE TABLE recovery_canary_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      canary_status TEXT NOT NULL,
      state_fingerprint TEXT NOT NULL,
      state_version TEXT NOT NULL,
      probe_tool TEXT NOT NULL,
      receipt_id TEXT NOT NULL,
      c_value REAL NOT NULL,
      r_value REAL NOT NULL,
      s_value REAL NOT NULL,
      m_value REAL NOT NULL,
      n_stable INTEGER NOT NULL,
      sigma_viol REAL NOT NULL,
      trajectory_updated_at TEXT NOT NULL,
      reason TEXT,
      recovery_state TEXT,
      issued_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await client.execute(`CREATE TABLE tool_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      tool_name TEXT NOT NULL
    )`);
  }, 30_000);

  afterAll(async () => {
    if (client) await client.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('counts mixed ISO/SQLite timestamps, ignores read-only receipts, and expires at the limit', async () => {
    const issuedMs = Date.now() - 60_000;
    const issuedAt = new Date(issuedMs).toISOString();
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const evidence = {
      session_id: sessionId,
      actor_id: 'operator',
      canary_status: 'passed',
      state_fingerprint: 'a'.repeat(64),
      state_version: 'canonical-governance-2026-10-10.1',
      probe_tool: 'get_constitutional_state',
      receipt_id: 'sqlite-canary-receipt',
      c_value: 0.2,
      r_value: 0.2,
      s_value: 0.2,
      m_value: 0.2,
      n_stable: 3,
      sigma_viol: 0,
      trajectory_updated_at: issuedAt,
      recovery_state: 'VERIFIED',
      issued_at: issuedAt,
      expires_at: expiresAt,
    };
    await client.execute({
      sql: `INSERT INTO recovery_canary_evidence
        (session_id, actor_id, canary_status, state_fingerprint, state_version, probe_tool,
         receipt_id, c_value, r_value, s_value, m_value, n_stable, sigma_viol,
         trajectory_updated_at, recovery_state, issued_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: Object.values(evidence),
    });

    const isoTime = new Date(issuedMs + 10_000).toISOString();
    const sqliteTime = isoTime.replace('T', ' ').replace(/\.\d{3}Z$/, '');
    expect(sqliteTime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const writeRows = [
      ['write-a', isoTime],
      ['write-b', sqliteTime],
      ['write-c', isoTime],
      ['write-d', sqliteTime],
    ];
    for (const [toolName, createdAt] of writeRows.slice(0, 2)) {
      await client.execute({
        sql: 'INSERT INTO tool_receipts (session_id, created_at, tool_name) VALUES (?, ?, ?)',
        args: [sessionId, createdAt, toolName],
      });
    }
    for (const toolName of ['read_file', 'simulate_agent_plan', 'get_constitutional_state']) {
      await client.execute({
        sql: 'INSERT INTO tool_receipts (session_id, created_at, tool_name) VALUES (?, ?, ?)',
        args: [sessionId, sqliteTime, toolName],
      });
    }

    // A live run_governance call and a simulate-mode run_governance call
    // are both conservatively counted until the receipt schema distinguishes them.
    await client.execute({
      sql: 'INSERT INTO tool_receipts (session_id, created_at, tool_name) VALUES (?, ?, ?)',
      args: [sessionId, sqliteTime, 'run_governance'],
    });

    const current = { stateVersion: evidence.state_version, stateFingerprint: 'a'.repeat(64), M: 0.2, sigmaViol: 0, nStable: 3 };
    await expect(readRecoveryCanaryEvidence(sessionId, 'a'.repeat(64), current))
      .resolves.toMatchObject({ passed: true, receiptId: 'sqlite-canary-receipt' });

    await client.execute({
      sql: 'INSERT INTO tool_receipts (session_id, created_at, tool_name) VALUES (?, ?, ?)',
      args: [sessionId, sqliteTime, writeRows[3][0]],
    });
    await expect(readRecoveryCanaryEvidence(sessionId, 'fingerprint-not-used', current))
      .resolves.toMatchObject({ passed: false, receiptId: null });

    const normalizedCount = await client.execute({
      sql: `SELECT COUNT(*) AS writes FROM tool_receipts
        WHERE session_id = ? AND datetime(created_at) > datetime(?)
          AND tool_name IN ('write-a', 'write-b', 'write-c', 'write-d', 'run_governance')`,
      args: [sessionId, issuedAt],
    });
    expect(Number(normalizedCount.rows[0].writes)).toBe(4);
    expect(Number.isFinite(Date.parse(expiresAt))).toBe(true);
    expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
  });
});
