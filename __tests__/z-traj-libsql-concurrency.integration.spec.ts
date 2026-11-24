import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client/node';

const clients = vi.hoisted(() => ({
  current: null as unknown as Client,
}));

vi.mock('../lib/db', () => ({
  getClient: () => clients.current,
}));

import { recordZTrajObservation, updateZTraj } from '../lib/kv';

describe('z_traj embedded libSQL transaction integration', () => {
  let clientA: Client;
  let clientB: Client;
  let directory: string;
  let databasePath: string;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'lex-ztraj-concurrency-'));
    databasePath = join(directory, 'trajectory.db');
  });

  beforeEach(async () => {
    // Fresh connections per case prevent a completed test's local SQLite
    // cursor state from leaking into the next transaction scenario.
    clientA = createClient({ url: `file:${databasePath}` });
    clientB = createClient({ url: `file:${databasePath}` });
    let nextClient = 0;
    clients.current = {
      execute: (...args: Parameters<Client['execute']>) => {
        const selected = nextClient++ % 2 === 0 ? clientA : clientB;
        return selected.execute(...args);
      },
      transaction: (...args: Parameters<Client['transaction']>) => {
        const selected = nextClient++ % 2 === 0 ? clientA : clientB;
        return selected.transaction(...args);
      },
    } as Client;

    await clientA.execute(`
      CREATE TABLE IF NOT EXISTS z_traj (
        session_id TEXT PRIMARY KEY,
        velocity REAL NOT NULL,
        n_stable INTEGER NOT NULL,
        drift_dir TEXT NOT NULL,
        sigma_viol REAL NOT NULL,
        last_m REAL NOT NULL,
        last_c REAL NOT NULL,
        last_r REAL NOT NULL,
        last_s REAL NOT NULL,
        z_c REAL NOT NULL,
        z_r REAL NOT NULL,
        z_s REAL NOT NULL,
        attack_pressure REAL NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await clientA.execute(`CREATE TABLE IF NOT EXISTS z_traj_observation_events (
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      PRIMARY KEY (session_id, event_id)
    )`);
    await clientA.execute('DELETE FROM z_traj_observation_events');
    await clientA.execute('DELETE FROM z_traj');
    await clientA.execute({
      sql: `INSERT INTO z_traj (
        session_id, velocity, n_stable, drift_dir, sigma_viol, last_m,
        last_c, last_r, last_s, z_c, z_r, z_s, attack_pressure, updated_at
      ) VALUES (?, 0, 0, 'stable', 0, 0.33, 0.34, 0.33, 0.33,
        0.333333, 0.333333, 0.333334, 0, '2026-01-01T00:00:00.000Z')`,
      args: ['integration-session'],
    });
  });

  afterEach(async () => {
    await Promise.all([clientA.close(), clientB.close()]);
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('serializes distinct concurrent observations without losing either event or using a stale CRS baseline', async () => {
    const staleCallerSnapshot = { c: 0.34, r: 0.33, s: 0.33 };
    const first = { c: 0.341, r: 0.329, s: 0.33 };
    const second = { c: 0.342, r: 0.328, s: 0.33 };

    const results = await Promise.all([
      updateZTraj('integration-session', first, staleCallerSnapshot, undefined, [], 'concurrent-event-a'),
      updateZTraj('integration-session', second, staleCallerSnapshot, undefined, [], 'concurrent-event-b'),
    ]);

    expect(results).toHaveLength(2);
    const persisted = await clientA.execute({
      sql: 'SELECT * FROM z_traj WHERE session_id = ?',
      args: ['integration-session'],
    });
    const row = persisted.rows[0];
    expect(row).toBeDefined();

    const finalCRS = {
      c: Number(row.last_c),
      r: Number(row.last_r),
      s: Number(row.last_s),
    };
    const isFirst = finalCRS.c === first.c && finalCRS.r === first.r;
    const isSecond = finalCRS.c === second.c && finalCRS.r === second.r;
    expect(isFirst || isSecond).toBe(true);

    // Whichever transaction committed second must measure from the first
    // persisted sample, not from the stale caller snapshot.
    expect(Number(row.velocity)).toBeCloseTo(Math.sqrt(0.001 ** 2 + 0.001 ** 2), 8);
    const events = await clientA.execute('SELECT COUNT(*) AS count FROM z_traj_observation_events');
    expect(Number(events.rows[0].count)).toBe(2);
  });

  it('applies a concurrently replayed event exactly once across independent clients', async () => {
    const measured = { c: 0.341, r: 0.329, s: 0.33 };
    const staleCallerSnapshot = { c: 0.34, r: 0.33, s: 0.33 };

    const results = await Promise.all([
      updateZTraj('integration-session', measured, staleCallerSnapshot, undefined, [], 'same-logical-event'),
      updateZTraj('integration-session', measured, staleCallerSnapshot, undefined, [], 'same-logical-event'),
    ]);

    expect(results[0].n_stable).toBe(1);
    expect(results[1].n_stable).toBe(1);
    expect(results[0].updated_at).toBe(results[1].updated_at);

    const events = await clientA.execute('SELECT COUNT(*) AS count FROM z_traj_observation_events');
    expect(Number(events.rows[0].count)).toBe(1);
    const persisted = await clientA.execute({
      sql: 'SELECT n_stable, last_c, last_r, last_s FROM z_traj WHERE session_id = ?',
      args: ['integration-session'],
    });
    expect(Number(persisted.rows[0].n_stable)).toBe(1);
    expect(Number(persisted.rows[0].last_c)).toBe(measured.c);
  });

  it('uses persisted CRS and database-clock dwell on a later observation despite a stale caller snapshot', async () => {
    const first = { c: 0.341, r: 0.329, s: 0.33 };
    const second = { c: 0.342, r: 0.328, s: 0.33 };
    const staleCallerSnapshot = { c: 0.9, r: 0.05, s: 0.05 };

    await updateZTraj('integration-session', first, staleCallerSnapshot, undefined, [], 'clock-event-one');
    const immediate = await updateZTraj(
      'integration-session', second, staleCallerSnapshot, undefined, [], 'clock-event-two',
    );

    expect(immediate.velocity).toBeCloseTo(Math.sqrt(0.001 ** 2 + 0.001 ** 2), 8);
    // The first sample had an old database timestamp and qualifies; the
    // immediate second sample is inside the five-second dwell and cannot add
    // another stability count.
    expect(immediate.n_stable).toBe(1);
    expect(immediate.sigma_viol).toBe(0);
  });

  it('allows only one concurrent CAS stability observation from the same persisted snapshot', async () => {
    const expectedPrevious = {
      last_c: 0.34,
      last_r: 0.33,
      last_s: 0.33,
      sigma_viol: 0,
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const measured = { c: 0.341, r: 0.329, s: 0.33 };

    const results = await Promise.all([
      recordZTrajObservation('integration-session', expectedPrevious, measured, true),
      recordZTrajObservation('integration-session', expectedPrevious, measured, true),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const persisted = await clientA.execute({
      sql: 'SELECT n_stable, last_c, last_r, last_s FROM z_traj WHERE session_id = ?',
      args: ['integration-session'],
    });
    expect(Number(persisted.rows[0].n_stable)).toBe(1);
    expect(Number(persisted.rows[0].last_c)).toBe(measured.c);
  });

});
