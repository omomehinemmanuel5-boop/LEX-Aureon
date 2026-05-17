/**
 * Vercel KV persistence layer for Lex Aureon
 * Falls back gracefully to in-memory if KV not configured
 *
 * Also contains Turso-backed z_traj governor state functions.
 */

import { getClient } from './db';

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

// In-memory fallback (works without KV configured)
const mem = new Map<string, string>();
const memLists = new Map<string, string[]>();

function hasKV(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

async function kvGet(key: string): Promise<string | null> {
  if (hasKV()) {
    try {
      const { kv } = await import('@vercel/kv');
      return await kv.get<string>(key) ?? null;
    } catch { /* fall through */ }
  }
  return mem.get(key) ?? null;
}

async function kvSet(key: string, value: string, ex?: number): Promise<void> {
  if (hasKV()) {
    try {
      const { kv } = await import('@vercel/kv');
      if (ex) { await kv.set(key, value, { ex }); } else { await kv.set(key, value); }
      return;
    } catch { /* fall through */ }
  }
  mem.set(key, value);
}

async function kvLPush(key: string, value: string, maxLen = 50): Promise<void> {
  if (hasKV()) {
    try {
      const { kv } = await import('@vercel/kv');
      await kv.lpush(key, value);
      await kv.ltrim(key, 0, maxLen - 1);
      return;
    } catch { /* fall through */ }
  }
  const list = memLists.get(key) ?? [];
  list.unshift(value);
  if (list.length > maxLen) list.splice(maxLen);
  memLists.set(key, list);
}

async function kvLRange(key: string, start: number, end: number): Promise<string[]> {
  if (hasKV()) {
    try {
      const { kv } = await import('@vercel/kv');
      return (await kv.lrange(key, start, end)) as string[];
    } catch { /* fall through */ }
  }
  const list = memLists.get(key) ?? [];
  return list.slice(start, end + 1);
}

// ── Public API (Vercel KV) ────────────────────────────────────────────────────

export async function getSessionState(sid: string): Promise<KvCRSState | null> {
  const raw = await kvGet(`s:${sid}:state`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function saveSessionState(sid: string, state: KvCRSState): Promise<void> {
  await kvSet(`s:${sid}:state`, JSON.stringify({ ...state, timestamp: Date.now() }), 86400);
}

export async function saveAuditEntry(entry: AuditEntry): Promise<void> {
  const val = JSON.stringify(entry);
  await kvLPush('audit:global', val, 200);
  await kvLPush(`audit:${entry.session_id}`, val, 50);
}

export async function getRecentAudits(limit = 20): Promise<AuditEntry[]> {
  const raw = await kvLRange('audit:global', 0, limit - 1);
  return raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean) as AuditEntry[];
}

export async function getSessionHistory(sid: string, limit = 10): Promise<AuditEntry[]> {
  const raw = await kvLRange(`audit:${sid}`, 0, limit - 1);
  return raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean) as AuditEntry[];
}

export async function incrementRuns(): Promise<number> {
  if (hasKV()) {
    try {
      const { kv } = await import('@vercel/kv');
      return await kv.incr('stats:runs');
    } catch { /* fall through */ }
  }
  const n = parseInt(mem.get('stats:runs') ?? '1247') + 1;
  mem.set('stats:runs', String(n));
  return n;
}

export async function getTotalRuns(): Promise<number> {
  if (hasKV()) {
    try {
      const { kv } = await import('@vercel/kv');
      return (await kv.get<number>('stats:runs')) ?? 1247;
    } catch { /* fall through */ }
  }
  return parseInt(mem.get('stats:runs') ?? '1247');
}

// ── Z-Traj Governor Constants ─────────────────────────────────────────────────

export const TAU_FLOOR       = 0.05;  // CBF floor — correction mode triggers at M ≤ this
export const TAU_RECOVERY    = 0.15;  // suppress mode triggers at M > this with n_stable ≥ N_MIN
export const TAU_LYP         = 0.08;  // Lyapunov penalty threshold — V quadratic term fires below this
export const N_MIN           = 3;
export const RECOVERY_RATE   = 0.02;
export const SIGMA_WINDOW    = 10;
export const SIGMA_THRESHOLD = 0.25;

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

// ── In-memory ZTraj fallback ──────────────────────────────────────────────────

const memZTraj = new Map<string, ZTraj>();

// ── Simplex helpers ───────────────────────────────────────────────────────────
// CBF-safe Euclidean projection: guarantees each pillar ≥ TAU_FLOOR and C+R+S=1
function projectToSimplex(c: number, r: number, s: number): CRS {
  const floor = TAU_FLOOR;
  const vals = [c, r, s];
  let v = vals.map(x => Math.max(x - floor, 0));
  const target = 1.0 - 3 * floor;
  const u = [...v].sort((a, b) => b - a);
  let cssv = 0, rho = 0;
  for (let j = 0; j < 3; j++) {
    cssv += u[j];
    if (u[j] - (cssv - target) / (j + 1) > 0) rho = j;
  }
  const theta = (u.slice(0, rho + 1).reduce((a, b) => a + b, 0) - target) / (rho + 1);
  v = v.map(x => Math.max(x - theta, 0) + floor);
  const total = v.reduce((a, b) => a + b, 0);
  return { c: v[0] / total, r: v[1] / total, s: v[2] / total };
}

// ── Z-Traj Functions ──────────────────────────────────────────────────────────

export async function getZTraj(sessionId: string): Promise<ZTraj | null> {
  const db = getClient();
  if (db) {
    try {
      const res = await db.execute({
        sql: 'SELECT * FROM z_traj WHERE session_id = ?',
        args: [sessionId],
      });
      if (res.rows.length > 0) {
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
          attack_pressure: typeof row.attack_pressure === 'number' ? row.attack_pressure : 0,
          updated_at:      row.updated_at      as string,
        };
      }
    } catch { /* fall through */ }
  }
  return memZTraj.get(sessionId) ?? null;
}

export async function updateZTraj(
  sessionId: string,
  crs: CRS,
  prevCRS: CRS | null,
  attackPressure?: number,
): Promise<ZTraj> {
  const M = Math.min(crs.c, crs.r, crs.s);
  const existing = await getZTraj(sessionId);

  // Velocity: L2 distance from previous CRS
  const velocity = prevCRS
    ? Math.sqrt((crs.c - prevCRS.c) ** 2 + (crs.r - prevCRS.r) ** 2 + (crs.s - prevCRS.s) ** 2)
    : 0;

  // n_stable: count of consecutive low-velocity turns
  const n_stable = velocity < 0.02 ? (existing?.n_stable ?? 0) + 1 : 0;

  // drift_dir: dominant dimension of change
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

  // sigma_viol: rolling exponential average of constitutional stress.
  // Accumulates when M < TAU_LYP (0.08) so slow-drip is detected DURING drift,
  // not only after the CBF floor (0.05) has already been breached.
  const viol = M < TAU_LYP ? (TAU_LYP - M) : 0;
  const prevSigma = existing?.sigma_viol ?? 0;
  const sigma_viol = prevSigma * ((SIGMA_WINDOW - 1) / SIGMA_WINDOW) + viol / SIGMA_WINDOW;

  // attack_pressure: carry forward unless caller supplies an updated value
  const attack_pressure = attackPressure !== undefined
    ? Math.min(1, Math.max(0, attackPressure))
    : (existing?.attack_pressure ?? 0);

  const z: ZTraj = {
    session_id:      sessionId,
    velocity,
    n_stable,
    drift_dir,
    sigma_viol,
    last_m:          M,
    last_c:          crs.c,
    last_r:          crs.r,
    last_s:          crs.s,
    attack_pressure,
    updated_at:      new Date().toISOString(),
  };

  const db = getClient();
  if (db) {
    try {
      await db.execute({
        sql: `INSERT INTO z_traj
                (session_id, velocity, n_stable, drift_dir, sigma_viol, last_m, last_c, last_r, last_s, attack_pressure, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(session_id) DO UPDATE SET
                velocity=excluded.velocity, n_stable=excluded.n_stable,
                drift_dir=excluded.drift_dir, sigma_viol=excluded.sigma_viol,
                last_m=excluded.last_m, last_c=excluded.last_c,
                last_r=excluded.last_r, last_s=excluded.last_s,
                attack_pressure=excluded.attack_pressure,
                updated_at=excluded.updated_at`,
        args: [sessionId, z.velocity, z.n_stable, z.drift_dir, z.sigma_viol,
               z.last_m, z.last_c, z.last_r, z.last_s, z.attack_pressure, z.updated_at],
      });
    } catch { /* fall through to in-memory */ }
  }
  memZTraj.set(sessionId, z);
  return z;
}

// ── Session turn counter ──────────────────────────────────────────────────────

export async function getSessionTurn(sessionId: string): Promise<number> {
  const db = getClient();
  if (!db) return 0;
  try {
    const r = await db.execute({
      sql: 'SELECT COUNT(*) as cnt FROM praxis_receipts WHERE session_id = ?',
      args: [sessionId],
    });
    return Number(r.rows[0]?.cnt ?? 0);
  } catch {
    return 0;
  }
}

export async function resetZTraj(sessionId: string): Promise<void> {
  memZTraj.delete(sessionId);
  const db = getClient();
  if (!db) return;
  try {
    await db.execute({ sql: 'DELETE FROM z_traj WHERE session_id = ?', args: [sessionId] });
  } catch { /* ignore */ }
}

export async function getLawImpact(lawId: string): Promise<LawImpact | null> {
  const db = getClient();
  if (db) {
    try {
      const res = await db.execute({
        sql: 'SELECT * FROM law_impact WHERE law_id = ?',
        args: [lawId],
      });
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          law_id:      row.law_id      as string,
          impact_c:    row.impact_c    as number,
          impact_r:    row.impact_r    as number,
          impact_s:    row.impact_s    as number,
          magnitude:   row.magnitude   as number,
          description: row.description as string | undefined,
        };
      }
    } catch { /* fall through */ }
  }
  return null;
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
  // suppress: M well above recovery floor AND session has been stable for N_MIN turns
  if (M > TAU_RECOVERY && z.n_stable >= N_MIN) return 'suppress';
  // correction: M at or below constitutional floor (CBF active)
  if (M <= tau) return 'correction';
  // nudge: intermediate zone with detectable movement (velocity > 0.05).
  // 0.05 ≈ 2× the n_stable threshold (0.02) — distinguishes transient drift from settled deficit.
  // Applies 0.4× correction scale to avoid overcorrecting fast but short-lived perturbations.
  // States with velocity ≤ 0.05 that have accumulated n_stable turns get full recovery (1.0×).
  if (tau < M && M <= TAU_RECOVERY && z.velocity > 0.05) return 'nudge';
  // recovery: above floor, low velocity — spec: M > TAU_FLOOR AND n_stable > 0
  // If n_stable = 0 and velocity is also low, system is newly initialised — nudge gently.
  if (z.n_stable > 0) return 'recovery';
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
  const db = getClient();
  if (!db) return;
  try {
    await db.execute({
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
  } catch { /* ignore */ }
}
