// lib/embedding_cache.ts — SUPERSEDED 2026-06-08
//
// The embedding cache is now wired directly inside lib/lex_memory.ts
// at the embedText() call site. There is no separate module needed.
//
// Functions now in lib/lex_memory.ts:
//   - embedText(text)          → cache-aside, Turso-backed
//   - pruneEmbeddingCache(days) → called by cron (app/api/cron/synthetic/route.ts)
//
// The Turso table is: embedding_cache (text_hash PK, embedding, model, hits, created_at)
// Created automatically by ensureLexMemoryTable().
//
// Safe to delete this file.
export {};
