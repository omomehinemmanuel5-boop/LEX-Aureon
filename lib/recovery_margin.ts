/**
 * Recovery boundary for post-measurement CRS updates.
 *
 * Healthy baselines must not be pushed below the normal-operation threshold.
 * If recovery starts below that threshold, a single turn must not worsen the
 * saved margin; the recovery controller remains responsible for raising it.
 */
export type RecoveryCRS = { C: number; R: number; S: number };

/**
 * Use the persisted CRS when available; otherwise use the actual in-memory
 * kernel state at the start of this turn. A fresh session begins at neutral
 * CRS, so absence of a database row must not disable the recovery guard.
 */
export function getRecoveryBaselineState(
  savedState: RecoveryCRS | null,
  runtimeState: RecoveryCRS,
): RecoveryCRS {
  return { ...(savedState ?? runtimeState) };
}

export function getRecoveryMinimumM(baselineM: number | null): number | null {
  return baselineM === null ? null : Math.min(baselineM, 0.15);
}
