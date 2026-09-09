/**
 * Runtime policy for dependency failures at the tool-governance boundary.
 *
 * The policy is intentionally conservative: if current constitutional state
 * cannot be read, no tool call should be treated as fully authorized. Read-only
 * callers may be configured for degraded operation, but this default denies
 * until the state source is available again.
 */

export type DependencyFailureRisk = 'read' | 'high_risk';
export type DependencyFailureDecision = 'DENY' | 'ALLOW_DEGRADED_READ';

export interface DependencyFailurePolicyResult {
  decision: DependencyFailureDecision;
  reason: string;
}

export function dependencyFailurePolicy(
  risk: DependencyFailureRisk,
): DependencyFailurePolicyResult {
  if (risk === 'read') {
    return {
      decision: 'DENY',
      reason: 'constitutional_state_unavailable',
    };
  }

  return {
    decision: 'DENY',
    reason: 'constitutional_state_unavailable_high_risk',
  };
}
