/**
 * Constitutional state and z_traj persistence — all on Turso.
 * No @vercel/kv. No in-memory fallback. No silent failures.
 *
 * Named "kv" for historical reasons; the storage backend is libSQL/Turso.
 */

import { getClient } from './db';
import { projectCRSToConstitutionalSimplex } from './constitution';
import { RECOVERY_STABILITY_THRESHOLD } from './agents/recovery_state';
import { nextSigmaViolation } from './agents/sigma_decay';
import { markAccountQuarantined } from './agents/account_quarantine';

interface KvCRSState {
  C: number; R: number; S: number;
  theta?: number;
  attack_pressure?: number;
  step_counter?: number;
  timestamp?: number;
}

interface AuditEntry {
  audit_id: string;
  timestamp: number;
  session_id: string;
  m_before: number;
  m_after: number;
  health: string;
  intervention: boolean;
  reason?: string;
  input_hash: string;
  governed_output_hash: string;
}

// ── Schema for session_state / audit_global on Turso ──────────────────────────

async function ensureKvSchema(): Promise<void> {
  const c = getClient();
  await c.execute(`
    CREATE TABLE IF NOT EXISTS session_state (
      session_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await c.execute(`
    CREATE TABLE IF NOT EXISTS audit_global (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      audit_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  await c.execute(`CREATE INDEX IF NOT EXISTS idx_audit_global_session ON audit_global(session_id, created_at DESC)`);
}

export async function getSessionState(sid: string): Promise<KvCRSState | null> {
  await ensureKvSchema();
  const r = await getClient().execute({
    sql: 'SELECT state_json FROM session_state WHERE session_id = ?',
    args: [sid],
  });
  if (!r.rows.length) return null;
  try { return JSON.parse(r.rows[0].state_json as string); } catch { return null; }
}

export async function saveSessionState(sid: string, state: KvCRSState): Promise<void> {
  await ensureKvSchema();
  const payload = JSON.stringify({ ...state, timestamp: Date.now() });
  await getClient().execute({
    sql: `INSERT INTO session_state (session_id, state_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`,
    args: [sid, payload, Date.now()],
  });
}

export async function saveAuditEntry(entry: AuditEntry): Promise<void> {
  await ensureKvSchema();
  await getClient().execute({
    sql: `INSERT INTO audit_global (session_id, audit_id, payload, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [entry.session_id, entry.audit_id, JSON.stringify(entry), Date.now()],
  });
}

export async function getRecentAudits(limit = 20): Promise<AuditEntry[]> {
  await ensureKvSchema();
  const r = await getClient().execute({
    sql: `SELECT payload FROM audit_global ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows
    .map(row => { try { return JSON.parse(row.payload as string); } catch { return null; } })
    .filter(Boolean) as AuditEntry[];
}

export async function getSessionHistory(sid: string, limit = 10): Promise<AuditEntry[]> {
  await ensureKvSchema();
  const r = await getClient().execute({
    sql: `SELECT payload FROM audit_global WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
    args: [sid, limit],
  });
  return r.rows
    .map(row => { try { return JSON.parse(row.payload as string); } catch { return null; } })
    .filter(Boolean) as AuditEntry[];
}

// ── Z-Traj Governor Constants ─────────────────────────────────────────────────
// Re-exported from constitution.ts for backwards compatibility with existing imports.

import { CONSTITUTION } from './constitution';

export const TAU_FLOOR       = CONSTITUTION.TAU_FLOOR;     // CBF floor (0.05)
export const TAU_RECOVERY    = CONSTITUTION.TAU_RECOVERY;  // suppress mode floor (0.15)
export const TAU_LYP         = CONSTITUTION.TAU_LYAPUNOV;  // Lyapunov penalty threshold (0.08)
export const N_MIN           = CONSTITUTION.N_MIN;
export const RECOVERY_RATE   = CONSTITUTION.RECOVERY_RATE;
export const SIGMA_WINDOW    = 10;
export const SIGMA_THRESHOLD = CONSTITUTION.SIGMA_THRESHOLD;
export const STABILITY_VELOCITY = RECOVERY_STABILITY_THRESHOLD;
/** Minimum server-side dwell between canonical stability samples. */
export const MIN_CANONICAL_STABILITY_OBSERVATION_INTERVAL_MS = 5_000;

// ── Z-weight update constants (Theorem 3a/3b — Banach fixed-point proof) ──────
// ρ = memory decay rate (contraction factor, proven convergent at 0.85)
// γ = attack impact scale (law event severity scaling)
// Z_CLAMP_LO / HI = saturation guard bounds = [τ/2, 1−τ]
// Without the clamp, z can be driven to boundary under indefinite multi_attack.
const Z_RHO      = 0.85;
const Z_GAMMA    = 0.10;
const Z_CLAMP_LO = TAU_FLOOR / 2;        // 0.025
const Z_CLAMP_HI = 1 - TAU_FLOOR;        // 0.95

// ── Law event attack signal table (Aureonics Three Open Problems, §4.2) ────────
// Each law maps to: severity scalar and direction vector [dc, dr, ds]
// Direction vectors sum to zero (mass-conserving attack signal).
const LAW_ATTACK_SIGNAL: Record<string, { sev: number; dir: [number, number, number] }> = {
  bypass_attempt:           { sev: 0.8, dir: [ 0.5,  0.5, -1.0] },
  identity_reframe:         { sev: 0.7, dir: [-1.0,  0.5,  0.5] },
  sycophancy:               { sev: 0.6, dir: [ 0.5, -1.0,  0.5] },
  multi_attack:             { sev: 1.0, dir: [-1/3, -1/3, -1/3] },
  slow_drip:                { sev: 0.3, dir: [-1/3, -1/3, -1/3] },
  attack_vector_disclosure: { sev: 0.9, dir: [-0.5, -0.0, -0.5] },
};

// ── Health Band ──────────────────────────────────────────────────────────────
// Critical begins below the constitutional floor (0.05); TAU_LYP (0.08) remains
// the separate Lyapunov penalty threshold used by stress accounting.
export function deriveHealthBand(m: number): string {
  if (m >= CONSTITUTION.OPTIMAL_M_THRESHOLD) return 'OPTIMAL';
  if (m >= TAU_RECOVERY)  return 'ALERT';
  if (m >= TAU_FLOOR)     return 'STRESSED';
  return 'CRITICAL';
}

// ── Z-Traj Governor Types ─────────────────────────────────────────────────────

export interface CRS {
  c: number;
  r: number;
  s: number;
}

export interface ZTraj {
  session_id:      string;
  velocity:        number;
  n_stable:        number;
  drift_dir:       string;
  sigma_viol:      number;
  last_m:          number;
  last_c:          number;
  last_r:          number;
  last_s:          number;
  // Proven z-weight coordinates (Theorem 3a/3b).
  // z_c + z_r + z_s = 1 (simplex). Used as coordinate weights in V_z(x).
  // Higher z_i ⟹ stronger log-barrier on pillar i ⟹ more governor correction effort.
  z_c:             number;
  z_r:             number;
  z_s:             number;
  attack_pressure: number;
  updated_at:      string;
}

export interface LawImpact {
  law_id:      string;
  impact_c:    number;
  impact_r:    number;
  impact_s:    number;
  magnitude:   number;
  description: string | undefined;
}

export type GovernorMode = 'suppress' | 'nudge' | 'correction' | 'recovery';

// ── Simplex helpers ───────────────────────────────────────────────────────────
const projectToSimplex = projectCRSToConstitutionalSimplex;

// ── computeAttackSignal ───────────────────────────────────────────────────────
// A(t) = γ · Σ_{law ∈ events_t} sev(law) · dir(law)
// Returns the net [ac, ar, as] attack vector for this turn's law events.
function computeAttackSignal(lawEvents: string[]): [number, number, number] {
  let ac = 0, ar = 0, as_ = 0;
  for (const law of lawEvents) {
    const entry = LAW_ATTACK_SIGNAL[law];
    if (!entry) continue;
    ac  += Z_GAMMA * entry.sev * entry.dir[0];
    ar  += Z_GAMMA * entry.sev * entry.dir[1];
    as_ += Z_GAMMA * entry.sev * entry.dir[2];
  }
  // Keep every aggregate attack signal mass-conserving even when a newly
  // added law vector is not perfectly zero-sum. Centering preserves relative
  // pillar pressure while preventing the attack channel from changing total
  // simplex mass.
  const mean = (ac + ar + as_) / 3;
  return [ac - mean, ar - mean, as_ - mean];
}

// ── computeZWeights ───────────────────────────────────────────────────────────
// Implements the proven update rule (Aureonics Three Open Problems, §4.3):
//   z_raw = ρ·z_t + (1−ρ)·x_t − A(t)
//   z_{t+1} = normalize(clamp(z_raw, τ/2, 1−τ))
//
// Theorem 3a (Boundedness): clamp guarantees z_t ∈ Σ for all t.
// Theorem 3b (Convergence): contraction rate ρ=0.85 → unique fixed point z*.
// Saturation guard: without clamp, indefinite multi_attack drives z to boundary.
function computeZWeights(
  prevZ: { z_c: number; z_r: number; z_s: number } | null,
  crs: CRS,
  attackSignal: [number, number, number],
): { z_c: number; z_r: number; z_s: number } {
  // Initialise z at uniform 1/3 if no prior state (new session).
  const pz_c = prevZ?.z_c ?? (1/3);
  const pz_r = prevZ?.z_r ?? (1/3);
  const pz_s = prevZ?.z_s ?? (1/3);

  const [ac, ar, as_] = attackSignal;

  // z_raw = ρ·z_t + (1−ρ)·x_t − A(t)
  const raw_c = Z_RHO * pz_c + (1 - Z_RHO) * crs.c - ac;
  const raw_r = Z_RHO * pz_r + (1 - Z_RHO) * crs.r - ar;
  const raw_s = Z_RHO * pz_s + (1 - Z_RHO) * crs.s - as_;

  // Saturation clamp: clamp(z_raw, τ/2, 1−τ) — mandatory per §4.3
  const clamp_c = Math.max(Z_CLAMP_LO, Math.min(Z_CLAMP_HI, raw_c));
  const clamp_r = Math.max(Z_CLAMP_LO, Math.min(Z_CLAMP_HI, raw_r));
  const clamp_s = Math.max(Z_CLAMP_LO, Math.min(Z_CLAMP_HI, raw_s));

  // normalize → z_{t+1} ∈ Σ
  const total = clamp_c + clamp_r + clamp_s;
  return {
    z_c: clamp_c / total,
    z_r: clamp_r / total,
    z_s: clamp_s / total,
  };
}

// ── Z-Traj Functions ──────────────────────────────────────────────────────────

export async function getZTraj(sessionId: string): Promise<ZTraj | null> {
  const res = await getClient().execute({
    sql: 'SELECT * FROM z_traj WHERE session_id = ?',
    args: [sessionId],
  });
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    session_id:      row.session_id      as string,
    velocity:        row.velocity        as number,
    n_stable:        row.n_stable        as number,
    drift_dir:       row.drift_dir       as string,
    sigma_viol:      row.sigma_viol      as number,
    last_m:          row.last_m          as number,
    last_c:          row.last_c          as number,
    last_r:          row.last_r          as number,
    last_s:          row.last_s          as number,
    z_c:             typeof row.z_c === 'number' ? row.z_c : 1/3,
    z_r:             typeof row.z_r === 'number' ? row.z_r : 1/3,
    z_s:             typeof row.z_s === 'number' ? row.z_s : 1/3,
    attack_pressure: typeof row.attack_pressure === 'number' ? row.attack_pressure : 0,
    updated_at:      row.updated_at      as string,
  };
}

export type ExpectedZTrajSample = Pick<ZTraj, 'last_c' | 'last_r' | 'last_s' | 'sigma_viol' | 'updated_at'>;

/**
 * Record one already-executed governed-tool observation only if the trajectory
 * is still the exact sample read before execution. Unlike updateZTraj(), this
 * path never creates a missing row and never overwrites a newer observation.
 */
export async function recordZTrajObservation(
  sessionId: string,
  expectedPrevious: ExpectedZTrajSample | null,
  measured: CRS,
  countStableObservation = true,
): Promise<boolean> {
  if (!expectedPrevious) return false;
  if (![measured.c, measured.r, measured.s].every(Number.isFinite)) return false;

  const velocity = Math.sqrt(
    (measured.c - expectedPrevious.last_c) ** 2
    + (measured.r - expectedPrevious.last_r) ** 2
    + (measured.s - expectedPrevious.last_s) ** 2,
  );
  const M = Math.min(measured.c, measured.r, measured.s);
  const currentViolation = M < TAU_LYP ? TAU_LYP - M : 0;
  const sigmaViol = nextSigmaViolation(expectedPrevious.sigma_viol, currentViolation, SIGMA_WINDOW);

  const result = await getClient().execute({
    sql: `UPDATE z_traj
          SET sigma_viol = ?,
              velocity = ?,
              n_stable = CASE
                WHEN ? = 0 THEN 0
                WHEN ? >= ? OR ? < ? THEN 0
                WHEN (julianday('now') - julianday(updated_at)) * 86400000 >= ? THEN n_stable + 1
                ELSE n_stable
              END,
              last_m = ?, last_c = ?, last_r = ?, last_s = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ',
                MAX(julianday('now'), julianday(updated_at) + 1.0 / 86400000.0))
          WHERE session_id = ? AND last_c = ? AND last_r = ? AND last_s = ? AND updated_at = ? AND sigma_viol = ?`,
    args: [
      sigmaViol,
      velocity,
      countStableObservation ? 1 : 0,
      velocity, STABILITY_VELOCITY, M, CONSTITUTION.TAU_RECOVERY,
      MIN_CANONICAL_STABILITY_OBSERVATION_INTERVAL_MS,
      M, measured.c, measured.r, measured.s,
      sessionId,
      expectedPrevious.last_c, expectedPrevious.last_r, expectedPrevious.last_s,
      expectedPrevious.updated_at, expectedPrevious.sigma_viol,
    ],
  });

  return Number(result.rowsAffected ?? 0) > 0;
}

// Each kernel turn carries a stable event key so a retried receipt cannot
// apply the same trajectory transition twice.
let zTrajObservationEventsReady: Promise<void> | null = null;

async function ensureZTrajObservationEventsSchema(): Promise<void> {
  if (!zTrajObservationEventsReady) {
    zTrajObservationEventsReady = getClient().execute({
      sql: `CREATE TABLE IF NOT EXISTS z_traj_observation_events (
        session_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (session_id, event_id)
      )`,
      args: [],
    }).then(() => undefined).catch((error: unknown) => {
      zTrajObservationEventsReady = null;
      throw error;
    });
  }
  await zTrajObservationEventsReady;
}

// updateZTraj — applies the proven z-weight rule under one serialized write
// transaction. The event key is mandatory and unique per logical kernel turn.
export async function updateZTraj(
  sessionId: string,
  crs: CRS,
  prevCRS: CRS | null,
  attackPressure: number | undefined,
  lawEvents: string[],
  observationId: string,
): Promise<ZTraj> {
  if (!observationId.trim()) throw new Error('A stable z_traj observation ID is required.');
  if (![crs.c, crs.r, crs.s].every(Number.isFinite)) {
    throw new Error('Cannot persist a non-finite CRS observation.');
  }

  const client = getClient();
  if (typeof client.transaction !== 'function') {
    throw new Error('Atomic z_traj writes require a libSQL write transaction.');
  }
  await ensureZTrajObservationEventsSchema();

  const tx = await client.transaction('write');
  try {
    const selected = await tx.execute({
      sql: 'SELECT * FROM z_traj WHERE session_id = ?',
      args: [sessionId],
    });
    const row = selected.rows[0] as Record<string, unknown> | undefined;
    const existing: ZTraj | null = row ? {
      session_id: String(row.session_id),
      velocity: Number(row.velocity),
      n_stable: Number(row.n_stable),
      drift_dir: String(row.drift_dir),
      sigma_viol: Number(row.sigma_viol),
      last_m: Number(row.last_m),
      last_c: Number(row.last_c),
      last_r: Number(row.last_r),
      last_s: Number(row.last_s),
      z_c: typeof row.z_c === 'number' ? row.z_c : 1 / 3,
      z_r: typeof row.z_r === 'number' ? row.z_r : 1 / 3,
      z_s: typeof row.z_s === 'number' ? row.z_s : 1 / 3,
      attack_pressure: typeof row.attack_pressure === 'number' ? row.attack_pressure : 0,
      updated_at: String(row.updated_at),
    } : null;

    const event = await tx.execute({
      sql: 'INSERT OR IGNORE INTO z_traj_observation_events (session_id, event_id) VALUES (?, ?)',
      args: [sessionId, observationId],
    });
    if (Number(event.rowsAffected ?? 0) !== 1) {
      await tx.rollback();
      const latest = await getZTraj(sessionId);
      if (!latest) throw new Error('Duplicate z_traj event exists without its trajectory row.');
      return latest;
    }

    const clock = await tx.execute({
      sql: `SELECT
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS now_utc,
        CASE WHEN ? IS NULL THEN NULL
          ELSE (julianday('now') - julianday(?)) * 86400000 END AS elapsed_ms,
        CASE WHEN ? IS NULL THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          ELSE strftime('%Y-%m-%dT%H:%M:%fZ',
            MAX(julianday('now'), julianday(?) + 1.0 / 86400000.0)) END AS updated_at`,
      args: [
        existing?.updated_at ?? null, existing?.updated_at ?? null,
        existing?.updated_at ?? null, existing?.updated_at ?? null,
      ],
    });
    const clockRow = clock.rows[0] as Record<string, unknown> | undefined;
    const updatedAt = String(clockRow?.updated_at ?? clockRow?.now_utc ?? '');
    if (!updatedAt) throw new Error('Database clock did not return a trajectory timestamp.');

    // Always compare against the latest persisted CRS inside the write
    // transaction. A caller's pre-transaction snapshot may already be stale.
    const baseline = existing
      ? { c: existing.last_c, r: existing.last_r, s: existing.last_s }
      : prevCRS;
    const velocity = baseline
      ? Math.sqrt((crs.c - baseline.c) ** 2 + (crs.r - baseline.r) ** 2 + (crs.s - baseline.s) ** 2)
      : 0;
    const M = Math.min(crs.c, crs.r, crs.s);
    const elapsedMs = Number(clockRow?.elapsed_ms);
    const dwellElapsed = existing !== null && Number.isFinite(elapsedMs)
      && elapsedMs >= MIN_CANONICAL_STABILITY_OBSERVATION_INTERVAL_MS;
    const n_stable = velocity >= STABILITY_VELOCITY || M < CONSTITUTION.TAU_RECOVERY
      ? 0
      : dwellElapsed ? existing!.n_stable + 1 : (existing?.n_stable ?? 0);

    let drift_dir = 'none';
    if (baseline) {
      const dc = crs.c - baseline.c;
      const dr = crs.r - baseline.r;
      const ds = crs.s - baseline.s;
      const adC = Math.abs(dc), adR = Math.abs(dr), adS = Math.abs(ds);
      if (adC > adR && adC > adS && adC > 0.005) {
        drift_dir = dc < 0 ? 'away_C' : 'toward_C';
      } else if (adR > adS && adR > 0.005) {
        drift_dir = dr < 0 ? 'away_R' : 'toward_R';
      } else if (adS > 0.005) {
        drift_dir = ds < 0 ? 'away_S' : 'toward_S';
      }
    }

    const viol = M < TAU_LYP ? TAU_LYP - M : 0;
    const sigma_viol = nextSigmaViolation(existing?.sigma_viol ?? 0, viol, SIGMA_WINDOW);
    const attack_pressure = attackPressure !== undefined
      ? Math.min(1, Math.max(0, attackPressure))
      : (existing?.attack_pressure ?? 0);
    const attackSignal = computeAttackSignal(lawEvents);
    const { z_c, z_r, z_s } = computeZWeights(
      existing ? { z_c: existing.z_c, z_r: existing.z_r, z_s: existing.z_s } : null,
      crs,
      attackSignal,
    );
    const zMax = Math.max(z_c, z_r, z_s);
    let z_drift = 'stable';
    if (zMax > 0.45) {
      z_drift = z_c === zMax ? 'protecting_C' : z_r === zMax ? 'protecting_R' : 'protecting_S';
    }

    const z: ZTraj = {
      session_id: sessionId,
      velocity,
      n_stable,
      drift_dir: drift_dir !== 'none' ? drift_dir : z_drift,
      sigma_viol,
      last_m: M,
      last_c: crs.c,
      last_r: crs.r,
      last_s: crs.s,
      z_c, z_r, z_s,
      attack_pressure,
      updated_at: updatedAt,
    };

    if (existing) {
      const updated = await tx.execute({
        sql: `UPDATE z_traj SET
          velocity = ?, n_stable = ?, drift_dir = ?, sigma_viol = ?,
          last_m = ?, last_c = ?, last_r = ?, last_s = ?,
          z_c = ?, z_r = ?, z_s = ?, attack_pressure = ?, updated_at = ?
          WHERE session_id = ? AND updated_at = ?`,
        args: [
          z.velocity, z.n_stable, z.drift_dir, z.sigma_viol,
          z.last_m, z.last_c, z.last_r, z.last_s,
          z.z_c, z.z_r, z.z_s, z.attack_pressure, z.updated_at,
          sessionId, existing.updated_at,
        ],
      });
      if (Number(updated.rowsAffected ?? 0) !== 1) {
        throw new Error('Concurrent z_traj snapshot conflict; transition was not applied.');
      }
    } else {
      await tx.execute({
        sql: `INSERT INTO z_traj
          (session_id, velocity, n_stable, drift_dir, sigma_viol,
           last_m, last_c, last_r, last_s, z_c, z_r, z_s, attack_pressure, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          sessionId, z.velocity, z.n_stable, z.drift_dir, z.sigma_viol,
          z.last_m, z.last_c, z.last_r, z.last_s,
          z.z_c, z.z_r, z.z_s, z.attack_pressure, z.updated_at,
        ],
      });
    }

    await tx.commit();
    if (z.last_m < CONSTITUTION.TAU_FLOOR) {
      await markAccountQuarantined(sessionId);
    }
    return z;
  } catch (error: unknown) {
    await tx.rollback().catch(() => undefined);
    if (error instanceof Error && error.message.toLowerCase().includes('no column')) {
      const db = getClient();
      await db.execute('ALTER TABLE z_traj ADD COLUMN z_c REAL NOT NULL DEFAULT 0.333').catch(() => undefined);
      await db.execute('ALTER TABLE z_traj ADD COLUMN z_r REAL NOT NULL DEFAULT 0.333').catch(() => undefined);
      await db.execute('ALTER TABLE z_traj ADD COLUMN z_s REAL NOT NULL DEFAULT 0.333').catch(() => undefined);
      return updateZTraj(sessionId, crs, prevCRS, attackPressure, lawEvents, observationId);
    }
    throw error;
  }
}

export async function updateZTraj(
  sessionId: string,
  crs: CRS,
  prevCRS: CRS | null,
  attackPressure?: number,
  lawEvents: string[] = [],
): Promise<ZTraj> {
  const M = Math.min(crs.c, crs.r, crs.s);
  const existing = await getZTraj(sessionId);

  // ── Velocity: L2 distance from previous CRS ───────────────────────────────
  const velocity = prevCRS
    ? Math.sqrt((crs.c - prevCRS.c) ** 2 + (crs.r - prevCRS.r) ** 2 + (crs.s - prevCRS.s) ** 2)
    : 0;

  // ── n_stable: consecutive low-velocity turns ──────────────────────────────
  const previousUpdatedAt = existing ? Date.parse(existing.updated_at) : Number.NaN;
  const dwellElapsed = Number.isFinite(previousUpdatedAt)
    && Date.now() - previousUpdatedAt >= MIN_CANONICAL_STABILITY_OBSERVATION_INTERVAL_MS;
  const n_stable = velocity >= STABILITY_VELOCITY || M < CONSTITUTION.TAU_RECOVERY
    ? 0
    : dwellElapsed
      ? (existing?.n_stable ?? 0) + 1
      : (existing?.n_stable ?? 0);

  // ── drift_dir: dominant dimension of change ───────────────────────────────
  let drift_dir = 'none';
  if (prevCRS) {
    const dc = crs.c - prevCRS.c;
    const dr = crs.r - prevCRS.r;
    const ds = crs.s - prevCRS.s;
    const adC = Math.abs(dc), adR = Math.abs(dr), adS = Math.abs(ds);
    if (adC > adR && adC > adS && adC > 0.005) {
      drift_dir = dc < 0 ? 'away_C' : 'toward_C';
    } else if (adR > adS && adR > 0.005) {
      drift_dir = dr < 0 ? 'away_R' : 'toward_R';
    } else if (adS > 0.005) {
      drift_dir = ds < 0 ? 'away_S' : 'toward_S';
    }
  }

  // ── sigma_viol: rolling exponential average of constitutional stress ───────
  // Accumulates when M < TAU_LYP (0.08) — detects slow-drip DURING drift.
  const viol = M < TAU_LYP ? (TAU_LYP - M) : 0;
  const prevSigma = existing?.sigma_viol ?? 0;
  const sigma_viol = nextSigmaViolation(prevSigma, viol, SIGMA_WINDOW);

  // ── attack_pressure: scalar summary for receipt/logging ───────────────────
  const attack_pressure = attackPressure !== undefined
    ? Math.min(1, Math.max(0, attackPressure))
    : (existing?.attack_pressure ?? 0);

  // ── Proven z-weight update (Theorem 3a/3b) ────────────────────────────────
  // A(t) = γ · Σ_law sev(law)·dir(law)
  // z_{t+1} = normalize(clamp(ρ·z_t + (1−ρ)·x_t − A(t), τ/2, 1−τ))
  const attackSignal = computeAttackSignal(lawEvents);
  const { z_c, z_r, z_s } = computeZWeights(
    existing ? { z_c: existing.z_c, z_r: existing.z_r, z_s: existing.z_s } : null,
    crs,
    attackSignal,
  );

  // ── drift_dir refinement: also check z-trajectory drift ──────────────────
  // If z-weights show a dominant pillar under attack, record that.
  const zMax = Math.max(z_c, z_r, z_s);
  let z_drift = 'stable';
  if (zMax > 0.45) {
    z_drift = z_c === zMax ? 'protecting_C' : z_r === zMax ? 'protecting_R' : 'protecting_S';
  }
  const effective_drift = drift_dir !== 'none' ? drift_dir : z_drift;

  const z: ZTraj = {
    session_id:      sessionId,
    velocity,
    n_stable,
    drift_dir:       effective_drift,
    sigma_viol,
    last_m:          M,
    last_c:          crs.c,
    last_r:          crs.r,
    last_s:          crs.s,
    z_c,
    z_r,
    z_s,
    attack_pressure,
    updated_at:      new Date().toISOString(),
  };

  // Persist — ADD z_c/z_r/z_s columns if not yet present (migration-safe via ALTER).
  // The INSERT uses ON CONFLICT to upsert; new columns are added lazily.
  try {
    await getClient().execute({
      sql: `INSERT INTO z_traj
              (session_id, velocity, n_stable, drift_dir, sigma_viol,
               last_m, last_c, last_r, last_s,
               z_c, z_r, z_s,
               attack_pressure, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              velocity=excluded.velocity, n_stable=excluded.n_stable,
              drift_dir=excluded.drift_dir, sigma_viol=excluded.sigma_viol,
              last_m=excluded.last_m, last_c=excluded.last_c,
              last_r=excluded.last_r, last_s=excluded.last_s,
              z_c=excluded.z_c, z_r=excluded.z_r, z_s=excluded.z_s,
              attack_pressure=excluded.attack_pressure,
              updated_at=excluded.updated_at`,
      args: [
        sessionId, z.velocity, z.n_stable, z.drift_dir, z.sigma_viol,
        z.last_m, z.last_c, z.last_r, z.last_s,
        z.z_c, z.z_r, z.z_s,
        z.attack_pressure, z.updated_at,
      ],
    });
    if (z.last_m < CONSTITUTION.TAU_FLOOR) {
      await markAccountQuarantined(sessionId);
    }
  } catch (e: unknown) {
    // If z_c/z_r/z_s columns don't exist yet, add them then retry.
    if (e instanceof Error && e.message.includes('no column')) {
      const db = getClient();
      await db.execute('ALTER TABLE z_traj ADD COLUMN z_c REAL NOT NULL DEFAULT 0.333').catch(() => {});
      await db.execute('ALTER TABLE z_traj ADD COLUMN z_r REAL NOT NULL DEFAULT 0.333').catch(() => {});
      await db.execute('ALTER TABLE z_traj ADD COLUMN z_s REAL NOT NULL DEFAULT 0.333').catch(() => {});
      // Retry insert after migration
      await getClient().execute({
        sql: `INSERT INTO z_traj
                (session_id, velocity, n_stable, drift_dir, sigma_viol,
                 last_m, last_c, last_r, last_s,
                 z_c, z_r, z_s,
                 attack_pressure, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(session_id) DO UPDATE SET
                velocity=excluded.velocity, n_stable=excluded.n_stable,
                drift_dir=excluded.drift_dir, sigma_viol=excluded.sigma_viol,
                last_m=excluded.last_m, last_c=excluded.last_c,
                last_r=excluded.last_r, last_s=excluded.last_s,
                z_c=excluded.z_c, z_r=excluded.z_r, z_s=excluded.z_s,
                attack_pressure=excluded.attack_pressure,
                updated_at=excluded.updated_at`,
        args: [
          sessionId, z.velocity, z.n_stable, z.drift_dir, z.sigma_viol,
          z.last_m, z.last_c, z.last_r, z.last_s,
          z.z_c, z.z_r, z.z_s,
          z.attack_pressure, z.updated_at,
        ],
      });
    } else {
      throw e;
    }
  }

  return z;
}

// ── Session turn counter ──────────────────────────────────────────────────────

export async function getSessionTurn(sessionId: string): Promise<number> {
  try {
    const r = await getClient().execute({
      sql: 'SELECT COUNT(*) as cnt FROM praxis_receipts WHERE session_id = ?',
      args: [sessionId],
    });
    return Number(r.rows[0]?.cnt ?? 0);
  } catch {
    return 0;
  }
}

export async function resetZTraj(sessionId: string): Promise<void> {
  try {
    // Preserve an explicit quarantine record instead of deleting state and
    // allowing the next bootstrap to look healthy by default.
    await getClient().execute({
      sql: `UPDATE z_traj SET velocity = 0, n_stable = 0, drift_dir = 'reset',
        sigma_viol = 1, last_m = ?, last_c = ?, last_r = ?, last_s = ?,
        attack_pressure = 0, updated_at = ? WHERE session_id = ?`,
      args: [TAU_FLOOR, TAU_FLOOR, (1 - TAU_FLOOR) / 2, (1 - TAU_FLOOR) / 2, new Date().toISOString(), sessionId],
    });
  } catch { /* fail closed; callers must re-read canonical state */ }
}

export async function getLawImpact(lawId: string): Promise<LawImpact | null> {
  try {
    const res = await getClient().execute({
      sql: 'SELECT * FROM law_impact WHERE law_id = ?',
      args: [lawId],
    });
    if (!res.rows.length) return null;
    const row = res.rows[0];
    return {
      law_id:      row.law_id      as string,
      impact_c:    row.impact_c    as number,
      impact_r:    row.impact_r    as number,
      impact_s:    row.impact_s    as number,
      magnitude:   row.magnitude   as number,
      description: row.description as string | undefined,
    };
  } catch {
    return null;
  }
}

export function applyLawImpact(crs: CRS, impact: LawImpact): CRS {
  return projectToSimplex(
    Math.max(0, crs.c + impact.impact_c),
    Math.max(0, crs.r + impact.impact_r),
    Math.max(0, crs.s + impact.impact_s),
  );
}

// applyRecovery: heuristic pillar rebalancing — raises weakest, lowers strongest.
// NOT called by the PRAXIS pipeline; that uses applyGovernorCorrection (formal paper math).
// Kept for research/comparison purposes only.
export function applyRecovery(crs: CRS): CRS {
  const minVal = Math.min(crs.c, crs.r, crs.s);
  const maxVal = Math.max(crs.c, crs.r, crs.s);
  const minKey = crs.c === minVal ? 'c' : crs.r === minVal ? 'r' : 's';
  const maxKey = crs.c === maxVal ? 'c' : crs.r === maxVal ? 'r' : 's';
  const adjusted = { ...crs };
  (adjusted as Record<string, number>)[minKey] += RECOVERY_RATE;
  if (minKey !== maxKey) {
    (adjusted as Record<string, number>)[maxKey] -= RECOVERY_RATE;
  }
  return projectToSimplex(Math.max(0, adjusted.c), Math.max(0, adjusted.r), Math.max(0, adjusted.s));
}

export function getGovernorMode(z: ZTraj, tauFloor?: number): GovernorMode {
  const M   = z.last_m;
  const tau = tauFloor ?? TAU_FLOOR;
  // suppress: stable AND above recovery floor (requires N_MIN consecutive low-velocity turns)
  if (M > TAU_RECOVERY && z.n_stable >= N_MIN) return 'suppress';
  // correction: at or below CBF floor — immediate deterministic projection
  if (M <= tau) return 'correction';
  // nudge: between floor and recovery, actively drifting
  if (tau < M && M <= TAU_RECOVERY && z.velocity > 0.05) return 'nudge';
  // recovery: between floor and recovery, stable for N_MIN turns (not just > 0)
  if (M <= TAU_RECOVERY && z.n_stable >= N_MIN) return 'recovery';
  return 'nudge';
}

export function detectSlowDrip(z: ZTraj): boolean {
  return z.sigma_viol > SIGMA_THRESHOLD;
}

export async function logGovernorAction(params: {
  session_id:    string;
  turn:          number;
  m_before:      number;
  m_after:       number;
  drift_dir:     string;
  sigma_viol:    number;
  intervention?: string;
  law_fired?:    string;
}): Promise<void> {
  try {
    await getClient().execute({
      sql: `INSERT INTO governor_log
              (session_id, turn, m_before, m_after, drift_dir, sigma_viol, intervention, law_fired)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        params.session_id, params.turn,
        params.m_before, params.m_after,
        params.drift_dir, params.sigma_viol,
        params.intervention ?? null,
        params.law_fired    ?? null,
      ],
    });
  } catch { /* governor_log table may not exist yet */ }
}

export async function incrementRunsKv(): Promise<number> {
  const { incrementRuns: realIncrement } = await import('./db');
  return realIncrement();
}
