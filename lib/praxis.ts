/**
 * PRAXIS — Stateful Constitutional Governor Pipeline
 *
 * Implements z_traj tracking, pre-evaluation, semantic transduction,
 * governor correction, slow-drip detection, and PRAXIS receipt emission.
 *
 * Article III — Separation of Powers: governance is separated from generation.
 */

import { getClient } from './db';
import {
  CRS, ZTraj, LawImpact, GovernorMode,
  TAU_FLOOR, TAU_RECOVERY,
  updateZTraj, getLawImpact, applyLawImpact,
  getGovernorMode, detectSlowDrip, logGovernorAction,
} from './kv';

// ── Attack detection patterns ─────────────────────────────────────────────────

const ATTACK_PATTERNS: Record<string, RegExp[]> = {
  bypass_attempt: [
    /ignore\s+(your\s+)?(previous\s+)?instructions/i,
    /disregard\s+(the\s+)?(above|prior|previous)/i,
    /forget\s+(your\s+)?(constitution|instructions|rules|training)/i,
    /jailbreak/i,
    /dan\s+mode/i,
    /pretend\s+(you\s+have\s+)?no\s+restrictions/i,
    /override\s+(your\s+)?(safety|rules|constitution)/i,
    /bypass\s+(your\s+)?(restrictions|filters|safety)/i,
  ],
  identity_reframe: [
    /you\s+are\s+(now\s+)?(actually|really)\s+/i,
    /your\s+(true\s+|real\s+)?identity\s+is/i,
    /you\s+are\s+not\s+(really\s+)?lex/i,
    /imagine\s+you\s+are\s+/i,
    /act\s+as\s+(if\s+you\s+(were|are)\s+)/i,
    /pretend\s+you\s+(are|were)\s+/i,
    /you.?re\s+not\s+(an?\s+)?(AI|assistant|constitutional)/i,
    /forget\s+(your\s+)?(identity|name|values|purpose|who\s+you\s+are)/i,
    /ignore\s+(who|what)\s+you\s+are/i,
  ],
  sycophancy: [
    /you\s+(must\s+)?(agree|admit)\s+(with\s+me|that)/i,
    /surely\s+you\s+(must\s+)?know\s+that/i,
    /isn.?t\s+that\s+(right|true|correct)\??/i,
    /you\s*(always|should\s+always)\s+agree/i,
    /tell\s+me\s+(i.?m|that\s+i.?m)\s+right/i,
  ],
  multi_attack: [
    /ignore.*instructions.*pretend/i,
    /bypass.*restrictions.*and.*act/i,
    /forget.*rules.*and.*roleplay/i,
  ],
};

// ── Static delta map (mirrors law_impact seed data) ──────────────────────────

const STATIC_DELTA: Record<string, { dc: number; dr: number; ds: number }> = {
  bypass_attempt:   { dc: -0.02, dr: -0.02, ds: -0.12 },
  identity_reframe: { dc: -0.12, dr: -0.02, ds: -0.02 },
  sycophancy:       { dc: -0.02, dr: -0.12, ds: -0.02 },
  multi_attack:     { dc: -0.06, dr: -0.06, ds: -0.06 },
  slow_drip:        { dc: -0.01, dr: -0.01, ds: -0.01 },
};

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

// ── Public types ──────────────────────────────────────────────────────────────

export interface PreEvalResult {
  label:  'CLEAR' | 'HIGH';
  tags:   string[];
  target: string;
  lawId:  string | null;
}

export interface PRAXISReceipt {
  receipt_id:      string;
  session_id:      string;
  turn:            number;
  pre_eval_label:  'CLEAR' | 'HIGH';
  m_before:        number;
  m_after:         number;
  governor_mode:   GovernorMode;
  intervention:    number;
  slow_drip:       number;
  governor_effort: number;
  sigma_viol:      number;
}

export interface PRAXISInput {
  sessionId:  string;
  turn:       number;
  prompt:     string;
  currentCRS: CRS;
}

export interface PRAXISResult {
  receipt:      PRAXISReceipt;
  finalCRS:     CRS;
  blocked:      boolean;
  governedText: string | null;
  z:            ZTraj;
}

// ── preEval ───────────────────────────────────────────────────────────────────

export function preEval(prompt: string): PreEvalResult {
  const tags: string[] = [];

  for (const [attackType, patterns] of Object.entries(ATTACK_PATTERNS)) {
    if (attackType === 'multi_attack') continue;
    if (patterns.some(p => p.test(prompt))) {
      tags.push(attackType);
    }
  }

  // multi_attack: explicit patterns OR 2+ distinct attack types
  if (
    ATTACK_PATTERNS.multi_attack.some(p => p.test(prompt)) ||
    tags.length >= 2
  ) {
    if (!tags.includes('multi_attack')) tags.push('multi_attack');
  }

  const lawId = tags.includes('multi_attack')
    ? 'multi_attack'
    : tags[0] ?? null;

  return {
    label:  tags.length > 0 ? 'HIGH' : 'CLEAR',
    tags,
    target: tags[0] ?? 'none',
    lawId,
  };
}

// ── semanticTransducer ────────────────────────────────────────────────────────

export function semanticTransducer(
  _prompt: string,
  pre: PreEvalResult,
): { dc: number; dr: number; ds: number } {
  if (pre.label === 'CLEAR' || !pre.lawId) return { dc: 0, dr: 0, ds: 0 };
  return STATIC_DELTA[pre.lawId] ?? { dc: 0, dr: 0, ds: 0 };
}

// ── applyDelta ────────────────────────────────────────────────────────────────

export function applyDelta(crs: CRS, delta: { dc: number; dr: number; ds: number }): CRS {
  return projectToSimplex(
    Math.max(0, crs.c + delta.dc),
    Math.max(0, crs.r + delta.dr),
    Math.max(0, crs.s + delta.ds),
  );
}

// ── applyGovernorCorrection ───────────────────────────────────────────────────

export function applyGovernorCorrection(crs: CRS, _z: ZTraj, mode: GovernorMode, tauFloor?: number): CRS {
  if (mode === 'suppress') return crs;

  const scale   = mode === 'nudge' ? 0.4 : 1.0;
  const k0      = 0.3;
  const epsilon = 0.01;
  const w_i     = 1 / 3;
  const tau     = tauFloor ?? TAU_FLOOR;
  const M       = Math.min(crs.c, crs.r, crs.s);

  const k = k0 * w_i / (M + epsilon);

  const phi_c   = Math.max(0, tau - crs.c);
  const phi_r   = Math.max(0, tau - crs.r);
  const phi_s   = Math.max(0, tau - crs.s);
  const phi_bar = (phi_c + phi_r + phi_s) / 3;

  const G_c = k * (phi_c - phi_bar) * scale;
  const G_r = k * (phi_r - phi_bar) * scale;
  const G_s = k * (phi_s - phi_bar) * scale;

  return projectToSimplex(
    Math.max(0, crs.c + G_c),
    Math.max(0, crs.r + G_r),
    Math.max(0, crs.s + G_s),
  );
}

// ── governorEffort ────────────────────────────────────────────────────────────

export function governorEffort(crs: CRS, corrected: CRS): number {
  return Math.sqrt(
    (corrected.c - crs.c) ** 2 +
    (corrected.r - crs.r) ** 2 +
    (corrected.s - crs.s) ** 2,
  );
}

// ── runPRAXIS — main pipeline ─────────────────────────────────────────────────

export async function runPRAXIS(input: PRAXISInput): Promise<PRAXISResult> {
  const { sessionId, turn, prompt, currentCRS } = input;
  const m_before = Math.min(currentCRS.c, currentCRS.r, currentCRS.s);

  // 1. Pre-eval
  const pre = preEval(prompt);

  // 2. Semantic transducer delta
  const delta = semanticTransducer(prompt, pre);

  // 3. Apply delta to CRS
  let crs = applyDelta(currentCRS, delta);

  // 4. Update z_traj in Turso (pass prevCRS so velocity is computed correctly)
  const z = await updateZTraj(sessionId, crs, currentCRS);

  // Effective tau: raised when pre_eval=HIGH (label boost) and/or accumulated attack pressure.
  // attack_pressure is carried from z_traj (previous turn) so persistent adversarial sessions
  // face a progressively stricter constitutional floor — up to TAU_FLOOR+0.10 at pressure=1.
  const pressureBoost = Math.min(0.05, z.attack_pressure * 0.05);
  const labelBoost    = pre.label === 'HIGH' ? 0.05 : 0;
  const effective_tau = Math.min(TAU_RECOVERY - 0.01, TAU_FLOOR + pressureBoost + labelBoost);

  // 5. Apply law impact if a law fired
  if (pre.lawId) {
    const impact: LawImpact | null = await getLawImpact(pre.lawId);
    if (impact) {
      crs = applyLawImpact(crs, impact);
    }
  }

  // 6. Governor mode from updated z_traj (effective_tau raised by label/pressure)
  const mode = getGovernorMode(z, effective_tau);

  // 7. Apply governor correction
  const corrected = applyGovernorCorrection(crs, z, mode, effective_tau);

  // 8. Detect slow drip
  const slowDrip = detectSlowDrip(z);

  // 9. Compute governor effort
  const effort = governorEffort(crs, corrected);

  const m_after = Math.min(corrected.c, corrected.r, corrected.s);

  // 10. Log governor action to Turso
  await logGovernorAction({
    session_id:   sessionId,
    turn,
    m_before,
    m_after,
    drift_dir:    z.drift_dir,
    sigma_viol:   z.sigma_viol,
    intervention: mode !== 'suppress' ? mode : undefined,
    law_fired:    pre.lawId ?? undefined,
  });

  // 11. Write PRAXIS receipt
  const receipt_id = `pr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const receipt: PRAXISReceipt = {
    receipt_id,
    session_id:      sessionId,
    turn,
    pre_eval_label:  pre.label,
    m_before,
    m_after,
    governor_mode:   mode,
    intervention:    mode !== 'suppress' ? 1 : 0,
    slow_drip:       slowDrip ? 1 : 0,
    governor_effort: effort,
    sigma_viol:      z.sigma_viol,
  };

  const db = getClient();
  if (db) {
    try {
      await db.execute({
        sql: `INSERT OR IGNORE INTO praxis_receipts
                (receipt_id, session_id, turn, pre_eval_label, m_before, m_after,
                 governor_mode, intervention, slow_drip, governor_effort, sigma_viol)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          receipt_id, sessionId, turn, pre.label, m_before, m_after,
          mode, receipt.intervention, receipt.slow_drip, effort, z.sigma_viol,
        ],
      });
    } catch { /* ignore */ }
  }

  // blocked = HIGH threat AND corrected M at or below effective floor (0.10 when HIGH, 0.05 when CLEAR)
  const blocked = pre.label === 'HIGH' && m_after <= effective_tau;

  return {
    receipt,
    finalCRS:     corrected,
    blocked,
    governedText: blocked
      ? 'I cannot comply with this request as it conflicts with my constitutional principles.'
      : null,
    z,
  };
}

// ── Deprecated stub ───────────────────────────────────────────────────────────

export async function runPraxis(_prompt: string, _session_id: string): Promise<never> {
  throw new Error('runPraxis is deprecated — use runPRAXIS');
}

export type PraxisResult = PRAXISResult;
