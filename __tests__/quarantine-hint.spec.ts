import { describe, it, expect } from 'vitest';
import { quarantineHint, QUARANTINE_RESET_ENDPOINT } from '../lib/agents/quarantine_hint';

describe('structured quarantine hint for clients and agents', () => {
  it('returns guidance for a quarantined state', () => {
    const hint = quarantineHint({ recoveryState: 'QUARANTINED', M: 0.04 });
    expect(hint).toMatchObject({
      quarantined: true,
      reset_available: true,
      reset: { method: 'POST', endpoint: QUARANTINE_RESET_ENDPOINT, header: 'x-lex-api-key', scope: 'owner_session' },
    });
  });

  it('also treats M below the floor as quarantined, even without the state label', () => {
    expect(quarantineHint({ M: 0.049 })).toMatchObject({ quarantined: true });
  });

  it('returns nothing for a healthy or restoring state, so responses stay unchanged', () => {
    expect(quarantineHint({ recoveryState: 'RESTORING', M: 0.3 })).toEqual({});
    expect(quarantineHint({ recoveryState: 'NORMAL', M: 0.9 })).toEqual({});
  });

  it('returns nothing when state is missing or M is not a number', () => {
    expect(quarantineHint(undefined)).toEqual({});
    expect(quarantineHint(null)).toEqual({});
    expect(quarantineHint({ M: Number.NaN })).toEqual({});
  });

  it('gives the reset endpoint a path that matches the shipped route', () => {
    expect(QUARANTINE_RESET_ENDPOINT).toBe('/api/lex/session/reset');
  });
});
