import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  log: [] as string[],
  row: null as Record<string, unknown> | null,
  recentCount: 0,
  lastReset: 0,
  archiveFails: false,
  deleteAffects: 1,
  hasTransaction: true,
  committed: false,
  rolledBack: false,
}));

function handle(sql: string, args: unknown[] = []) {
  fake.log.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
  if (sql.includes('CREATE TABLE')) return { rows: [], rowsAffected: 0 };
  if (sql.includes('COUNT(*)')) return { rows: [{ n: fake.recentCount, last: fake.lastReset }], rowsAffected: 0 };
  if (sql.startsWith('SELECT * FROM z_traj')) return { rows: fake.row ? [fake.row] : [], rowsAffected: 0 };
  if (sql.startsWith('INSERT INTO quarantine_resets')) {
    if (fake.archiveFails) throw new Error('archive down');
    return { rows: [], rowsAffected: 1 };
  }
  if (sql.startsWith('DELETE FROM z_traj')) return { rows: [], rowsAffected: fake.deleteAffects };
  void args;
  return { rows: [], rowsAffected: 0 };
}

vi.mock('../lib/db', () => ({
  getClient: () => ({
    execute: async ({ sql, args }: { sql: string; args?: unknown[] }) => handle(sql, args),
    transaction: fake.hasTransaction
      ? async () => ({
          execute: async ({ sql, args }: { sql: string; args?: unknown[] }) => handle(sql, args),
          commit: async () => { fake.committed = true; fake.log.push('COMMIT'); },
          rollback: async () => { fake.rolledBack = true; fake.log.push('ROLLBACK'); },
        })
      : undefined,
  }),
}));

import { resetQuarantinedSession, sessionBelongsToOwner } from '../lib/agents/quarantine_reset';

const OWNER = 'key_abc';
const SESSION = `${OWNER}:mcp-0123456789ab`;
const quarantinedRow = { session_id: SESSION, last_m: 0.04, sigma_viol: 1, n_stable: 0 };

describe('owner self-reset of a quarantined session', () => {
  beforeEach(() => {
    fake.log.length = 0;
    fake.row = quarantinedRow;
    fake.recentCount = 0;
    fake.lastReset = 0;
    fake.archiveFails = false;
    fake.deleteAffects = 1;
    fake.hasTransaction = true;
    fake.committed = false;
    fake.rolledBack = false;
  });

  it('refuses a session that belongs to another owner, with no writes', async () => {
    const result = await resetQuarantinedSession({ sessionId: 'other_key:mcp-0123456789ab', ownerId: OWNER });
    expect(result).toMatchObject({ ok: false, code: 'not_owner' });
    expect(fake.log.some(l => l.startsWith('INSERT') || l.startsWith('DELETE'))).toBe(false);
  });

  it('refuses a healthy session and writes nothing', async () => {
    fake.row = { ...quarantinedRow, last_m: 0.3 };
    const result = await resetQuarantinedSession({ sessionId: SESSION, ownerId: OWNER });
    expect(result).toMatchObject({ ok: false, code: 'not_quarantined' });
    expect(fake.committed).toBe(false);
    expect(fake.log.some(l => l.startsWith('INSERT') || l.startsWith('DELETE'))).toBe(false);
  });

  it('refuses when no trajectory exists', async () => {
    fake.row = null;
    const result = await resetQuarantinedSession({ sessionId: SESSION, ownerId: OWNER });
    expect(result).toMatchObject({ ok: false, code: 'no_trajectory' });
  });

  it('archives before deleting, then commits, for a quarantined session', async () => {
    const result = await resetQuarantinedSession({ sessionId: SESSION, ownerId: OWNER });
    expect(result.ok).toBe(true);
    const insertAt = fake.log.findIndex(l => l.startsWith('INSERT INTO'));
    const deleteAt = fake.log.findIndex(l => l.startsWith('DELETE FROM'));
    expect(insertAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(insertAt);
    expect(fake.log[fake.log.length - 1]).toBe('COMMIT');
    expect(fake.committed).toBe(true);
  });

  it('keeps the row and rolls back when the archive write fails', async () => {
    fake.archiveFails = true;
    const result = await resetQuarantinedSession({ sessionId: SESSION, ownerId: OWNER });
    expect(result).toMatchObject({ ok: false, code: 'archive_failed' });
    expect(fake.log.some(l => l.startsWith('DELETE'))).toBe(false);
    expect(fake.rolledBack).toBe(true);
    expect(fake.committed).toBe(false);
  });

  it('rolls back on a concurrent change to the row', async () => {
    fake.deleteAffects = 0;
    const result = await resetQuarantinedSession({ sessionId: SESSION, ownerId: OWNER });
    expect(result).toMatchObject({ ok: false, code: 'conflict' });
    expect(fake.rolledBack).toBe(true);
    expect(fake.committed).toBe(false);
  });

  it('refuses when the database has no atomic transaction support', async () => {
    fake.hasTransaction = false;
    const result = await resetQuarantinedSession({ sessionId: SESSION, ownerId: OWNER });
    expect(result).toMatchObject({ ok: false, code: 'archive_failed' });
    expect(fake.log.some(l => l.startsWith('DELETE') || l.startsWith('INSERT INTO'))).toBe(false);
  });

  it('pauses resets after the alert threshold within the pause window', async () => {
    const now = 10_000_000_000;
    fake.recentCount = 5;
    fake.lastReset = now - 1000;
    const result = await resetQuarantinedSession({ sessionId: SESSION, ownerId: OWNER, nowMs: now });
    expect(result).toMatchObject({ ok: false, code: 'paused' });
  });

  it('allows a reset again after the pause window ends', async () => {
    const now = 10_000_000_000;
    fake.recentCount = 5;
    fake.lastReset = now - 2 * 60 * 60 * 1000;
    const result = await resetQuarantinedSession({ sessionId: SESSION, ownerId: OWNER, nowMs: now });
    expect(result.ok).toBe(true);
  });

  it('allows the first resets with no waiting', async () => {
    fake.recentCount = 1;
    fake.lastReset = Date.now() - 60_000;
    const result = await resetQuarantinedSession({ sessionId: SESSION, ownerId: OWNER });
    expect(result.ok).toBe(true);
  });

  it('matches session ownership strictly by owner prefix', () => {
    expect(sessionBelongsToOwner(SESSION, OWNER)).toBe(true);
    expect(sessionBelongsToOwner(`${OWNER}x:mcp-1`, OWNER)).toBe(false);
    expect(sessionBelongsToOwner('mcp-1', OWNER)).toBe(false);
  });
});
