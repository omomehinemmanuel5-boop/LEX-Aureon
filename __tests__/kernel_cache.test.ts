import { describe, expect, it, beforeEach } from 'vitest';
import {
  MAX_KERNEL_CACHE_ENTRIES,
  clearKernelCacheForTests,
  getCachedKernel,
  getKernelCacheSize,
} from '../lib/kernel_cache';

describe('kernel cache', () => {
  beforeEach(() => {
    clearKernelCacheForTests();
  });

  it('reuses a cached kernel for the same session', () => {
    const first = getCachedKernel('session-a', { C: 0.2, R: 0.3, S: 0.5 });
    const second = getCachedKernel('session-a', { C: 0.9, R: 0.05, S: 0.05 });

    expect(second).toBe(first);
    expect(getKernelCacheSize()).toBe(1);
  });

  it('evicts least recently used sessions at the configured cap', () => {
    for (let i = 0; i < MAX_KERNEL_CACHE_ENTRIES; i++) {
      getCachedKernel(`session-${i}`);
    }

    const survivor = getCachedKernel('session-0');
    getCachedKernel('session-overflow');

    expect(getKernelCacheSize()).toBe(MAX_KERNEL_CACHE_ENTRIES);
    expect(getCachedKernel('session-0')).toBe(survivor);
  });
});
