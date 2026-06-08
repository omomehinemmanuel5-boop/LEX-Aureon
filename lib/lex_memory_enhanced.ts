/**
 * Enhanced Lex Memory with Embedding Cache
 * 
 * This is a drop-in replacement for lex_memory.ts that uses the embedding cache.
 * It is backward compatible — if caching fails, it falls back to direct API calls.
 * 
 * To use this, update the import in app/api/lex/govern/route.ts:
 * import { embedText, ... } from '@/lib/lex_memory_enhanced';
 * 
 * Or keep using lex_memory.ts — this is provided as an optional enhancement.
 */

import { createClient } from '@libsql/client';
import { env } from './env';
import { getCachedEmbedding, cacheEmbedding, initEmbeddingCache } from './embedding_cache';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getDB() {
  return createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
}

/**
 * Embed text with caching layer
 * 1. Check cache first
 * 2. If miss, call Jina API
 * 3. Store result in cache
 */
export async function embedText(text: string): Promise<number[]> {
  // Try cache first
  const cached = await getCachedEmbedding(text);
  if (cached) {
    return cached;
  }

  // Cache miss — fetch from API
  const key = env.JINA_API_KEY;
  if (!key) throw new Error('JINA_API_KEY not set');

  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      task: 'text-matching',
      input: [text],
      dimensions: 256,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Jina ${res.status}: ${await res.text()}`);

  const d = (await res.json()) as { data: { embedding: number[] }[] };
  const embedding = d.data[0].embedding;

  // Store in cache (async, non-blocking)
  cacheEmbedding(text, embedding).catch(e => {
    console.warn('[lex_memory_enhanced] Cache store failed:', e);
  });

  return embedding;
}

// Re-export all other functions from lex_memory
export {
  storeMemory,
  retrieveSimilar,
  buildMemoryContext,
  classifyStateLabel,
  ensureLexMemoryTable,
  getConstitutionalCentroid,
  getSessionCentroid,
  invalidateCentroidCache,
  type LexMemoryEvent,
  type MemoryContext,
} from './lex_memory';

/**
 * Initialize both memory and cache tables
 */
export async function initLexMemoryWithCache(): Promise<void> {
  const { ensureLexMemoryTable } = await import('./lex_memory');
  await Promise.all([ensureLexMemoryTable(), initEmbeddingCache()]);
}
