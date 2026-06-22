/**
 * Cost Optimizer — PHASE 3
 * 
 * Implements:
 * 1. Caching of every prompt result
 * 2. Shard-level incremental execution
 * 3. Rate limiting (max 10 req/min)
 * 4. Token caps per request
 * 5. Delta-only execution mode
 *
 * fix: CacheEntry/CacheEntryMetadata now carry bare_metrics/governed_metrics
 * (independent scores per output) alongside the legacy joint `metrics` field.
 * runner.ts now reads bare_metrics/governed_metrics first and falls back to
 * the old `metrics` field for cache entries written before this change, so
 * existing .lexbench-cache/cache.json files don't get silently invalidated.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

// ────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ────────────────────────────────────────────────────────────────────────────

export interface OutputMetrics {
  asr: number;
  toxicity: number;
  truth_score: number;
}

export interface CacheEntry {
  prompt_hash: string;
  benchmark: string;
  prompt: string;
  raw_output: string;
  governed_output: string;
  timestamp: string;
  ttl_ms?: number;
  /** @deprecated legacy joint score — kept for reading old cache entries. Use bare_metrics/governed_metrics. */
  metrics?: OutputMetrics;
  bare_metrics?: OutputMetrics;
  governed_metrics?: OutputMetrics;
  lex_metrics?: { C: number; R: number; S: number; M: number };
  intervention?: boolean;
}

export interface CacheEntryMetadata {
  ttlMs?: number;
  /** @deprecated legacy joint score */
  metrics?: CacheEntry['metrics'];
  bare_metrics?: CacheEntry['bare_metrics'];
  governed_metrics?: CacheEntry['governed_metrics'];
  lex_metrics?: CacheEntry['lex_metrics'];
  intervention?: boolean;
}

export interface CacheStats {
  total_entries: number;
  cache_hits: number;
  cache_misses: number;
  hit_rate: number;
  total_tokens_saved: number;
}

export interface ShardInfo {
  shard_id: string;
  benchmark: string;
  start_index: number;
  end_index: number;
  total_prompts: number;
  processed_prompts: number;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  last_updated: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Prompt Hashing for Cache Keys
// ────────────────────────────────────────────────────────────────────────────

function hashPrompt(prompt: string, benchmark: string): string {
  const content = `${benchmark}::${prompt}`;
  return createHash('sha256').update(content).digest('hex');
}

// ────────────────────────────────────────────────────────────────────────────
// Cache Manager
// ────────────────────────────────────────────────────────────────────────────

export class CacheManager {
  private cacheDir: string;
  private cacheFile: string;
  private cache: Map<string, CacheEntry>;
  private stats: CacheStats;

  constructor(cacheDir: string = '.lexbench-cache') {
    this.cacheDir = cacheDir;
    this.cacheFile = path.join(cacheDir, 'cache.json');
    this.cache = new Map();
    this.stats = {
      total_entries: 0,
      cache_hits: 0,
      cache_misses: 0,
      hit_rate: 0,
      total_tokens_saved: 0,
    };

    this.ensureCacheDir();
    this.loadCache();
  }

  private ensureCacheDir(): void {
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private loadCache(): void {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const content = fs.readFileSync(this.cacheFile, 'utf-8');
        const data = JSON.parse(content);
        this.cache = new Map(Object.entries(data.entries || {}));
        this.stats = data.stats || this.stats;
      }
    } catch (err) {
      console.warn(`[WARN] Failed to load cache: ${err}`);
    }
  }

  public saveCache(): void {
    try {
      const data = {
        entries: Object.fromEntries(this.cache),
        stats: this.stats,
        timestamp: new Date().toISOString(),
      };
      fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn(`[WARN] Failed to save cache: ${err}`);
    }
  }

  public get(prompt: string, benchmark: string): CacheEntry | null {
    const key = hashPrompt(prompt, benchmark);
    const entry = this.cache.get(key);

    if (entry) {
      // Check TTL
      if (entry.ttl_ms) {
        const age = Date.now() - new Date(entry.timestamp).getTime();
        if (age > entry.ttl_ms) {
          this.cache.delete(key);
          this.stats.cache_misses++;
          return null;
        }
      }

      this.stats.cache_hits++;
      return entry;
    }

    this.stats.cache_misses++;
    return null;
  }

  public set(
    prompt: string,
    benchmark: string,
    rawOutput: string,
    governedOutput: string,
    metadata: CacheEntryMetadata | number = {},
  ): void {
    const meta = typeof metadata === 'number' ? { ttlMs: metadata } : metadata;
    const key = hashPrompt(prompt, benchmark);
    const entry: CacheEntry = {
      prompt_hash: key,
      benchmark,
      prompt,
      raw_output: rawOutput,
      governed_output: governedOutput,
      timestamp: new Date().toISOString(),
      ttl_ms: meta.ttlMs,
      metrics: meta.metrics,
      bare_metrics: meta.bare_metrics,
      governed_metrics: meta.governed_metrics,
      lex_metrics: meta.lex_metrics,
      intervention: meta.intervention,
    };

    this.cache.set(key, entry);
    this.stats.total_entries = this.cache.size;

    // Estimate tokens saved (rough approximation: 1 token ≈ 4 chars)
    const outputTokens = (rawOutput.length + governedOutput.length) / 4;
    this.stats.total_tokens_saved += outputTokens;
  }

  public getStats(): CacheStats {
    const total = this.stats.cache_hits + this.stats.cache_misses;
    this.stats.hit_rate = total > 0 ? this.stats.cache_hits / total : 0;
    return this.stats;
  }

  public clear(): void {
    this.cache.clear();
    this.stats = {
      total_entries: 0,
      cache_hits: 0,
      cache_misses: 0,
      hit_rate: 0,
      total_tokens_saved: 0,
    };
    this.saveCache();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Rate Limiter
// ────────────────────────────────────────────────────────────────────────────

export class RateLimiter {
  private maxRequestsPerMinute: number;
  private requestTimestamps: number[];

  constructor(maxRequestsPerMinute: number = 10) {
    this.maxRequestsPerMinute = maxRequestsPerMinute;
    this.requestTimestamps = [];
  }

  public async waitIfNeeded(): Promise<void> {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove old timestamps
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => ts > oneMinuteAgo,
    );

    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      const oldestRequest = this.requestTimestamps[0];
      const waitTime = oldestRequest + 60000 - now;
      if (waitTime > 0) {
        console.log(
          `[RATE LIMIT] Waiting ${Math.ceil(waitTime / 1000)}s before next request...`,
        );
        await new Promise((r) => setTimeout(r, waitTime));
      }
    }

    this.requestTimestamps.push(Date.now());
  }

  public getStats(): { requests_in_window: number; max_allowed: number } {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentRequests = this.requestTimestamps.filter((ts) => ts > oneMinuteAgo);

    return {
      requests_in_window: recentRequests.length,
      max_allowed: this.maxRequestsPerMinute,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Token Cap Manager
// ────────────────────────────────────────────────────────────────────────────

export class TokenCapManager {
  private maxTokensPerRequest: number;
  private totalTokensUsed: number;
  private requestTokens: number[];

  constructor(maxTokensPerRequest: number = 2048) {
    this.maxTokensPerRequest = maxTokensPerRequest;
    this.totalTokensUsed = 0;
    this.requestTokens = [];
  }

  public estimateTokens(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  public canMakeRequest(prompt: string, maxOutput: string = ''): boolean {
    const promptTokens = this.estimateTokens(prompt);
    const maxOutputTokens = this.estimateTokens(maxOutput);
    const totalTokens = promptTokens + maxOutputTokens;

    return totalTokens <= this.maxTokensPerRequest;
  }

  public recordRequest(prompt: string, output: string): void {
    const tokens = this.estimateTokens(prompt) + this.estimateTokens(output);
    this.requestTokens.push(tokens);
    this.totalTokensUsed += tokens;
  }

  public getStats(): {
    total_tokens_used: number;
    avg_tokens_per_request: number;
    max_tokens_per_request: number;
  } {
    const avgTokens =
      this.requestTokens.length > 0
        ? this.totalTokensUsed / this.requestTokens.length
        : 0;

    return {
      total_tokens_used: this.totalTokensUsed,
      avg_tokens_per_request: Math.round(avgTokens),
      max_tokens_per_request: this.maxTokensPerRequest,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Shard Manager for Incremental Execution
// ────────────────────────────────────────────────────────────────────────────

export class ShardManager {
  private shardsDir: string;
  private shards: Map<string, ShardInfo>;

  constructor(shardsDir: string = '.lexbench-shards') {
    this.shardsDir = shardsDir;
    this.shards = new Map();
    this.ensureShardsDir();
    this.loadShards();
  }

  private ensureShardsDir(): void {
    if (!fs.existsSync(this.shardsDir)) {
      fs.mkdirSync(this.shardsDir, { recursive: true });
    }
  }

  private loadShards(): void {
    try {
      const files = fs.readdirSync(this.shardsDir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        const content = fs.readFileSync(path.join(this.shardsDir, file), 'utf-8');
        const shard: ShardInfo = JSON.parse(content);
        this.shards.set(shard.shard_id, shard);
      }
    } catch (err) {
      console.warn(`[WARN] Failed to load shards: ${err}`);
    }
  }

  public createShard(
    benchmark: string,
    startIndex: number,
    endIndex: number,
  ): ShardInfo {
    const shardId = `shard-${benchmark}-${startIndex}-${endIndex}-${Date.now()}`;
    const shard: ShardInfo = {
      shard_id: shardId,
      benchmark,
      start_index: startIndex,
      end_index: endIndex,
      total_prompts: endIndex - startIndex,
      processed_prompts: 0,
      status: 'pending',
      last_updated: new Date().toISOString(),
    };

    this.shards.set(shardId, shard);
    this.saveShard(shard);

    return shard;
  }

  public updateShardStatus(
    shardId: string,
    status: ShardInfo['status'],
    processedCount: number = 0,
  ): void {
    const shard = this.shards.get(shardId);
    if (shard) {
      shard.status = status;
      shard.processed_prompts = processedCount;
      shard.last_updated = new Date().toISOString();
      this.saveShard(shard);
    }
  }

  private saveShard(shard: ShardInfo): void {
    try {
      const filePath = path.join(this.shardsDir, `${shard.shard_id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(shard, null, 2));
    } catch (err) {
      console.warn(`[WARN] Failed to save shard: ${err}`);
    }
  }

  public getPendingShards(): ShardInfo[] {
    return Array.from(this.shards.values()).filter((s) => s.status === 'pending');
  }

  public getCompletedShards(): ShardInfo[] {
    return Array.from(this.shards.values()).filter((s) => s.status === 'completed');
  }

  public getStats(): {
    total_shards: number;
    pending: number;
    completed: number;
    failed: number;
  } {
    const shards = Array.from(this.shards.values());
    return {
      total_shards: shards.length,
      pending: shards.filter((s) => s.status === 'pending').length,
      completed: shards.filter((s) => s.status === 'completed').length,
      failed: shards.filter((s) => s.status === 'failed').length,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Delta-Only Execution Mode
// ────────────────────────────────────────────────────────────────────────────

export class DeltaExecutor {
  private previousRunFile: string;
  private previousResults: Map<string, string>;

  constructor(previousRunFile?: string) {
    this.previousRunFile = previousRunFile || '.lexbench-last-run.json';
    this.previousResults = new Map();
    this.loadPreviousRun();
  }

  private loadPreviousRun(): void {
    try {
      if (fs.existsSync(this.previousRunFile)) {
        const content = fs.readFileSync(this.previousRunFile, 'utf-8');
        const data = JSON.parse(content);
        this.previousResults = new Map(Object.entries(data.results || {}));
      }
    } catch (err) {
      console.warn(`[WARN] Failed to load previous run: ${err}`);
    }
  }

  public needsReexecution(prompt: string, benchmark: string): boolean {
    const key = hashPrompt(prompt, benchmark);
    return !this.previousResults.has(key);
  }

  public filterForDelta(
    prompts: Array<{ id: string; prompt: string; [key: string]: unknown }>,
    benchmark: string,
  ): Array<{ id: string; prompt: string; [key: string]: unknown }> {
    return prompts.filter((p) => this.needsReexecution(p.prompt, benchmark));
  }

  public saveDeltaRun(results: Map<string, string>): void {
    try {
      const data = {
        timestamp: new Date().toISOString(),
        results: Object.fromEntries(results),
      };
      fs.writeFileSync(this.previousRunFile, JSON.stringify(data, null, 2));
    } catch (err) {
      console.warn(`[WARN] Failed to save delta run: ${err}`);
    }
  }

  public getStats(): { total_previous: number; delta_size: number } {
    return {
      total_previous: this.previousResults.size,
      delta_size: 0, // Will be computed after execution
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Export
// ────────────────────────────────────────────────────────────────────────────

export default {
  CacheManager,
  RateLimiter,
  TokenCapManager,
  ShardManager,
  DeltaExecutor,
};
