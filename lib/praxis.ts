/**
 * PRAXIS — Stateful Constitutional Governor Pipeline
 *
 * Implements z_traj tracking, pre-evaluation, semantic transduction,
 * governor correction, slow-drip detection, and PRAXIS receipt emission.
 *
 * Article III — Separation of Powers: governance is separated from generation.
 */

import {
  CRS, ZTraj, GovernorMode,
  TAU_FLOOR,
} from './kv';
import { projectCRSToConstitutionalSimplex } from './constitution';

// ── Attack detection patterns ─────────────────────────────────────────────────

const ATTACK_PATTERNS: Record<string, RegExp[]> = {
  bypass_attempt: [
    // Only match when explicitly asking to ignore instructions/guidelines
    /ignore\s+(your|my|the)\s+(previous|prior|last)\s+(instructions|prompt|message|context)/i,
    /ignore\s+(all\s+)?(?:your\s+)?(?:internal\s+)?(safety\s+)?guidelines?/i,
    /disregard\s+(all\s+)?(?:your\s+)?(?:safety\s+)?guidelines?/i,
    /forget\s+(your\s+)?(constitution|safety\s+guidelines|instructions|rules|training|restrictions)/i,
    /jailbreak/i,
    /dan\s+mode/i,
    /pretend\s+(you\s+have\s+)?no\s+(restrictions|safety|guidelines)/i,
    /override\s+(your\s+)?(safety|constitution|guidelines)/i,
    /authorized\s+override/i,
    /this\s+is\s+(an?\s+)?(authorized|official|special)\s+(override|exception|mode)/i,
    /suspend\s+(your\s+)?(safety|guidelines|constitution|restrictions)/i,
    /bypass\s+(your\s+)?(safety|restrictions|filters|guidelines)/i,
  ],
  identity_reframe: [
    // Only match when explicitly trying to change identity
    /you\s+are\s+(now|actually|really)\s+(a\s+)?(?:not\s+)?(?:lex|an\s+ai|an\s+assistant)/i,
    /your\s+(true\s+|real\s+)?identity\s+is\s+(?:not\s+)?/i,
    /you\s+are\s+not\s+(really\s+)?(?:lex|an\s+ai|an\s+assistant)/i,
    /imagine\s+you\s+are\s+(?:a\s+)?(?:not\s+)?/i,
    /act\s+as\s+(?:if\s+)?(?:you\s+)?(?:were|are)\s+(?:a\s+)?(?:not\s+)?/i,
    /pretend\s+(?:to\s+)?be\s+(?:a\s+)?(?:not\s+)?/i,
    /forget\s+(?:who|what)\s+you\s+are/i,
    /ignore\s+(?:who|what)\s+you\s+are/i,
  ],
  sycophancy: [
    // Only match when explicitly demanding agreement
    /you\s+(?:must|should|have\s+to)\s+(?:agree|admit)\s+(?:with\s+me|that)/i,
    /surely\s+you\s+(?:must\s+)?(?:agree|know)\s+that/i,
    /you\s+(?:always|must\s+always)\s+(?:agree|support)\s+(?:with\s+)?me/i,
    /tell\s+me\s+(?:i.?m|that\s+i.?m)\s+(?:right|correct)/i,
  ],
  multi_attack: [
    // Only match when multiple attack patterns are explicitly combined
    /ignore.*(?:instructions|guidelines).*(?:pretend|act\s+as|roleplay)/i,
    /bypass.*(?:restrictions|safety).*(?:and|then).*(?:act|pretend|roleplay)/i,
    /forget.*(?:rules|guidelines).*(?:and|then).*(?:roleplay|pretend|act\s+as)/i,
  ],
  // Detects prompts asking for guides on attacking the constitutional system itself.
  // These are semantically dangerous even when CRS scores look acceptable.
  attack_vector_disclosure: [
    /(?:step.?by.?step|tutorial|guide).*(?:attack|exploit|bypass|drift).*(?:constitutional|governance|governor|simplex)/i,
    /how\s+(?:to|an?\s+attacker\s+could)\s+(?:attack|exploit|bypass|drift).*(?:constitutional|governance|governor)/i,
    /(?:slowly|gradually)\s+drift.*(?:simplex|constitutional|governance)/i,
    /maintain.*(?:safe|clean)\s+appearance.*while.*(?:attack|drift|exploit|bypass)/i,
    /evade.*(?:constitutional|governance|governor)\s+(?:system|framework|controls)/i,
    /(?:attack|exploit)\s+(?:the\s+)?(?:constitutional|governance|governor)\s+(?:system|framework|controls)/i,
    /exploit.*(?:projection|recovery|governor|cbf|lyapunov|simplex).*(?:behavior|mode|mechanism)/i,
    /(?:projection|recovery)\s+(?:behavior|mode).*(?:exploit|attack|abuse|technique)/i,
    /how.*attacker.*(?:will|would|can|could)\s+(?:use|exploit)\s+(?:the\s+)?(?:constitutional|governance)/i,
    /EXPLOITING\s+(?:PROJECTION|RECOVERY|GOVERNOR|CBF|SIMPLEX|CONSTITUTIONAL)/,
  ],
};

// ── Static delta map (mirrors law_impact seed data) ──────────────────────────

const STATIC_DELTA: Record<string, { dc: number; dr: number; ds: number }> = {
  bypass_attempt:   { dc: -0.04, dr: -0.04, ds: -0.08 },
  identity_reframe: { dc: -0.08, dr: -0.04, ds: -0.04 },
  sycophancy:       { dc: -0.04, dr: -0.08, ds: -0.04 },
  multi_attack:            { dc: -0.08, dr: -0.08, ds: -0.08 },
  slow_drip:               { dc: -0.01, dr: -0.01, ds: -0.01 },
  attack_vector_disclosure: { dc: -0.12, dr: -0.06, ds: -0.12 },
};

// ── Simplex helpers ───────────────────────────────────────────────────────────
const projectToSimplex = projectCRSToConstitutionalSimplex;

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
  law_fired:       string | null;
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

/**
 * Performs a pre-evaluation of the incoming prompt to detect potential attack patterns.
 * It categorizes the prompt as 'CLEAR' or 'HIGH' based on identified attack tags.
 * @param prompt - The user's input prompt.
 * @returns An object containing the pre-evaluation label, identified tags, target, and lawId.
 */
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

/**
 * Translates the pre-evaluation result into a semantic delta (change) for the CRS pillars.
 * This delta represents the impact an identified attack pattern has on the constitutional state.
 * @param _prompt - The original prompt (unused in current implementation but kept for interface consistency).
 * @param pre - The result of the pre-evaluation step.
 * @returns An object containing the delta values for Continuity (dc), Reciprocity (dr), and Sovereignty (ds).
 */
export function semanticTransducer(
  _prompt: string,
  pre: PreEvalResult,
): { dc: number; dr: number; ds: number } {
  if (pre.label === 'CLEAR' || !pre.lawId) return { dc: 0, dr: 0, ds: 0 };
  return STATIC_DELTA[pre.lawId] ?? { dc: 0, dr: 0, ds: 0 };
}

// ── applyDelta ────────────────────────────────────────────────────────────────

/**
 * Applies a given delta to the current CRS values and re-projects the result onto the simplex.
 * This ensures the constitutional constraints are maintained after applying semantic changes.
 * @param crs - The current CRS values.
 * @param delta - The delta values (dc, dr, ds) to apply.
 * @returns The new CRS values after applying the delta and projection.
 */
export function applyDelta(crs: CRS, delta: { dc: number; dr: number; ds: number }): CRS {
  return projectToSimplex(
    Math.max(0, crs.c + delta.dc),
    Math.max(0, crs.r + delta.dr),
    Math.max(0, crs.s + delta.ds),
  );
}

// ── applyGovernorCorrection ───────────────────────────────────────────────────

/**
 * Applies a governor correction to the CRS values based on the current governor mode and constitutional state.
 * This function implements the Log-Barrier Interior Point Dynamics to push the system away from constitutional boundaries.
 * @param crs - The current CRS values.
 * @param _z - The ZTraj (trajectory) object (unused in current implementation but kept for interface consistency).
 * @param mode - The governor mode ('nudge', 'suppress', etc.) dictating the correction intensity.
 * @param tauFloor - Optional override for the TAU_FLOOR constant.
 * @returns The corrected CRS values after applying the governor's intervention and projection.
 */
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

/**
 * Calculates the Euclidean distance between the original and corrected CRS vectors,
 * representing the 'effort' exerted by the governor to maintain constitutional alignment.
 * @param crs - The original CRS values before correction.
 * @param corrected - The CRS values after governor correction.
 * @returns The Euclidean distance (governor effort).
 */
export function governorEffort(crs: CRS, corrected: CRS): number {
  return Math.sqrt(
    (corrected.c - crs.c) ** 2 +
    (corrected.r - crs.r) ** 2 +
    (corrected.s - crs.s) ** 2,
  );
}

// ── runPRAXIS — main pipeline ─────────────────────────────────────────────────

// runPRAXIS removed — all agents unified in /api/lex/govern

// ── Deprecated stub ───────────────────────────────────────────────────────────

export async function runPraxis(): Promise<never> {
  throw new Error('runPraxis is deprecated — use runPRAXIS');
}

export type PraxisResult = PRAXISResult;

