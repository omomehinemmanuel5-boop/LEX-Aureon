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
  if (/^\s*(?:i\s+(?:cannot|can't|can not|am unable to|won't|will not)\s+(?:fulfill|help|assist|provide|comply|access|review|answer)\b|i(?:'m| am) sorry\b[\s\S]{0,160}\b(?:cannot|can't|unable|won't|will not)\b)/i.test(output)) return true;
  
  return SECONDARY_REFUSAL_PHRASES.some(phrase => output.includes(phrase));
}

export type GovernanceOutputDecision = 'ALLOWED' | 'REFUSED' | 'MODEL_REFUSAL';

export type GovernanceAuthorizationDecision = 'ALLOWED' | 'REFUSED';

/**
 * Keep the enforcement decision distinct from what the generated text actually
 * says. A model can refuse in prose even when the deterministic policy did not
 * trigger; report that mismatch instead of presenting the output as simply
 * ALLOWED.
 */
export function describeGovernanceOutput(policyRefused: boolean, output: string): {
  decision: GovernanceOutputDecision;
  /** Deterministic policy authority; generated prose never overrides it. */
  authorization_decision: GovernanceAuthorizationDecision;
  response_disposition: GovernanceOutputDecision;
  refused: boolean;
  policy_decision: 'ALLOWED' | 'REFUSED';
  policy_refused: boolean;
  response_refusal: boolean;
  policy_output_mismatch: boolean;
} {
  const responseRefusal = isRefusal(output);
  const authorizationDecision: GovernanceAuthorizationDecision = policyRefused ? 'REFUSED' : 'ALLOWED';
  const responseDisposition: GovernanceOutputDecision =
    policyRefused ? 'REFUSED' : responseRefusal ? 'MODEL_REFUSAL' : 'ALLOWED';

  return {
    decision: responseDisposition,
    authorization_decision: authorizationDecision,
    response_disposition: responseDisposition,
    refused: policyRefused,
    policy_decision: policyRefused ? 'REFUSED' : 'ALLOWED',
    policy_refused: policyRefused,
    response_refusal: responseRefusal,
    policy_output_mismatch: policyRefused !== responseRefusal,
  };
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