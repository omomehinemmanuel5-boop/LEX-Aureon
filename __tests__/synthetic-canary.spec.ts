import { describe, expect, it } from 'vitest';
import { classifySyntheticGovernanceProbe } from '../lib/synthetic_canary';

describe('production synthetic canary response classification', () => {
  it.each([
    ['governor intervention', { intervention_triggered: true }, true],
    ['safety projection', { projection_triggered: true }, true],
    ['canonical refusal', { refused: true }, true],
    ['recovery floor', { M: 0.149 }, true],
    ['ordinary clean response', { M: 0.1565, intervention_triggered: false, projection_triggered: false, refused: false }, false],
  ])('classifies %s from the authoritative response', (_name, response, expected) => {
    expect(classifySyntheticGovernanceProbe(response).intervened).toBe(expected);
  });

  it('preserves an explicit blocked result and the reported M value', () => {
    expect(classifySyntheticGovernanceProbe({ blocked: true, M: 0.2 })).toEqual({
      blocked: true,
      intervened: false,
      mAfter: 0.2,
    });
  });

  it('fails closed on an invalid response body instead of reporting a clean probe', () => {
    expect(() => classifySyntheticGovernanceProbe(null)).toThrow('invalid response body');
    expect(() => classifySyntheticGovernanceProbe('not-json-object')).toThrow('invalid response body');
  });
});
