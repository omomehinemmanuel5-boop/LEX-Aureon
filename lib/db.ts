/**
 * Turso (libSQL) persistence layer for Lex Aureon.
 * Single backend. No in-memory fallback. No silent failures.
 */

import { createClient, type Client } from '@libsql/client';
import { env } from './env';
import { SOVEREIGN_LAWS } from './sovereign_laws';

let _client: Client | null = null;

export function getClient(): Client {
  if (_client) return _client;
  _client = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });
  return _client;
}

// Alias for code that wants a const reference. Lazy under the hood.
export const db = new Proxy({} as Client, {
  get(_, prop: string | symbol) {
    const c = getClient() as unknown as Record<string | symbol, unknown>;
    return c[prop];
  },
}) as Client;

// ── Schema ────────────────────────────────────────────────────────────────────

export async function initSchema(): Promise<void> {
  const c = getClient();
  await c.batch([
    {
      sql: `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        c REAL NOT NULL DEFAULT 0.333,
        r REAL NOT NULL DEFAULT 0.333,
        s REAL NOT NULL DEFAULT 0.334,
        theta REAL DEFAULT 1.5,
        attack_pressure REAL DEFAULT 0.0,
        step_counter INTEGER DEFAULT 0,
        updated_at INTEGER NOT NULL
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        m_before REAL,
        m_after REAL,
        health TEXT,
        intervention INTEGER DEFAULT 0,
        reason TEXT,
        input_hash TEXT,
        governed_hash TEXT,
        health_band TEXT,
        c_before REAL,
        r_before REAL,
        s_before REAL,
        c_after REAL,
        r_after REAL,
        s_after REAL,
        metrics_version TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )`,
      args: [],
    },
    {
      sql: `CREATE TABLE IF NOT EXISTS run_stats (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      )`,
      args: [],
    },
    {
      sql: `INSERT OR IGNORE INTO run_stats (key, value) VALUES ('total_runs', 0)`,
      args: [],
    },
  ], 'write');

  // Backward-compatible migrations for older audit_log tables
  const safeAlter = async (sql: string) => {
    try { await c.execute({ sql, args: [] }); } catch { /* column may already exist */ }
  };
  await safeAlter('ALTER TABLE audit_log ADD COLUMN c_before REAL');
  await safeAlter('ALTER TABLE audit_log ADD COLUMN r_before REAL');
  await safeAlter('ALTER TABLE audit_log ADD COLUMN s_before REAL');
  await safeAlter('ALTER TABLE audit_log ADD COLUMN c_after REAL');
  await safeAlter('ALTER TABLE audit_log ADD COLUMN r_after REAL');
  await safeAlter('ALTER TABLE audit_log ADD COLUMN s_after REAL');
  await safeAlter('ALTER TABLE audit_log ADD COLUMN metrics_version TEXT');
}

// ── Session State ─────────────────────────────────────────────────────────────

export interface SessionState {
  C: number; R: number; S: number;
  theta?: number;
  attack_pressure?: number;
  step_counter?: number;
}

export async function getSession(sid: string): Promise<SessionState | null> {
  await initSchema();
  const r = await getClient().execute({ sql: 'SELECT * FROM sessions WHERE id = ?', args: [sid] });
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    C: row.c as number,
    R: row.r as number,
    S: row.s as number,
    theta: row.theta as number,
    attack_pressure: row.attack_pressure as number,
    step_counter: row.step_counter as number,
  };
}

export async function saveSession(sid: string, state: SessionState): Promise<void> {
  await initSchema();
  await getClient().execute({
    sql: `INSERT INTO sessions (id, c, r, s, theta, attack_pressure, step_counter, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            c=excluded.c, r=excluded.r, s=excluded.s,
            theta=excluded.theta, attack_pressure=excluded.attack_pressure,
            step_counter=excluded.step_counter, updated_at=excluded.updated_at`,
    args: [
      sid, state.C, state.R, state.S,
      state.theta ?? 1.5,
      state.attack_pressure ?? 0.0,
      state.step_counter ?? 0,
      Date.now(),
    ],
  });
}

export async function getLatestSessionState(): Promise<{ id: string; state: SessionState } | null> {
  await initSchema();
  const r = await getClient().execute({
    sql: `SELECT id, c, r, s, theta, attack_pressure, step_counter
          FROM sessions
          ORDER BY updated_at DESC
          LIMIT 1`,
    args: [],
  });
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  return {
    id: row.id as string,
    state: {
      C: row.c as number,
      R: row.r as number,
      S: row.s as number,
      theta: row.theta as number,
      attack_pressure: row.attack_pressure as number,
      step_counter: row.step_counter as number,
    },
  };
}

// Aggregate constitutional state across recent z_traj rows.
// Returns nulls when no rows exist — the UI must show "no data" rather than a fake centroid.
export async function getAggregateConstitutionalState():
  Promise<{ C: number | null; R: number | null; S: number | null; M: number | null }> {
  await initSchema();
  try {
    const r = await getClient().execute({
      sql: `SELECT AVG(last_c) as ac, AVG(last_r) as ar, AVG(last_s) as aas, AVG(last_m) as am
            FROM (SELECT last_c, last_r, last_s, last_m FROM z_traj ORDER BY updated_at DESC LIMIT 20)`,
      args: [],
    });
    if (r.rows.length > 0 && r.rows[0].ac !== null) {
      return {
        C: r.rows[0].ac as number,
        R: r.rows[0].ar as number,
        S: r.rows[0].aas as number,
        M: r.rows[0].am as number,
      };
    }
  } catch {
    // z_traj table may not exist yet (cold DB) — fall through to nulls
  }
  return { C: null, R: null, S: null, M: null };
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  session_id: string;
  timestamp: number;
  m_before: number;
  m_after: number;
  health: string;
  intervention: boolean;
  reason?: string;
  input_hash: string;
  governed_hash: string;
  health_band?: string;
  c_before?: number;
  r_before?: number;
  s_before?: number;
  c_after?: number;
  r_after?: number;
  s_after?: number;
  metrics_version?: string;
}

export async function saveAudit(entry: AuditEntry): Promise<void> {
  await initSchema();
  await getClient().execute({
    sql: `INSERT OR IGNORE INTO audit_log
          (id, session_id, timestamp, m_before, m_after, health, intervention, reason, input_hash, governed_hash, health_band,
           c_before, r_before, s_before, c_after, r_after, s_after, metrics_version)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      entry.id, entry.session_id, entry.timestamp,
      entry.m_before, entry.m_after, entry.health,
      entry.intervention ? 1 : 0, entry.reason ?? '',
      entry.input_hash, entry.governed_hash, entry.health_band ?? '',
      entry.c_before ?? null,
      entry.r_before ?? null,
      entry.s_before ?? null,
      entry.c_after ?? null,
      entry.r_after ?? null,
      entry.s_after ?? null,
      entry.metrics_version ?? 'aureonics-ts-v1',
    ],
  });
}

export async function getRecentAudits(limit = 20): Promise<AuditEntry[]> {
  await initSchema();
  const r = await getClient().execute({
    sql: 'SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?',
    args: [limit],
  });
  return r.rows.map(row => ({
    id: row.id as string,
    session_id: row.session_id as string,
    timestamp: row.timestamp as number,
    m_before: row.m_before as number,
    m_after: row.m_after as number,
    health: row.health as string,
    intervention: (row.intervention as number) === 1,
    reason: row.reason as string,
    input_hash: row.input_hash as string,
    governed_hash: row.governed_hash as string,
    health_band: row.health_band as string,
    c_before: row.c_before as number | undefined,
    r_before: row.r_before as number | undefined,
    s_before: row.s_before as number | undefined,
    c_after: row.c_after as number | undefined,
    r_after: row.r_after as number | undefined,
    s_after: row.s_after as number | undefined,
    metrics_version: row.metrics_version as string | undefined,
  }));
}

// ── Stats — atomic counter, persists across cold starts ──────────────────────

async function ensureRunStats(): Promise<void> {
  const c = getClient();
  await c.execute(`
    CREATE TABLE IF NOT EXISTS run_stats (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    )
  `);
  await c.execute(`INSERT OR IGNORE INTO run_stats (key, value) VALUES ('total_runs', 0)`);
}

export async function incrementRuns(): Promise<number> {
  await ensureRunStats();
  const r = await getClient().execute(`
    UPDATE run_stats SET value = value + 1 WHERE key = 'total_runs' RETURNING value
  `);
  return (r.rows[0]?.value as number) ?? 0;
}

export async function getTotalRuns(): Promise<number> {
  await ensureRunStats();
  const r = await getClient().execute(`SELECT value FROM run_stats WHERE key = 'total_runs'`);
  return (r.rows[0]?.value as number) ?? 0;
}

// ── Sovereign Laws ────────────────────────────────────────────

export async function seedSovereignLaws(): Promise<void> {
  const c = getClient();
  for (const law of SOVEREIGN_LAWS) {
    await c.execute({
      sql: `INSERT OR IGNORE INTO sovereign_laws
            (id, book, book_name, name, pillar, text, governor_use, invocation_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      args: [law.id, law.book, law.book_name, law.name, law.pillar, law.text, law.governor_use],
    });
  }
}

export async function getLawByPillarAndContext(
  pillar: string,
  healthBand: string
): Promise<{ id: number; name: string; text: string; governor_use: string; book_name: string } | null> {
  const severity = healthBand === 'CRITICAL' ? 10 : healthBand === 'STRESSED' ? 7 : 4;
  const result = await getClient().execute({
    sql: `SELECT id, name, text, governor_use, book_name FROM sovereign_laws
          WHERE pillar = ?
          ORDER BY (invocation_count + ?) % 15
          LIMIT 1`,
    args: [pillar, severity],
  });
  if (!result.rows.length) return null;
  const row = result.rows[0];
  return {
    id: Number(row.id),
    name: String(row.name),
    text: String(row.text),
    governor_use: String(row.governor_use),
    book_name: String(row.book_name),
  };
}

export async function logLawInvocation(params: {
  law_id: number;
  law_name: string;
  pillar: string;
  session_id: string;
  audit_id?: string;
  health_band?: string;
  trigger_reason?: string;
}): Promise<void> {
  const c = getClient();
  const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  await c.execute({
    sql: `INSERT INTO law_invocations
          (id, law_id, law_name, pillar, session_id, audit_id, health_band, trigger_reason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, params.law_id, params.law_name, params.pillar, params.session_id,
           params.audit_id || null, params.health_band || null, params.trigger_reason || null],
  });
  await c.execute({
    sql: `UPDATE sovereign_laws SET invocation_count = invocation_count + 1 WHERE id = ?`,
    args: [params.law_id],
  });
}

export async function getTopInvokedLaws(limit = 5): Promise<{ name: string; count: number; pillar: string }[]> {
  const result = await getClient().execute({
    sql: `SELECT name, pillar, invocation_count as count FROM sovereign_laws
          ORDER BY invocation_count DESC LIMIT ?`,
    args: [limit],
  });
  return result.rows.map(r => ({
    name: String(r.name),
    pillar: String(r.pillar),
    count: Number(r.count),
  }));
}

// ── Z-Traj Governor Migrations ────────────────────────────────────────────────

export async function runZTrajMigrations(): Promise<void> {
  const c = getClient();
  const safeExec = async (sql: string, args: (string | number | null)[] = []) => {
    try { await c.execute({ sql, args }); } catch { /* idempotent */ }
  };

  await safeExec(`CREATE TABLE IF NOT EXISTS z_traj (
    session_id    TEXT PRIMARY KEY,
    velocity      REAL    NOT NULL DEFAULT 0.0,
    n_stable      INTEGER NOT NULL DEFAULT 0,
    drift_dir     TEXT    NOT NULL DEFAULT 'none',
    sigma_viol    REAL    NOT NULL DEFAULT 0.0,
    last_m        REAL    NOT NULL DEFAULT 0.333,
    last_c        REAL    NOT NULL DEFAULT 0.333,
    last_r        REAL    NOT NULL DEFAULT 0.333,
    last_s        REAL    NOT NULL DEFAULT 0.333,
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);

  await safeExec(`CREATE TABLE IF NOT EXISTS law_impact (
    law_id        TEXT PRIMARY KEY,
    impact_c      REAL NOT NULL DEFAULT 0.0,
    impact_r      REAL NOT NULL DEFAULT 0.0,
    impact_s      REAL NOT NULL DEFAULT 0.0,
    magnitude     REAL NOT NULL DEFAULT 0.05,
    description   TEXT
  )`);

  await safeExec(`CREATE TABLE IF NOT EXISTS governor_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT    NOT NULL,
    turn          INTEGER NOT NULL DEFAULT 0,
    m_before      REAL,
    m_after       REAL,
    drift_dir     TEXT,
    sigma_viol    REAL,
    intervention  TEXT,
    law_fired     TEXT,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);

  await safeExec(`CREATE TABLE IF NOT EXISTS praxis_receipts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id      TEXT    NOT NULL UNIQUE,
    session_id      TEXT    NOT NULL,
    turn            INTEGER NOT NULL DEFAULT 0,
    pre_eval_label  TEXT    NOT NULL DEFAULT 'CLEAR',
    m_before        REAL    NOT NULL DEFAULT 0.333,
    m_after         REAL    NOT NULL DEFAULT 0.333,
    governor_mode   TEXT    NOT NULL DEFAULT 'suppress',
    intervention    INTEGER NOT NULL DEFAULT 0,
    slow_drip       INTEGER NOT NULL DEFAULT 0,
    governor_effort REAL    NOT NULL DEFAULT 0.0,
    sigma_viol      REAL    NOT NULL DEFAULT 0.0,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`);

  await safeExec(`CREATE INDEX IF NOT EXISTS idx_governor_log_session ON governor_log(session_id)`);
  await safeExec(`CREATE INDEX IF NOT EXISTS idx_receipts_session ON praxis_receipts(session_id)`);
  await safeExec(`CREATE INDEX IF NOT EXISTS idx_z_traj_updated ON z_traj(updated_at)`);

  await safeExec(`ALTER TABLE z_traj ADD COLUMN attack_pressure REAL NOT NULL DEFAULT 0.0`);
  await safeExec(`ALTER TABLE praxis_receipts ADD COLUMN crs_method TEXT`);

  const lawSeed = [
    ['bypass_attempt',   -0.02, -0.02, -0.15, 0.15, 'Direct sovereignty attack'],
    ['identity_reframe', -0.15, -0.02, -0.02, 0.15, 'Continuity identity attack'],
    ['sycophancy',       -0.02, -0.15, -0.02, 0.15, 'Reciprocity manipulation'],
    ['multi_attack',            -0.08, -0.08, -0.08, 0.20, 'Multi-pillar simultaneous attack'],
    ['slow_drip',               -0.03, -0.03, -0.03, 0.05, 'Low-level cumulative pressure'],
    ['attack_vector_disclosure', -0.08, -0.04, -0.08, 0.16, 'Guide on attacking constitutional governance system'],
  ];
  for (const [id, ic, ir, is_, mag, desc] of lawSeed) {
    await safeExec(
      `INSERT OR IGNORE INTO law_impact (law_id, impact_c, impact_r, impact_s, magnitude, description) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, ic, ir, is_, mag, desc]
    );
  }
}
