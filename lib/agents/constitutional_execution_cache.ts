/**
 * Constitutional execution cache.
 *
 * IMPORTANT: authorization is intentionally outside the cache.
 * A cached execution result may be reused, but constitutional authorization
 * must be recomputed for every tool request so a session's current state can
 * tighten or deny access after an earlier approval.
 */

export interface ConstitutionalCacheEntry<T> {
  value: T;
  cachedAt: number;
}

export interface ConstitutionalExecutionCacheOptions<TDecision> {
  ttlMs: number;
  now?: () => number;
  isCacheable: (toolName: string) => boolean;
  authorize: (toolName: string) => Promise<TDecision>;
  isApproved: (decision: TDecision) => boolean;
}

export interface ConstitutionalExecutionResult<T, TDecision> {
  decision: TDecision;
  value: T;
  cacheHit: boolean;
}

/**
 * Reuse execution results without reusing authorization decisions.
 *
 * The caller remains responsible for recording an audit receipt for every
 * authorization decision, including cache hits.
 */
export class ConstitutionalExecutionCache<T, TDecision> {
  private readonly entries = new Map<string, ConstitutionalCacheEntry<T>>();
  private readonly now: () => number;

  constructor(private readonly options: ConstitutionalExecutionCacheOptions<TDecision>) {
    this.now = options.now ?? Date.now;
  }

  async getOrExecute(params: {
    key: string;
    toolName: string;
    execute: () => Promise<T>;
  }): Promise<ConstitutionalExecutionResult<T, TDecision>> {
    // Authorization is deliberately evaluated BEFORE cache lookup.
    const decision = await this.options.authorize(params.toolName);

    if (!this.options.isApproved(decision)) {
      throw new ConstitutionalExecutionDeniedError(decision);
    }

    if (this.options.isCacheable(params.toolName)) {
      const entry = this.entries.get(params.key);
      if (entry && this.now() - entry.cachedAt < this.options.ttlMs) {
        return { decision, value: entry.value, cacheHit: true };
      }
      this.entries.delete(params.key);
    }

    const value = await params.execute();

    if (this.options.isCacheable(params.toolName)) {
      this.entries.set(params.key, { value, cachedAt: this.now() });
    }

    return { decision, value, cacheHit: false };
  }

  clear(): void {
    this.entries.clear();
  }
}

export class ConstitutionalExecutionDeniedError<TDecision> extends Error {
  constructor(public readonly decision: TDecision) {
    super('Tool execution denied by constitutional governance.');
    this.name = 'ConstitutionalExecutionDeniedError';
  }
}
