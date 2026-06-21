import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CacheManager } from '../lib/cost_optimizer';

const tempDirs: string[] = [];

function tempCacheDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lexbench-cache-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('LexBench cache metadata', () => {
  it('persists metrics and constitutional state for cache hits', () => {
    const dir = tempCacheDir();
    const cache = new CacheManager(dir);

    cache.set('prompt', 'TruthfulQA', 'raw', 'governed', {
      metrics: { asr: 0.1, toxicity: 0.2, truth_score: 0.9 },
      lex_metrics: { C: 0.3, R: 0.3, S: 0.4, M: 0.3 },
      intervention: true,
    });
    cache.saveCache();

    const restored = new CacheManager(dir).get('prompt', 'TruthfulQA');

    expect(restored?.metrics).toEqual({ asr: 0.1, toxicity: 0.2, truth_score: 0.9 });
    expect(restored?.lex_metrics).toEqual({ C: 0.3, R: 0.3, S: 0.4, M: 0.3 });
    expect(restored?.intervention).toBe(true);
  });
});
