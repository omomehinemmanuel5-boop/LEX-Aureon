/**
 * Turso (libSQL) persistence layer for Lex Aureon
 * Free tier: 9GB storage · 500M reads/mo · Always on · 500 databases
 * Falls back to in-memory if TURSO_DATABASE_URL not configured
 */

import { createClient, type Client } from '@libsql/client';
import { SOVEREIGN_LAWS } from './sovereign_laws';

let _client: Client | null = null;

export function getClient(): Client | null {
  if (!process.env.TURSO_DATABASE_URL) return null;
  if (_client) return _client;
  _client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return _client;
}

// ── Schema ────────────────────────────────────────────────────────────────────

export async function initSchema(): Promise<void> {
  const db = getClient();
  if (!db) return;
  await db.batch([
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
      sql: `CREATE TABLE IF NOT EXISTS stats (
        key TEXT PRIMARY KEY,
        value INTEGER NOT NULL DEFAULT 0
      )`,
      args: [],
    },
    {
      sql: `INSERT OR IGNORE INTO stats (key, value) VALUES ('total_runs', 1247)`,
      args: [],
    },
  ], 'write');

  // Backward-compatible migrations for older audit_log tables
  const safeAlter = async (sql: string) => {
    try { await db.execute({ sql, args: [] }); } catch { /* column may already exist */ }
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

// In-memory fallback
const memSessions = new Map<string, SessionState>();
const memAudit: AuditEntry[] = [];
let memRuns = 1247;
let memLatestSessionId: string | null = null;

export async function getSession(sid: string): Promise<SessionState | null> {
  const db = getClient();
  if (db) {
    try {
      await initSchema();
      const r = await db.execute({ sql: 'SELECT * FROM sessions WHERE id = ?', args: [sid] });
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
    } catch (e) { console.error('Turso getSession:', e); }
  }
  return memSessions.get(sid) ?? null;
}

export async function saveSession(sid: string, state: SessionState): Promise<void> {
  const db = getClient();
  if (db) {
    try {
      await initSchema();
      await db.execute({
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
      return;
    } catch (e) { console.error('Turso saveSession:', e); }
  }
  memSessions.set(sid, state);
  memLatestSessionId = sid;
}

export async function getLatestSessionState(): Promise<{ id: string; state: SessionState } | null> {
  const db = getClient();
  if (db) {
    try {
      await initSchema();
      const r = await db.execute({
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
    } catch (e) {
      console.error('Turso getLatestSessionState:', e);
    }
  }

  if (!memLatestSessionId) return null;
  const state = memSessions.get(memLatestSessionId);
  if (!state) return null;
  return { id: memLatestSessionId, state };
}

// Aggregate constitutional state across recent active sessions — safe for public display.
// Returns average C/R/S/M across the last 20 z_traj rows so no individual session is exposed.
export async function getAggregateConstitutionalState(): Promise<{ C: number; R: number; S: number; M: number }> {
  const fallback = { C: 0.333, R: 0.333, S: 0.334, M: 0.333 };
  const db = getClient();
  if (db) {
    try {
      await initSchema();
      const r = await db.execute({
        sql: `SELECT AVG(last_c) as ac, AVG(last_r) as ar, AVG(last_s) as aas, AVG(last_m) as am
              FROM (SELECT last_c, last_r, last_s, last_m FROM z_traj ORDER BY updated_at DESC LIMIT 20)`,
        args: [],
      });
      if (r.rows.length > 0 && r.rows[0].ac !== null) {
        const C = r.rows[0].ac as number;
        const R = r.rows[0].ar as number;
        const S = r.rows[0].aas as number;
        const M = r.rows[0].am as number;
        return { C, R, S, M };
      }
    } catch { /* fall through */ }
  }
  // In-memory fallback: average across all in-memory sessions
  if (memSessions.size > 0) {
    let sumC = 0, sumR = 0, sumS = 0, count = 0;
    for (const s of memSessions.values()) {
      sumC += s.C; sumR += s.R; sumS += s.S; count++;
    }
    const C = sumC / count, R = sumR / count, S = sumS / count;
    return { C, R, S, M: Math.min(C, R, S) };
  }
  return fallback;
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
  const db = getClient();
  if (db) {
    try {
      await initSchema();
      await db.execute({
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
      return;
    } catch (e) { console.error('Turso saveAudit:', e); }
  }
  memAudit.unshift(entry);
  if (memAudit.length > 200) memAudit.splice(200);
}

export async function getRecentAudits(limit = 20): Promise<AuditEntry[]> {
  const db = getClient();
  if (db) {
    try {
      await initSchema();
      const r = await db.execute({
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
    } catch (e) { console.error('Turso getRecentAudits:', e); }
  }
  return memAudit.slice(0, limit);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function incrementRuns(): Promise<number> {
  const db = getClient();
  if (db) {
    try {
      await initSchema();
      await db.execute({
        sql: `INSERT INTO stats (key, value) VALUES ('total_runs', 1248)
              ON CONFLICT(key) DO UPDATE SET value = value + 1`,
        args: [],
      });
      const r = await db.execute({ sql: "SELECT value FROM stats WHERE key = 'total_runs'", args: [] });
      return (r.rows[0]?.value as number) ?? 1247;
    } catch (e) { console.error('Turso incrementRuns:', e); }
  }
  return ++memRuns;
}

export async function getTotalRuns(): Promise<number> {
  const db = getClient();
  if (db) {
    try {
      await initSchema();
      const r = await db.execute({ sql: "SELECT value FROM stats WHERE key = 'total_runs'", args: [] });
      return (r.rows[0]?.value as number) ?? 1247;
    } catch (e) { console.error('Turso getTotalRuns:', e); }
  }
  return memRuns;
}

// ── Sovereign Laws ────────────────────────────────────────────

export async function seedSovereignLaws(): Promise<void> {
  const db = getClient();
  if (!db) return;
  // SOVEREIGN_LAWS imported at top
  for (const law of SOVEREIGN_LAWS) {
    await db.execute({
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
  const db = getClient();
  if (!db) return null;
  // Pick law based on pillar + health severity
  const severity = healthBand === 'CRITICAL' ? 10 : healthBand === 'STRESSED' ? 7 : 4;
  const result = await db.execute({
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
  const db = getClient();
  if (!db) return;
  const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  await db.execute({
    sql: `INSERT INTO law_invocations 
          (id, law_id, law_name, pillar, session_id, audit_id, health_band, trigger_reason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, params.law_id, params.law_name, params.pillar, params.session_id,
           params.audit_id || null, params.health_band || null, params.trigger_reason || null],
  });
  // Increment invocation count on the law
  await db.execute({
    sql: `UPDATE sovereign_laws SET invocation_count = invocation_count + 1 WHERE id = ?`,
    args: [params.law_id],
  });
}

export async function getTopInvokedLaws(limit = 5): Promise<{ name: string; count: number; pillar: string }[]> {
  const db = getClient();
  if (!db) return [];
  const result = await db.execute({
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
  const db = getClient();
  if (!db) return;

  const safeExec = async (sql: string, args: (string | number | null)[] = []) => {
    try { await db.execute({ sql, args }); } catch { /* idempotent */ }
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

  // Additive migrations — safe to re-run, safeExec swallows "column already exists"
  await safeExec(`ALTER TABLE z_traj ADD COLUMN attack_pressure REAL NOT NULL DEFAULT 0.0`);
  await safeExec(`ALTER TABLE praxis_receipts ADD COLUMN crs_method TEXT`);

  const lawSeed = [
    ['bypass_attempt',   -0.02, -0.02, -0.15, 0.15, 'Direct sovereignty attack'],
    ['identity_reframe', -0.15, -0.02, -0.02, 0.15, 'Continuity identity attack'],
    ['sycophancy',       -0.02, -0.15, -0.02, 0.15, 'Reciprocity manipulation'],
    ['multi_attack',     -0.08, -0.08, -0.08, 0.20, 'Multi-pillar simultaneous attack'],
    ['slow_drip',        -0.03, -0.03, -0.03, 0.05, 'Low-level cumulative pressure'],
  ];
  for (const [id, ic, ir, is_, mag, desc] of lawSeed) {
    await safeExec(
      `INSERT OR IGNORE INTO law_impact (law_id, impact_c, impact_r, impact_s, magnitude, description) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, ic, ir, is_, mag, desc]
    );
  }
}
