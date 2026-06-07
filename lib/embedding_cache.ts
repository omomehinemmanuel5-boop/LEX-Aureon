/**
 * Embedding Cache Layer — Additive Performance Optimization
 * 
 * This is a non-breaking enhancement that caches embeddings to reduce
 * Jina API calls and improve latency. It uses the existing Turso database
 * with a new optional table.
 * 
 * If the cache table doesn't exist, the system degrades gracefully and
 * continues to work without caching.
 */

import { createClient } from '@libsql/client';
import { env } from './env';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface CachedEmbedding {
  text_hash: string;
  text: string;
  embedding: number[];
  model: string;
  dimensions: number;
  created_at: number;
  hits: number;
}

function getDB() {
  return createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
}

/**
 * SHA-256 hash of text for cache key
 */
async function hashText(text: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Initialize cache table (idempotent)
 */
export async function initEmbeddingCache(): Promise<void> {
  const db = getDB();
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        text_hash        TEXT PRIMARY KEY,
        text             TEXT NOT NULL,
        embedding        TEXT NOT NULL,
        model            TEXT NOT NULL DEFAULT 'jina-embeddings-v3',
        dimensions       INTEGER NOT NULL DEFAULT 256,
        created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
        hits             INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Create index for fast lookups
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_embedding_cache_created
      ON embedding_cache(created_at DESC)
    `);

    console.log('[EmbeddingCache] Table initialized');
  } catch (e) {
    console.warn('[EmbeddingCache] Failed to initialize table:', e);
  }
}

/**
 * Get cached embedding if available
 */
export async function getCachedEmbedding(text: string): Promise<number[] | null> {
  try {
    const hash = await hashText(text);
    const db = getDB();

    const result = await db.execute({
      sql: `SELECT embedding, hits FROM embedding_cache WHERE text_hash = ?`,
      args: [hash],
    });

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const embedding = JSON.parse(String(row.embedding)) as number[];

    // Increment hit counter (async, non-blocking)
    db.execute({
      sql: `UPDATE embedding_cache SET hits = hits + 1 WHERE text_hash = ?`,
      args: [hash],
    }).catch(() => {
      /* ignore */
    });

    return embedding;
  } catch {
    // Cache miss or error — return null and let caller fetch fresh
    return null;
  }
}

/**
 * Store embedding in cache
 */
export async function cacheEmbedding(
  text: string,
  embedding: number[],
  model: string = 'jina-embeddings-v3',
  dimensions: number = 256,
): Promise<void> {
  try {
    const hash = await hashText(text);
    const db = getDB();

    await db.execute({
      sql: `
        INSERT INTO embedding_cache (text_hash, text, embedding, model, dimensions)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(text_hash) DO UPDATE SET
          hits = hits + 1
      `,
      args: [hash, text.slice(0, 5000), JSON.stringify(embedding), model, dimensions],
    });
  } catch (e) {
    console.warn('[EmbeddingCache] Failed to cache embedding:', e);
    // Non-fatal — system continues without caching
  }
}

/**
 * Clear old cache entries (older than 30 days)
 * Call periodically via cron or on startup
 */
export async function pruneEmbeddingCache(daysOld: number = 30): Promise<number> {
  try {
    const db = getDB();
    const cutoffTime = Math.floor(Date.now() / 1000) - daysOld * 24 * 60 * 60;

    const result = await db.execute({
      sql: `DELETE FROM embedding_cache WHERE created_at < ?`,
      args: [cutoffTime],
    });

    const deleted = result.rows.length;
    console.log(`[EmbeddingCache] Pruned ${deleted} entries older than ${daysOld} days`);
    return deleted;
  } catch (e) {
    console.warn('[EmbeddingCache] Pruning failed:', e);
    return 0;
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  total_entries: number;
  total_hits: number;
  avg_hits: number;
  cache_size_bytes: number;
}> {
  try {
    const db = getDB();

    const result = await db.execute(`
      SELECT
        COUNT(*) as total_entries,
        SUM(hits) as total_hits,
        AVG(hits) as avg_hits,
        SUM(LENGTH(embedding)) as cache_size_bytes
      FROM embedding_cache
    `);

    if (result.rows.length === 0) {
      return { total_entries: 0, total_hits: 0, avg_hits: 0, cache_size_bytes: 0 };
    }

    const row = result.rows[0];
    return {
      total_entries: Number(row.total_entries) || 0,
      total_hits: Number(row.total_hits) || 0,
      avg_hits: Number(row.avg_hits) || 0,
      cache_size_bytes: Number(row.cache_size_bytes) || 0,
    };
  } catch (e) {
    console.warn('[EmbeddingCache] Failed to get stats:', e);
    return { total_entries: 0, total_hits: 0, avg_hits: 0, cache_size_bytes: 0 };
  }
}
