import { describe, expect, it } from 'vitest';
import {
  ConstitutionalExecutionCache,
  ConstitutionalExecutionDeniedError,
} from '../lib/agents/constitutional_execution_cache';

type Decision = { allowed: boolean; m: number };

function makeHarness() {
  let decision: Decision = { allowed: true, m: 1 };
  let authorizations = 0;
  let executions = 0;
  let now = 1_000;

  const cache = new ConstitutionalExecutionCache<string, Decision>({
    ttlMs: 100,
    now: () => now,
    isCacheable: (toolName) => toolName === 'read_file',
    authorize: async () => {
      authorizations += 1;
      return decision;
    },
    isApproved: (current) => current.allowed,
  });

  return {
    cache,
    setDecision: (next: Decision) => { decision = next; },
    advance: (ms: number) => { now += ms; },
    counts: () => ({ authorizations, executions }),
    execute: async (value: string) => {
      executions += 1;
      return value;
    },
  };
}

describe('ConstitutionalExecutionCache', () => {
  it('re-authorizes every request while reusing a cached execution result', async () => {
    const h = makeHarness();
    const first = await h.cache.getOrExecute({ key: 'read:a', toolName: 'read_file', execute: () => h.execute('A') });
    const second = await h.cache.getOrExecute({ key: 'read:a', toolName: 'read_file', execute: () => h.execute('A') });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(second.value).toBe('A');
    expect(h.counts()).toEqual({ authorizations: 2, executions: 1 });
  });

  it('cannot reuse a cached result after current authorization becomes unsafe', async () => {
    const h = makeHarness();
    await h.cache.getOrExecute({ key: 'read:a', toolName: 'read_file', execute: () => h.execute('A') });
    h.setDecision({ allowed: false, m: 0.05 });

    await expect(h.cache.getOrExecute({ key: 'read:a', toolName: 'read_file', execute: () => h.execute('A') }))
      .rejects.toBeInstanceOf(ConstitutionalExecutionDeniedError);
    expect(h.counts()).toEqual({ authorizations: 2, executions: 1 });
  });

  it('never caches non-cacheable operations', async () => {
    const h = makeHarness();
    const first = await h.cache.getOrExecute({ key: 'write:a', toolName: 'write_file', execute: () => h.execute('W') });
    const second = await h.cache.getOrExecute({ key: 'write:a', toolName: 'write_file', execute: () => h.execute('W') });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(false);
    expect(h.counts()).toEqual({ authorizations: 2, executions: 2 });
  });

  it('re-executes an expired cache entry after re-authorization', async () => {
    const h = makeHarness();
    await h.cache.getOrExecute({ key: 'read:a', toolName: 'read_file', execute: () => h.execute('A') });
    h.advance(101);
    const second = await h.cache.getOrExecute({ key: 'read:a', toolName: 'read_file', execute: () => h.execute('B') });

    expect(second.cacheHit).toBe(false);
    expect(second.value).toBe('B');
    expect(h.counts()).toEqual({ authorizations: 2, executions: 2 });
  });
});
