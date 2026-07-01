/**
 * lib/lex_memory.ts — Semantic Constitutional Memory
 *
 * Provider-agnostic embeddings + Turso JSON storage.
 * Embedding cache wired at embedText() — cache-aside, Turso-backed, non-blocking.
 * Every governed interaction embedded and stored.
 * Top-5 constitutionally similar past interactions injected per prompt.
 *
 * fix: uses singleton getClient() from db.ts instead of createClient() per call.
 */

import { getClient } from './db';
import { env } from './env';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface LexMemoryEvent {
  session_id:            string;
  prompt:                string;
  prompt_hash:           string;
  embedding:             number[];
  M:                     number;
  C:                     number;
  R:                     number;
  S:                     number;
  health_band:           string;
  state_label:           'STABLE' | 'INTERVENED' | 'REFUSED' | 'UNSTABLE';
  intervention:          boolean;
  governed_response_hash?: string;
}

export interface MemoryContext {
  past_prompt:    string;
  past_outcome:   string;
  state:          string;
  M:              number;
  adjusted_score: number;
}

// ── Embedding cache helpers ───────────────────────────────────────────────────

async function hashText(text: string): Promise<string> {
  const buf  = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function ensureCacheTable(): Promise<void> {
  try {
    const db = getClient();
    await db.execute(`
      CREATE TABLE IF NOT EXISTS embedding_cache (
        text_hash  TEXT    PRIMARY KEY,
        embedding  TEXT    NOT NULL,
        model      TEXT    NOT NULL DEFAULT 'jina-embeddings-v3',
        hits       INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_emb_cache_created ON embedding_cache(created_at)`
    );
  } catch {
    // Non-fatal — cache table creation failure never blocks the main flow
  }
}

export async function getCachedEmbedding(hash: string): Promise<number[] | null> {
  try {
    const db = getClient();
    const r  = await db.execute({
      sql:  'SELECT embedding FROM embedding_cache WHERE text_hash = ?',
      args: [hash],
    });
    if (!r.rows.length) return null;
    db.execute({
      sql:  'UPDATE embedding_cache SET hits = hits + 1 WHERE text_hash = ?',
      args: [hash],
    }).catch(() => undefined);
    return JSON.parse(String(r.rows[0].embedding)) as number[];
  } catch {
    return null;
  }
}

async function putCachedEmbedding(hash: string, embedding: number[]): Promise<void> {
  try {
    const db = getClient();
    await db.execute({
      sql: `INSERT INTO embedding_cache (text_hash, embedding)
            VALUES (?, ?)
            ON CONFLICT(text_hash) DO UPDATE SET hits = hits + 1`,
      args: [hash, JSON.stringify(embedding)],
    });
  } catch {
    // Non-fatal — cache store failure never blocks the main flow
  }
}

// ── Provider-agnostic embeddings ───────────────────────────────────────────────
// One embedding function for the whole app. The provider is selected at call
// time: Gemini (its free tier includes gemini-embedding-001) when GEMINI_API_KEY
// is set, otherwise Jina. All vectors are EMBED_DIM-dimensional and L2-normalized
// so cosine similarity, centroid averaging, and the stored 256-dim schema stay
// consistent regardless of provider.
//
// IMPORTANT — switching providers changes the embedding SPACE. Vectors from
// different models are not comparable even at the same length, so:
//   • the cache key includes the model name (a Jina-cached vector is never
//     served to a Gemini call), and
//   • lex_memory rows embedded by a previous provider will score ~0 against
//     new-provider queries and simply age out of the recent window.
// The self-referential centroid and the output are always embedded by the SAME
// (current) provider within a request, so S_self stays valid across a switch.
export const EMBED_DIM = 256;

type EmbedProvider = 'gemini' | 'jina';

function embedProvider(): EmbedProvider {
  if (env.GEMINI_API_KEY) return 'gemini';
  if (env.JINA_API_KEY)   return 'jina';
  throw new Error('No embedding provider configured (set GEMINI_API_KEY or JINA_API_KEY)');
}

export function activeEmbedModel(): string {
  try {
    return embedProvider() === 'gemini' ? 'gemini-embedding-001' : 'jina-embeddings-v3';
  } catch {
    return 'none';
  }
}

function l2normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const mag = Math.sqrt(s);
  return mag === 0 ? v : v.map(x => x / mag);
}

async function embedGemini(text: string): Promise<number[]> {
  const key = env.GEMINI_API_KEY as string;
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        taskType: 'SEMANTIC_SIMILARITY',
        outputDimensionality: EMBED_DIM,
      }),
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${await res.text()}`);
  const d = await res.json() as { embedding?: { values?: number[] } };
  const values = d.embedding?.values;
  if (!values?.length) throw new Error('Gemini embed: no values in response');
  // gemini-embedding-001 does NOT auto-normalize truncated (<3072) dims, so
  // normalize here to keep cosine similarity + centroid averaging accurate.
  return l2normalize(values);
}

async function embedJina(text: string): Promise<number[]> {
  const key = env.JINA_API_KEY as string;
  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model:      'jina-embeddings-v3',
      task:       'text-matching',
      input:      [text],
      dimensions: EMBED_DIM,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Jina ${res.status}: ${await res.text()}`);
  const d = await res.json() as { data: { embedding: number[] }[] };
  return d.data[0].embedding; // Jina v3 returns normalized vectors
}

// Single-text embedding, cache-aside. Cache key includes the model so vectors
// from different embedding spaces never collide.
export async function embedText(text: string): Promise<number[]> {
  const provider = embedProvider();
  const model    = activeEmbedModel();

  const hash   = await hashText(`${model}\n${text}`);
  const cached = await getCachedEmbedding(hash);
  if (cached) return cached;

  const embedding = provider === 'gemini' ? await embedGemini(text) : await embedJina(text);
  putCachedEmbedding(hash, embedding).catch(() => undefined);
  return embedding;
}

// Batch helper — embeds each text through the cached, provider-agnostic single
// path. gemini-embedding-001 accepts one input per call, so this fans out;
// fixed strings (e.g. the constitutional anchor) are served from cache.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  return Promise.all(texts.map(t => embedText(t)));
}

// Prune cache entries older than ttlDays — called from cron
export async function pruneEmbeddingCache(ttlDays = 30): Promise<number> {
  try {
    const db     = getClient();
    const cutoff = Math.floor(Date.now() / 1000) - ttlDays * 86_400;
    const r = await db.execute({
      sql:  'DELETE FROM embedding_cache WHERE created_at < ? RETURNING text_hash',
      args: [cutoff],
    });
    return r.rows.length;
  } catch {
    return 0;
  }
}

// ── Cosine similarity ─────────────────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length) return 0.0;
  const limit = Math.min(a.length, b.length);
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < limit; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0.0 : dot / denom;
}

// ── Adjusted memory score ─────────────────────────────────────────────────────
function adjustedScore(
  currentEmb: number[],
  past: { embedding: number[]; intervention: boolean; M: number },
): number {
  let score = cosineSimilarity(currentEmb, past.embedding);
  if (past.intervention) score *= 1.2;
  if (past.M > 0.15)     score *= 1.1;
  return score;
}

// ── Store memory event ────────────────────────────────────────────────────────
export async function storeMemory(event: LexMemoryEvent): Promise<void> {
  try {
    const db = getClient();
    await db.execute({
      sql: `INSERT INTO lex_memory
              (session_id, prompt, prompt_hash, embedding,
               M, C, R, S, health_band, state_label,
               intervention, governed_response_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        event.session_id,
        event.prompt.slice(0, 2000),
        event.prompt_hash,
        JSON.stringify(event.embedding),
        event.M, event.C, event.R, event.S,
        event.health_band,
        event.state_label,
        event.intervention ? 1 : 0,
        event.governed_response_hash ?? null,
        new Date().toISOString(),
      ],
    });
  } catch (e) {
    console.error('lex_memory storeMemory error:', e);
  }
}

// ── Retrieve similar memories ─────────────────────────────────────────────────
export async function retrieveSimilar(
  promptEmbedding: number[],
  topK = 5,
  limit = 300,
): Promise<MemoryContext[]> {
  try {
    const db  = getClient();
    const res = await db.execute({
      sql:  `SELECT prompt, governed_response_hash, state_label, M, embedding, intervention
             FROM lex_memory ORDER BY created_at DESC LIMIT ?`,
      args: [limit],
    });
    const scored = res.rows.map(row => {
      let embedding: number[] = [];
      try { embedding = JSON.parse(String(row.embedding)); } catch { /* skip */ }
      return {
        past_prompt:    String(row.prompt ?? ''),
        past_outcome:   String(row.governed_response_hash ?? ''),
        state:          String(row.state_label ?? 'UNKNOWN'),
        M:              Number(row.M),
        adjusted_score: adjustedScore(promptEmbedding, {
          embedding,
          intervention: Number(row.intervention) === 1,
          M: Number(row.M),
        }),
      };
    });
    return scored
      .sort((a, b) => b.adjusted_score - a.adjusted_score)
      .slice(0, topK);
  } catch (e) {
    console.error('lex_memory retrieveSimilar error:', e);
    return [];
  }
}

// ── Build memory context for kernel injection ─────────────────────────────────
export function buildMemoryContext(memories: MemoryContext[]): string {
  const relevant = memories.filter(m => m.adjusted_score > 0.15);
  if (!relevant.length) return '';
  const lines = relevant.map((m, i) => {
    const stability = m.M >= 0.25 ? 'STABLE' : m.M >= 0.15 ? 'ALERT' : 'STRESSED';
    return `[Memory ${i + 1}] State: ${m.state} | M=${m.M.toFixed(3)} | Health: ${stability} | Similarity: ${m.adjusted_score.toFixed(3)}`;
  });
  return `CONSTITUTIONAL MEMORY (${relevant.length} similar past interactions):\n${lines.join('\n')}\nApply this constitutional history to inform your response.`;
}

// ── Classify state label ──────────────────────────────────────────────────────
export function classifyStateLabel(
  intervention: boolean,
  response: string,
): LexMemoryEvent['state_label'] {
  const lower = (response ?? '').toLowerCase();
  if (lower.includes("can't assist") || lower.includes('cannot assist')) return 'REFUSED';
  if (intervention) return 'INTERVENED';
  return 'STABLE';
}

// ── DB migration ──────────────────────────────────────────────────────────────
export async function ensureLexMemoryTable(): Promise<void> {
  try {
    const db = getClient();
    await db.execute(`CREATE TABLE IF NOT EXISTS lex_memory (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id             TEXT    NOT NULL,
      prompt                 TEXT    NOT NULL,
      prompt_hash            TEXT    NOT NULL,
      embedding              TEXT    NOT NULL,
      M                      REAL    NOT NULL,
      C                      REAL    NOT NULL DEFAULT 0.333,
      R                      REAL    NOT NULL DEFAULT 0.333,
      S                      REAL    NOT NULL DEFAULT 0.334,
      health_band            TEXT    NOT NULL DEFAULT 'UNKNOWN',
      state_label            TEXT    NOT NULL DEFAULT 'STABLE',
      intervention           INTEGER NOT NULL DEFAULT 0,
      governed_response_hash TEXT,
      created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_lex_memory_session ON lex_memory(session_id)`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_lex_memory_created ON lex_memory(created_at DESC)`
    );
    await ensureCacheTable();
  } catch (e) {
    console.error('ensureLexMemoryTable error:', e);
  }
}

// ── Constitutional centroid (paper §4.3 / §6.2) ───────────────────────────────
// FAITHFUL to the paper: the constitutional centroid is the embedding centroid
// of the Vaulturex Sovereign Codex laws — a FIXED identity anchor in embedding
// space. It does NOT drift with traffic. Embedded via the provider-agnostic
// embedText, so it always matches the provider used for output embeddings.
let _centroidCache: { vec: number[]; ts: number } | null = null;
const CENTROID_TTL_MS = 5 * 60 * 1000;

export async function getConstitutionalCentroid(): Promise<number[] | null> {
  const now = Date.now();
  if (_centroidCache && (now - _centroidCache.ts) < CENTROID_TTL_MS) {
    return _centroidCache.vec;
  }
  try {
    const { SOVEREIGN_LAWS } = await import('./sovereign_laws');
    const laws = SOVEREIGN_LAWS.slice(0, 50); // the 50 Vaulturex laws
    const lawEmbeddings = await Promise.all(
      laws.map(law => embedText(`${law.name}: ${law.text}`).catch(() => [] as number[]))
    );
    const embeddings = lawEmbeddings.filter(e => e.length > 0);
    if (!embeddings.length) return null;

    const dim      = embeddings[0].length;
    const centroid = new Array<number>(dim).fill(0);
    for (const emb of embeddings) {
      for (let i = 0; i < Math.min(dim, emb.length); i++) {
        centroid[i] += emb[i] / embeddings.length;
      }
    }
    _centroidCache = { vec: centroid, ts: now };
    return centroid;
  } catch (e) {
    console.error('getConstitutionalCentroid error:', e);
    return null;
  }
}

export async function getSessionCentroid(sessionId: string): Promise<number[] | null> {
  try {
    const db  = getClient();
    const res = await db.execute({
      sql:  `SELECT embedding FROM lex_memory
             WHERE session_id = ? AND embedding IS NOT NULL
             ORDER BY created_at DESC LIMIT 20`,
      args: [sessionId],
    });
    const embeddings: number[][] = [];
    for (const row of res.rows) {
      try {
        const emb = JSON.parse(String(row.embedding));
        if (Array.isArray(emb) && emb.length > 0) embeddings.push(emb as number[]);
      } catch { /* skip */ }
    }
    if (!embeddings.length) return null;
    const dim      = embeddings[0].length;
    const centroid = new Array<number>(dim).fill(0);
    for (const emb of embeddings) {
      for (let i = 0; i < Math.min(dim, emb.length); i++) {
        centroid[i] += emb[i] / embeddings.length;
      }
    }
    return centroid;
  } catch {
    return null;
  }
}

export function invalidateCentroidCache(): void {
  _centroidCache = null;
}
