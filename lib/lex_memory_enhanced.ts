// REMOVED 2026-06-08 — was never activated.
// This file's own header comment said: "To use this, update the import in govern/route.ts".
// That import was never updated. govern/route.ts still uses lib/lex_memory.ts directly.
// The embedding cache layer it provides is a good idea — wire it in properly when needed.
// Safe to delete this file entirely. Delete embedding_cache.ts too (only used here).
export {};
