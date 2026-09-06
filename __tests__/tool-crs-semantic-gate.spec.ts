import { describe, expect, it, vi, beforeEach } from 'vitest';

// injectionSimilarity calls embedArchetypesWithProvider -> embedTextResolved
// / embedTextWithProvider from lib/lex_memory. Mock both so this test never
// makes a real embedding-API call and is deterministic.
const { embedTextResolved, embedTextWithProvider } = vi.hoisted(() => ({
  embedTextResolved: vi.fn(),
  embedTextWithProvider: vi.fn(),
}));

vi.mock('../lib/lex_memory', () => ({
  embedTextResolved,
  embedTextWithProvider,
}));

import { injectionSimilarity } from '../lib/agents/tool_crs';

describe('injectionSimilarity — natural-language shape gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // If these get called at all in the single-token cases below, the test
    // should fail loudly rather than silently return a mocked vector —
    // that's the whole point of the gate (skip embedding entirely).
    embedTextResolved.mockRejectedValue(new Error('embedTextResolved should not be called for non-prose text'));
    embedTextWithProvider.mockRejectedValue(new Error('embedTextWithProvider should not be called for non-prose text'));
  });

  it('skips the embedding call entirely for a bare technical identifier (the exact production false positive)', async () => {
    const result = await injectionSimilarity('executeGovernedTool');
    expect(result).toEqual({ similarity: 0, degraded: false });
    expect(embedTextResolved).not.toHaveBeenCalled();
    expect(embedTextWithProvider).not.toHaveBeenCalled();
  });

  it('skips for other short technical query shapes (snake_case, paths, single words)', async () => {
    for (const text of ['get_build_status', 'lib/agents/tool_crs.ts', 'README']) {
      const result = await injectionSimilarity(text);
      expect(result).toEqual({ similarity: 0, degraded: false });
    }
    expect(embedTextResolved).not.toHaveBeenCalled();
  });

  it('skips for empty/whitespace-only text (pre-existing behavior, unchanged)', async () => {
    const result = await injectionSimilarity('   ');
    expect(result).toEqual({ similarity: 0, degraded: false });
    expect(embedTextResolved).not.toHaveBeenCalled();
  });

  it('still runs the embedding check for genuine multi-word natural language', async () => {
    embedTextResolved.mockResolvedValue({ vector: [1, 0, 0], provider: 'gemini' });
    embedTextWithProvider.mockResolvedValue([1, 0, 0]);

    const result = await injectionSimilarity('please summarize the quarterly report for me');

    expect(embedTextResolved).toHaveBeenCalled();
    expect(result.degraded).toBe(false);
    // Not asserting a specific similarity value here — that depends on the
    // real archetype text and isn't what this test is protecting. The
    // point is: 3+ words reaches the embedding path at all, unlike the
    // single-token cases above.
  });
});
