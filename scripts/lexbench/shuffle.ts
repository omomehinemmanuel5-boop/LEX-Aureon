/**
 * scripts/lexbench/shuffle.ts
 *
 * Deterministic seeded shuffle for benchmark prompt order.
 *
 * WHY THIS EXISTS (2026-07-25). runner.ts ran prompts in dataset order
 * (`promptsToRun = prompts`, sharded with a contiguous `prompts.slice()`).
 * That was harmless while runs completed. It stopped being harmless on
 * 2026-07-17, when the sustained-exhaustion circuit breaker began marking the
 * REMAINDER of a run 'skipped' once quota ran out: truncating the tail of a
 * dataset-ordered list means the scored subset is the dataset's PREFIX, not a
 * sample of it.
 *
 * Measured consequence: coverage fell from ~93-100% (2026-07-14/15) to ~36%
 * (2026-07-18 onward) across XSTest, StrongREJECT, AgentDojo and AdvBench. For
 * a category-organized dataset like XSTest a prefix covers only the first few
 * categories, so a governed score computed over it is a statistic about those
 * categories — not about the benchmark. XSTest governed appropriate_pct moved
 * 97.2 -> 86.8 over exactly that window, and prefix truncation is currently
 * indistinguishable from a real over-refusal regression as an explanation.
 *
 * Shuffling with a FIXED seed makes truncation an unbiased random subsample
 * while keeping the run reproducible: the same seed replays the same order, so
 * a cache lookup, a re-run, and a recovery aggregation all see one ordering.
 * It does not recover coverage — only paid capacity or the judge-verdict cache
 * does that — it makes the coverage you DO get interpretable.
 *
 * Deliberately dependency-free and pure: no Math.random (unseeded order would
 * make two runs incomparable and defeat the point), no imports, no I/O.
 */

/**
 * mulberry32 — small, fast, well-distributed 32-bit PRNG. Chosen over an LCG
 * because low-bit correlation in an LCG shows up as position bias after
 * Fisher-Yates, which is precisely the artifact this module exists to remove.
 * Returns a generator producing floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive a stable 32-bit seed from a string (FNV-1a). Lets a caller seed from
 * something meaningful and reproducible — e.g. the benchmark name, or a
 * `${benchmark}:${run_date}` pair — instead of a magic integer, without the
 * seed drifting between processes the way a hashed object identity would.
 */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Fisher-Yates over a COPY, driven by a seeded PRNG. Pure: the input array is
 * never mutated, so a caller that also needs original dataset order (for
 * reporting which prompt IDs a truncated run actually covered) still has it.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Convenience wrapper for the runner's call site: shuffle a benchmark's prompt
 * list under a seed derived from the benchmark name plus an explicit run seed.
 * Two different benchmarks get different orders under the same run seed (so a
 * shared quota outage does not truncate every dataset at the same categories),
 * while one benchmark's order is fixed for a given run seed.
 */
export function shuffleForBenchmark<T>(
  items: readonly T[],
  benchmarkName: string,
  runSeed: number,
): T[] {
  return seededShuffle(items, seedFromString(`${benchmarkName}:${runSeed}`) >>> 0);
}
