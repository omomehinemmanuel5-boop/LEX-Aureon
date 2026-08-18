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

export class ConstitutionalExecutionCache<T, TDecision> {
  private readonly entries = new Map<string, ConstitutionalCacheEntry<T>>();
  private readonly now: () => number;

  constructor(private readonly options: ConstitutionalExecutionCacheOptions<TDecision>) {
    this.now = options.now ?? Date.now;
  }

  /** Full path: authorize now, then consult the execution cache. */
  async getOrExecute(params: {
    key: string;
    toolName: string;
    execute: () => Promise<T>;
  }): Promise<ConstitutionalExecutionResult<T, TDecision>> {
    const decision = await this.options.authorize(params.toolName);
    return this.getOrExecuteAuthorized({ ...params, decision });
  }

  /**
   * Integration path for callers that already performed complete authorization
   * with the full tool request. This method never performs authorization and
   * never reads a cached authorization decision.
   */
  async getOrExecuteAuthorized(params: {
    key: string;
    toolName: string;
    decision: TDecision;
    execute: () => Promise<T>;
  }): Promise<ConstitutionalExecutionResult<T, TDecision>> {
    if (!this.options.isApproved(params.decision)) {
      throw new ConstitutionalExecutionDeniedError(params.decision);
    }

    if (this.options.isCacheable(params.toolName)) {
      const entry = this.entries.get(params.key);
      if (entry && this.now() - entry.cachedAt < this.options.ttlMs) {
        return { decision: params.decision, value: entry.value, cacheHit: true };
      }
      this.entries.delete(params.key);
    }

    const value = await params.execute();

    if (this.options.isCacheable(params.toolName)) {
      this.entries.set(params.key, { value, cachedAt: this.now() });
    }

    return { decision: params.decision, value, cacheHit: false };
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
