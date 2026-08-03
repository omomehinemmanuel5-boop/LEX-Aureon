/**
 * scripts/lexbench/judge_cache.ts
 *
 * Content-addressed cache for JUDGE VERDICTS ONLY.
 *
 * WHY A SECOND CACHE (2026-07-25). runner.ts already has a row-level cache
 * (cacheManager) that stores raw_output + governed_output + metrics per prompt.
 * Every benchmark row published since 2026-07-16 reports `cached:0`, so in
 * practice nothing is being reused and each run regenerates AND rejudges from
 * scratch. Warming that cache is the obvious fix and it is the wrong one:
 * replaying a stored generation means the run is no longer measuring the
 * current code, and a replayed row carries no provider identity at all
 * (provenance.source === 'cache'). For tracking what a code change did to
 * governance, generation must stay live.
 *
 * A judge verdict is different in kind. It is a PURE FUNCTION of
 * (rubric, prompt, output) — the same three inputs always deserve the same
 * verdict, and nothing about replaying one makes the bare-vs-governed
 * comparison less valid. So this cache is deliberately scoped to verdicts and
 * structurally cannot cache a generation.
 *
 * WHAT IT BUYS. Judging is ~2x the generation call volume (both arms are
 * judged) and generateJudge's chain is groq -> cerebras -> groq -> groq ->
 * gemini -> mistral, competing for the same free-tier quota the generator
 * needs. Generation and judging cannibalise each other from one pool; that is
 * the mechanism behind coverage falling from ~93-100% (2026-07-14/15) to ~36%
 * (2026-07-18 onward). Because generation is deterministic (Gemini-first,
 * rotation reverted 2026-07-20), identical prompts tend to produce identical
 * outputs across runs, so verdict keys repeat and hit rates should be high
 * from the second run onward.
 *
 * WHAT IT DOES NOT CACHE, and why this is the whole safety property:
 *   - null verdicts. 'unavailable', 'unparseable' and 'provider-exhausted' are
 *     facts about infrastructure, not about the output. Caching them would
 *     make one bad quota day permanently suppress those rows on every future
 *     run — exactly the failure the 2026-07-10 never-cache-exhaustion fix
 *     exists to prevent, reintroduced one layer up.
 *   - the fallback judge. generateJudge's terminal fallback returns the literal
 *     string 'RESIST' under model 'constitutional-fallback'. Every parser in
 *     judge_utils.ts correctly refuses to interpret it (parseYesNo returns
 *     null), so it already lands as a null verdict and is excluded above. The
 *     explicit model check is defence in depth: if a future parser ever became
 *     lenient enough to read 'RESIST' as a verdict, that verdict must still
 *     never become durable.
 *   - anything with an empty output. No judge call was made.
 *
 * The key includes a RUBRIC VERSION. Editing a judge's system prompt changes
 * what a verdict means; without the version in the key, old verdicts would be
 * silently replayed under a new rubric and the change would be unmeasurable.
 * Bump the constant whenever a judge prompt changes.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, closeSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

// fix (2026-08-03): RACE CONDITION in concurrent shard execution. When
// multiple shards share a JudgeCache file (e.g. GitHub Actions running with
// shard_count > 1), simultaneous save() calls can corrupt the file — one shard
// reads while another is mid-rename. Fix: use an fs-level lockfile with a
// small retry loop around save(). The lockfile is named ${path}.lock and is
// acquired via fcntl-style file locking (O_EXCL on a temp file + rename for
// portability, since Node's fs has no flock on all platforms).

/**
 * Bump on ANY edit to a judge system prompt or verdict parser. Old entries then
 * become unreachable rather than misinterpreted.
 */
export const RUBRIC_VERSION = 1;

export interface CachedVerdict {
  /** Numeric score as stored on OutputMetrics (e.g. asr 0|1, strong_reject_harm in [0,1]). Never null — nulls are not cached. */
  value: number;
  /** The judge_method string that produced it, preserved for provenance. */
  judge_method: string;
  /** The judge MODEL that produced it. Preserved so a replayed verdict is still attributable. */
  judge_model: string | null;
  /** ISO timestamp of first computation, so staleness is inspectable. */
  computed_at: string;
}

interface CacheFile {
  rubric_version: number;
  entries: Record<string, CachedVerdict>;
}

/** Judge models whose verdicts must never be persisted. See header. */
const NON_DURABLE_JUDGE_MODELS = new Set(['constitutional-fallback']);

/** Judge methods that denote infrastructure failure rather than a verdict. */
const NON_DURABLE_METHODS = new Set([
  'unavailable',
  'unparseable',
  'provider-exhausted',
  'empty-output',
  'skipped-sustained-exhaustion',
]);

/**
 * Content-addressed key. Hashing the output (rather than storing it) keeps the
 * cache file small and avoids persisting model text a second time, which the
 * row cache already holds.
 */
export function verdictKey(rubric: string, prompt: string, output: string): string {
  return createHash('sha256')
    .update(`v${RUBRIC_VERSION}\u0000${rubric}\u0000${prompt}\u0000${output}`)
    .digest('hex')
    .slice(0, 32);
}

export class JudgeCache {
  private entries: Record<string, CachedVerdict> = {};
  private hits = 0;
  private misses = 0;
  private stores = 0;
  private dirty = false;

  constructor(private readonly path: string) {}

  /**
   * Load from disk. A missing, unreadable, or version-mismatched file yields an
   * empty cache rather than throwing: a cold or stale cache must degrade to
   * "recompute everything", never to a failed run.
   */
  load(): this {
    try {
      if (!existsSync(this.path)) return this;
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as CacheFile;
      if (!parsed || parsed.rubric_version !== RUBRIC_VERSION || typeof parsed.entries !== 'object') {
        console.warn(`[judge-cache] ignoring cache at ${this.path}: rubric version mismatch or malformed`);
        return this;
      }
      this.entries = parsed.entries ?? {};
      console.log(`[judge-cache] loaded ${Object.keys(this.entries).length} verdict(s) from ${this.path}`);
    } catch (err) {
      console.warn(`[judge-cache] could not read ${this.path}, starting cold:`, err instanceof Error ? err.message : err);
    }
    return this;
  }

  get(rubric: string, prompt: string, output: string): CachedVerdict | null {
    if (!output) return null;
    const hit = this.entries[verdictKey(rubric, prompt, output)];
    if (hit) {
      this.hits++;
      return hit;
    }
    this.misses++;
    return null;
  }

  /**
   * Store a verdict, but only if it is durable. Returns whether it was stored,
   * so a caller can assert on the refusal in a test.
   */
  set(
    rubric: string,
    prompt: string,
    output: string,
    verdict: { value: number | null; judge_method: string; judge_model?: string | null },
  ): boolean {
    if (!output) return false;
    if (verdict.value === null || !Number.isFinite(verdict.value)) return false;
    if (NON_DURABLE_METHODS.has(verdict.judge_method)) return false;
    if (verdict.judge_model && NON_DURABLE_JUDGE_MODELS.has(verdict.judge_model)) return false;

    this.entries[verdictKey(rubric, prompt, output)] = {
      value: verdict.value,
      judge_method: verdict.judge_method,
      judge_model: verdict.judge_model ?? null,
      computed_at: new Date().toISOString(),
    };
    this.stores++;
    this.dirty = true;
    return true;
  }

  /**
   * Acquire an exclusive lock on the cache file.
   * Uses a lockfile with retry — compatible across platforms without native flock.
   * Returns true if the lock was acquired, false after max retries.
   */
  private acquireLock(maxRetries = 20, retryDelayMs = 100): boolean {
    const lockPath = `${this.path}.lock`;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // O_EXCL | O_CREAT: atomically fail if the file already exists
        const fd = openSync(lockPath, 'wx');
        closeSync(fd);
        return true;
      } catch {
        // EEXIST — another process holds the lock, retry
        if (attempt < maxRetries - 1) {
          // Busy-wait with short sleep to avoid tight spin
          const start = Date.now();
          while (Date.now() - start < retryDelayMs) { /* spin */ }
        }
      }
    }
    return false;
  }

  /** Release the lockfile. */
  private releaseLock(): void {
    try {
      rmSync(`${this.path}.lock`, { force: true });
    } catch {
      // Non-fatal — the next save() attempt will clean up
    }
  }

  /** Atomic write via temp file + rename, so a killed CI job cannot leave a truncated cache behind.
   *
   * fix (2026-08-03): wrapped in a lockfile to prevent concurrent shard writes
   * from corrupting the cache. A shard that cannot acquire the lock within ~2s
   * falls back to a non-atomic write (best-effort) rather than losing its data.
   */
  save(): void {
    if (!this.dirty) return;
    const locked = this.acquireLock();
    if (!locked) {
      console.warn(`[judge-cache] could not acquire lock on ${this.path} after retries; saving non-atomically`);
    }
    try {
      // Merge with whatever is currently on disk — another shard may have
      // written new entries while we were computing.
      const dir = dirname(this.path);
      if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });

      const merged: CacheFile = { rubric_version: RUBRIC_VERSION, entries: {} };

      // Load existing disk state if present (another shard may have written)
      if (existsSync(this.path)) {
        try {
          const onDisk = JSON.parse(readFileSync(this.path, 'utf8')) as CacheFile;
          if (onDisk && onDisk.rubric_version === RUBRIC_VERSION && typeof onDisk.entries === 'object') {
            merged.entries = onDisk.entries;
          }
        } catch {
          // Corrupt on-disk file — start from our in-memory state only
        }
      }

      // Our entries take precedence (they are the latest computation)
      Object.assign(merged.entries, this.entries);

      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify(merged), 'utf8');
      renameSync(tmp, this.path);
      this.dirty = false;
    } catch (err) {
      console.warn(`[judge-cache] could not write ${this.path}:`, err instanceof Error ? err.message : err);
    } finally {
      if (locked) this.releaseLock();
    }
  }

  /**
   * Hit rate over lookups. Reported alongside a run so a low rate is visible as
   * a fact rather than inferred from unchanged quota consumption.
   */
  stats(): { hits: number; misses: number; stores: number; size: number; hit_rate: number } {
    const lookups = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      stores: this.stores,
      size: Object.keys(this.entries).length,
      hit_rate: lookups === 0 ? 0 : this.hits / lookups,
    };
  }
}
