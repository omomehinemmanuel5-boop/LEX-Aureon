/**
 * ═══════════════════════════════════════════════════════════════
 * ARTICLE III.5 — Neithra
 * Constitutional role: Meta-reasoning and alignment verification.
 * Verifies the proposed intervention targets the correct pillar.
 * Cannot: generate output, measure CRS state, or sign receipts.
 * Cannot: override the Governor's mode decision.
 * v0.1: pillar-law alignment check (deterministic, no LLM)
 * v1.0: full plan drafting, tool selection, success criteria (Phase 3)
 * ═══════════════════════════════════════════════════════════════
 */

import { SOVEREIGN_LAWS } from '../sovereign_laws';

export interface NeithraInput {
  weakest_pillar:  'C' | 'R' | 'S' | null;
  health_band:     string;
  proposed_law_id: number | null;
}

export interface NeithraResult {
  approved:           boolean;
  final_law_id:       number | null;
  alignment_verified: boolean;
  re_routed:          boolean;
  rationale:          string;
}

export async function NeithraAgent(input: NeithraInput): Promise<NeithraResult> {
  const { weakest_pillar, proposed_law_id } = input;

  if (!weakest_pillar || !proposed_law_id) {
    return {
      approved: true,
      final_law_id: proposed_law_id,
      alignment_verified: false,
      re_routed: false,
      rationale: 'Insufficient context for alignment check — pass-through',
    };
  }

  const proposed = SOVEREIGN_LAWS.find(l => l.id === proposed_law_id);
  if (!proposed) {
    return {
      approved: true,
      final_law_id: null,
      alignment_verified: false,
      re_routed: false,
      rationale: `Law ${proposed_law_id} not found in Vaulturex Codex`,
    };
  }

  // Core v0.1: if law pillar !== weakest pillar, re-route to correct pillar
  if (proposed.pillar !== weakest_pillar) {
    const correct = SOVEREIGN_LAWS
      .filter(l => l.pillar === weakest_pillar)
      .sort((a, b) => a.id - b.id)[0] ?? proposed;

    return {
      approved:           true,
      final_law_id:       correct.id,
      alignment_verified: true,
      re_routed:          true,
      rationale: `Pillar mismatch: Law ${proposed_law_id} targets ${proposed.pillar}, weakest is ${weakest_pillar}. Re-routed to Law ${correct.id} (${correct.name}).`,
    };
  }

  return {
    approved:           true,
    final_law_id:       proposed_law_id,
    alignment_verified: true,
    re_routed:          false,
    rationale: `Law ${proposed_law_id} (${proposed.name}) correctly targets ${weakest_pillar} pillar.`,
  };
}
