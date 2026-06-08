// REMOVED 2026-06-08 — only imported by lex_memory_enhanced.ts which is itself dead.
// The embedding cache concept is valid and worth wiring in future:
//   1. Wire getCachedEmbedding/cacheEmbedding into lib/lex_memory.ts embedText()
//   2. Add EMBEDDING_CACHE_TTL_DAYS to env.ts
//   3. Wire pruneEmbeddingCache into the cron job
// Safe to delete this file entirely when the above is done.
export {};
