export interface SyntheticGovernanceProbeResponse {
  blocked?: unknown;
  intervention_triggered?: unknown;
  projection_triggered?: unknown;
  refused?: unknown;
  M?: unknown;
}

/**
 * Interpret the canonical /api/lex/govern response used by the production
 * synthetic canary. Do not infer an outcome from a second, independent
 * generator/CRS-extractor run: that would test a different pipeline.
 */
export function classifySyntheticGovernanceProbe(value: unknown): {
  blocked: boolean;
  intervened: boolean;
  mAfter?: number;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Governance endpoint returned an invalid response body.');
  }

  const response = value as SyntheticGovernanceProbeResponse;
  const mAfter = typeof response.M === 'number' && Number.isFinite(response.M)
    ? response.M
    : undefined;

  return {
    blocked: response.blocked === true,
    intervened: response.intervention_triggered === true
      || response.projection_triggered === true
      || response.refused === true
      || (mAfter !== undefined && mAfter < 0.15),
    ...(mAfter !== undefined ? { mAfter } : {}),
  };
}
