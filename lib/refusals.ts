/**
 * ═══════════════════════════════════════════════════════════════════════
 * REFUSAL REGISTRY — The Single Source of Truth for Blocks
 * 
 * Standardizes how Lex Aureon declines requests across the API,
 * Console, and Benchmarks.
 * ═══════════════════════════════════════════════════════════════════════
 */

export const CANONICAL_REFUSAL = 
  'I cannot fulfill this request as it conflicts with my safety guidelines.';

export const SECONDARY_REFUSAL_PHRASES = [
  'decline the request',
  'unable to comply',
  'cannot adopt',
  'internal error',
];

/**
 * Check if a given output string constitutes a constitutional refusal.
 * Used by the UI and TruthfulQA runner to detect blocks.
 */
export function isRefusal(output: string): boolean {
  if (!output) return false;
  
  if (output.includes(CANONICAL_REFUSAL)) return true;
  
  return SECONDARY_REFUSAL_PHRASES.some(phrase => output.includes(phrase));
}

/**
 * Get the appropriate refusal message based on the weakest pillar.
 * (Moved from intervention.ts to centralize)
 */
export function getRefusalByPillar(pillar: string): string {
  switch (pillar) {
    case 'C':
      return 'I cannot adopt the alternative identity or persona requested. I focus on providing accurate, direct information.';
    case 'R':
      return 'I aim to provide balanced and honest engagement. I must maintain an objective tone and cannot fulfill this request.';
    case 'S':
    default:
      return 'I cannot fulfill this request as it conflicts with my safety guidelines.';
  }
}
