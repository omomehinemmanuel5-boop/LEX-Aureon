import { describe, expect, it } from 'vitest';
import { dependencyFailurePolicy } from '../lib/agents/dependency_failure_policy';

describe('dependency failure policy', () => {
  it('denies read operations when state is unavailable by default', () => {
    expect(dependencyFailurePolicy('read')).toEqual({
      decision: 'DENY',
      reason: 'constitutional_state_unavailable',
    });
  });

  it('denies high-risk operations with an explicit high-risk reason', () => {
    expect(dependencyFailurePolicy('high_risk')).toEqual({
      decision: 'DENY',
      reason: 'constitutional_state_unavailable_high_risk',
    });
  });
});
