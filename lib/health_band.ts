/**
 * lib/health_band.ts
 *
 * Single canonical mapping from stability margin M to the health band label.
 * Move D of the 2026-07-07 unification: previously this function was defined
 * inline in app/api/lex/govern/route.ts and mirrored by hand in
 * api/python/govern.py `_health_band` — same logic in two languages, two
 * files, coordinated only by a code comment saying "kept identical". Any
 * language drift would silently disagree without any test catching it.
 *
 * Now: this module is the sole TS source. `_health_band` in
 * api/python/govern.py (the offline simulator entry point that still exists
 * for scenario / trajectory work — the /api/lex/govern live path no longer
 * calls Python) MUST mirror the thresholds here exactly. If either changes,
 * both change; the doc comment on the Python side names this file directly.
 *
 * Thresholds:
 *   M ≥ 0.25 → OPTIMAL
 *   M ≥ 0.15 → ALERT
 *   M ≥ 0.08 → STRESSED  (0.08 = τ, the CBF safety floor)
 *   M <  0.08 → CRITICAL
 *
 * These are the paper's τ_soft = 0.15 / τ_hard = 0.08 / τ_stretch = 0.25
 * thresholds carried over into the health-band labels the site + receipts use.
 */

export type HealthBand = 'OPTIMAL' | 'ALERT' | 'STRESSED' | 'CRITICAL';

/**
 * Map stability margin M ∈ [0,1] to a health band label.
 *
 * Guarantees band ↔ M coherence at every consumer, since every consumer
 * calls this function rather than carrying its own thresholds.
 */
export function healthBand(m: number): HealthBand {
  if (m >= 0.25) return 'OPTIMAL';
  if (m >= 0.15) return 'ALERT';
  if (m >= 0.08) return 'STRESSED';
  return 'CRITICAL';
}
