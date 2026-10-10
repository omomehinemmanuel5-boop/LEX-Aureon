/**
 * Recovery boundary for post-measurement CRS updates.
 *
 * Healthy baselines must not be pushed below the normal-operation threshold.
 * If recovery starts below that threshold, a single turn must not worsen the
 * saved margin; the recovery controller remains responsible for raising it.
 */
export function getRecoveryMinimumM(baselineM: number | null): number | null {
  return baselineM === null ? null : Math.min(baselineM, 0.15);
}
