import { CONSTITUTION } from '../constitution';

export const QUARANTINE_RESET_ENDPOINT = '/api/lex/session/reset';

/**
 * Structured quarantine guidance for clients and agents. Returns no fields for
 * a session that is not quarantined, so healthy responses are unchanged.
 * An agent holding the owner's key can read `reset.endpoint` and call it, then
 * retry the same request. No human step is required.
 */
export function quarantineHint(
  state: { recoveryState?: string; M?: number } | null | undefined,
): Record<string, unknown> {
  if (!state) return {};
  const belowFloor = typeof state.M === 'number' && Number.isFinite(state.M) && state.M < CONSTITUTION.TAU_FLOOR;
  const quarantined = state.recoveryState === 'QUARANTINED' || belowFloor;
  if (!quarantined) return {};
  return {
    quarantined: true,
    reset_available: true,
    reset: {
      method: 'POST',
      endpoint: QUARANTINE_RESET_ENDPOINT,
      header: 'x-lex-api-key',
      scope: 'owner_session',
      note: 'Resets only the calling owner\'s session, using the same API key as this request. Retry the request after a successful reset.',
    },
  };
}
