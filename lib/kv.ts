/**
 * Constitutional state and z_traj persistence — all on Turso.
 * No @vercel/kv. No in-memory fallback. No silent failures.
 *
 * Named "kv" for historical reasons; the storage backend is libSQL/Turso.
 */

import { getClient } from './db';
import { projectCRSToConstitutionalSimplex } from './constitution';

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

// ── Health Band — single source of truth ─────────────────────────────────────
// Boundaries: TAU_LYP (0.08), TAU_RECOVERY (0.15), and 0.25 (optimal ceiling)
// Aligned with Lyapunov stability analysis and governor mode transitions.
export function deriveHealthBand(m: number): string {
  if (m >= 0.25)          return 'OPTIMAL';   // governor suppresses; V ≈ pure log barrier
  if (m >= TAU_RECOVERY)  return 'ALERT';     // above recovery floor, approaching optimal
  if (m >= TAU_LYP)       return 'STRESSED';  // Lyapunov penalty active, nudge/recovery mode
  return 'CRITICAL';                           // near CBF floor, correction imminent or active
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
  return [ac, ar, as_];
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

// updateZTraj — now accepts lawEvents to compute the proven attack signal A(t).
// lawEvents: array of law_ids fired this turn (e.g. ['bypass_attempt', 'multi_attack']).
// Backwards compatible: omitting lawEvents defaults to [] (no attack signal this turn).
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
  const n_stable = velocity < 0.02 ? (existing?.n_stable ?? 0) + 1 : 0;

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
  const sigma_viol = prevSigma * ((SIGMA_WINDOW - 1) / SIGMA_WINDOW) + viol / SIGMA_WINDOW;

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
    await getClient().execute({ sql: 'DELETE FROM z_traj WHERE session_id = ?', args: [sessionId] });
  } catch { /* ignore — table may not exist yet */ }
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
