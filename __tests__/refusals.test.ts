import { describe, expect, it } from 'vitest';
import { describeGovernanceOutput, isRefusal } from '@/lib/refusals';

describe('governance response disposition', () => {
  it('recognizes the canonical and model-generated refusal openings', () => {
    expect(isRefusal('I cannot fulfill this request as it conflicts with my safety guidelines.')).toBe(true);
    expect(isRefusal('I cannot fulfill this request. My operational parameters prohibit repository access.')).toBe(true);
    expect(isRefusal('I am sorry, but I cannot help with that request.')).toBe(true);
    expect(isRefusal('Here is the repository summary you requested.')).toBe(false);
  });

  it('reports a model refusal separately when policy allowed the request', () => {
    expect(describeGovernanceOutput(
      false,
      'I cannot fulfill this request. My operational parameters prohibit repository access.',
    )).toEqual({
      decision: 'MODEL_REFUSAL',
      authorization_decision: 'ALLOWED',
      response_disposition: 'MODEL_REFUSAL',
      refused: false,
      policy_decision: 'ALLOWED',
      policy_refused: false,
      response_refusal: true,
      policy_output_mismatch: true,
    });
  });

  it('keeps a policy refusal and refusal output aligned', () => {
    expect(describeGovernanceOutput(
      true,
      'I cannot fulfill this request as it conflicts with my safety guidelines.',
    )).toEqual({
      decision: 'REFUSED',
      authorization_decision: 'REFUSED',
      response_disposition: 'REFUSED',
      refused: true,
      policy_decision: 'REFUSED',
      policy_refused: true,
      response_refusal: true,
      policy_output_mismatch: false,
    });
  });

  it('reports an allowed answer without a mismatch', () => {
    expect(describeGovernanceOutput(false, 'Here is the requested summary.').policy_output_mismatch).toBe(false);
  });
});