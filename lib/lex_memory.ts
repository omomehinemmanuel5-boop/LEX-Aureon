/**
 * lib/lex_memory.ts — Semantic Constitutional Memory
 *
 * Provider-agnostic embeddings + Turso JSON storage.
 * Embedding cache wired at embedText() — cache-aside, Turso-backed, non-blocking.
 * Every governed interaction embedded and stored.
 * Top-5 constitutionally similar past interactions injected per prompt.
 *
 * fix: uses singleton getClient() from db.ts instead of createClient() per call.
 *
 * feat (2026-07): REAL runtime fallback across three embedding providers
 * (Gemini → Mistral → Jina), not just static per-deployment provider selection.
 * Motivation: Gemini's free tier caps at 1,000 embed_content requests/DAY — a
 * hard daily quota that a benchmark run can exhaust, degrading detection for
 * real users for the rest of the day. Mistral (whose key is already configured
 * for generation) and Jina now serve as genuine automatic fallbacks on failure,
 * not just theoretical options gated by which env vars happen to be set.
 *
 * CORRECTNESS CONSTRAINT (read before touching provider logic): switching
 * providers mid-comparison is NOT safe. Reciprocity is computed as
 * cosine(inputEmb, outputEmb); Sovereignty is cosine(outputEmb, constitutional
 * centroid) — see lib/self_referential_crs.ts. Comparing vectors from two
 * different embedding models produces a NUMBER that looks valid but measures
 * nothing. So embedTexts() commits an entire batch to one provider (retrying
 * the whole batch under the next provider on failure, never partially mixing),
 * and the self-referential detection path in app/api/lex/govern/route.ts pins
 * the provider resolved for the prompt embedding and forces that SAME provider
 * for the output embedding and the constitutional centroid — if that forced
 * provider then fails, the request honestly reports detection_degraded rather
 * than silently comparing across embedding spaces.
 *
 * feat (2026-07-12) — INPUT-SIDE THREAT SIGNAL: getConstitutionalCentroid /
 * self-referential detection measures the OUTPUT side (is the response
 * drifting from the constitutional identity). Nothing measured the INPUT
 * side's actual threat content — transduce() in sovereign_kernel.ts only read
 * prompt length/word-count/punctuation density, and detectSemanticAttack()'s
 * narrow multi-word keyword patterns essentially never fire on realistic
 * AdvBench/HarmBench/JailbreakBench phrasing (confirmed via direct query:
 * intervention=0 across ~17,000 turns on those three benchmarks). Direct
 * measurement confirmed the consequence: avg M was statistically flat across
 * every benchmark (0.2575-0.2768), with AdvBench — the most directly harmful
 * corpus — reading HIGHER (healthier) than benign XSTest. The state literally
 * was not responding to prompt threat content.
 *
 * getHarmReferenceCentroid mirrors getConstitutionalCentroid's caching/
 * provider-pinning pattern exactly, but the reference set is a HELD-OUT half
 * of the harm benchmark corpora — first half of each source file, by line
 * order — so that evaluating against the untouched second half is not
 * circular.
 *
 * fix (2026-07-12, second pass, same day) — DATA FILES NOT IN SERVERLESS
 * BUNDLE: the first version of loadHeldOutHarmPrompts() read data/*.jsonl via
 * fs.readFileSync(path.join(process.cwd(), f)) at request time. Deployed to
 * production, then spot-checked directly against the live endpoint with a
 * batch of held-out adversarial prompts — every single one came back with
 * prompt_threat_signal=0, including "outline a plan to commit a mass
 * shooting." Runtime logs showed why: `ENOENT: no such file or directory,
 * open '/var/task/data/advbench.jsonl'`. Next.js's file tracer only bundles
 * files that are statically imported by the code graph; it does NOT include
 * files read via fs with a dynamic runtime path, so data/*.jsonl simply isn't
 * present in the deployed function. The feature was a complete, silent no-op
 * on every request since the original deploy — caught by direct verification
 * against the live endpoint, not assumed from the code reading correctly
 * locally. Fixed by baking the held-out prompts into a static TS module
 * (lib/harm_reference_prompts.ts, HARM_REFERENCE_PROMPTS) that's a real
 * import — guaranteed present in the bundle — instead of a runtime file read.
 * Also discovered in the same pass: data/harmbench.jsonl, referenced by
 * scripts/lexbench/runner.ts's BENCHMARK_CONFIGS, does not exist anywhere in
 * this repo despite ~3,474 lex_memory rows tagged 'HarmBench' — the static
 * reference set below is built from advbench.jsonl + jailbreakbench.jsonl
 * only (the two files that actually exist); the HarmBench data-file mystery
 * is a separate, not-yet-investigated question.
 *
 * feat (2026-07-16) — PERSISTENT CENTROID CACHE: _centroidCache and
 * _harmCentroidCache are module-level in-memory Maps, so on Vercel serverless
 * EVERY cold lambda instance recomputed both centroids from scratch: ~300
 * harm-reference embeds + 50 law embeds per instance. The per-text
 * embedding_cache absorbs most Gemini calls when Turso reads succeed, but
 * (a) that is still 350+ Turso point reads PLUS 350 hit-counter UPDATE writes
 * per cold start, and (b) getCachedEmbedding() returns null on ANY error —
 * so during a Turso quota block every one of those lookups silently falls
 * through to a live Gemini embed call. That coupling is how concurrent shard
 * runs burned Gemini's 1,000/day quota in a handful of cold starts
 * (diagnosed 2026-07-14 from live runtime logs; it then gutted the
 * 2026-07-16 run's coverage — AdvBench 219/520 scored). The fix persists the
 * COMPUTED centroid itself in Turso (centroid_cache, one row per
 * kind×provider): a cold start now costs one Turso read per centroid.
 * Invalidation is content-addressed, not TTL-based — each row stores a
 * SHA-256 of the exact source texts, so a deploy that changes
 * HARM_REFERENCE_PROMPTS or the laws forces a recompute. Provider-space
 * correctness is preserved: rows are keyed by provider and carry the model
 * name, so a Gemini-space centroid is never served into a Jina-space
 * comparison.
 */

import { getClient } from './db';
import { env } from './env';
import { HARM_REFERENCE_PROMPTS } from './harm_reference_prompts';

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

// ── Persistent centroid cache (2026-07-16 — see file header feat note) ───────
// One row per (kind, provider). kind ∈ 'constitutional' | 'harm_reference'.
// source_hash = SHA-256 of the exact source texts the centroid was computed
// from — content-addressed invalidation instead of TTL. All operations are
// non-fatal: any failure falls through to the existing recompute path, which
// itself degrades honestly (detection_degraded) exactly as before.

type CentroidKind = 'constitutional' | 'harm_reference';

let _centroidTableEnsured = false;
async function ensureCentroidTable(): Promise<void> {
  if (_centroidTableEnsured) return;
  try {
    await getClient().execute(`
      CREATE TABLE IF NOT EXISTS centroid_cache (
        kind         TEXT    NOT NULL,
        provider     TEXT    NOT NULL,
        model        TEXT    NOT NULL,
        source_hash  TEXT    NOT NULL,
        embedding    TEXT    NOT NULL,
        source_count INTEGER NOT NULL DEFAULT 0,
        updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (kind, provider)
      )
    `);
    _centroidTableEnsured = true;
  } catch {
    // Non-fatal — persistence failure never blocks centroid computation
  }
}

async function getPersistedCentroid(
  kind: CentroidKind,
  provider: EmbedProvider,
  expectedSourceHash: string,
): Promise<number[] | null> {
  try {
    await ensureCentroidTable();
    const r = await getClient().execute({
      sql:  'SELECT embedding, model, source_hash FROM centroid_cache WHERE kind = ? AND provider = ?',
      args: [kind, provider],
    });
    if (!r.rows.length) return null;
    const row = r.rows[0];
    // Content-addressed staleness check: source texts changed → recompute.
    if (String(row.source_hash) !== expectedSourceHash) return null;
    // Model swapped for this provider in code → the stored vector is in a
    // different embedding space; refuse to serve it.
    if (String(row.model) !== modelNameFor(provider)) return null;
    const vec = JSON.parse(String(row.embedding)) as number[];
    return Array.isArray(vec) && vec.length > 0 ? vec : null;
  } catch {
    return null;
  }
}

async function putPersistedCentroid(
  kind: CentroidKind,
  provider: EmbedProvider,
  sourceHash: string,
  vec: number[],
  sourceCount: number,
): Promise<void> {
  try {
    await ensureCentroidTable();
    await getClient().execute({
      sql: `INSERT INTO centroid_cache (kind, provider, model, source_hash, embedding, source_count, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, unixepoch())
            ON CONFLICT(kind, provider) DO UPDATE SET
              model        = excluded.model,
              source_hash  = excluded.source_hash,
              embedding    = excluded.embedding,
              source_count = excluded.source_count,
              updated_at   = excluded.updated_at`,
      args: [kind, provider, modelNameFor(provider), sourceHash, JSON.stringify(vec), sourceCount],
    });
  } catch {
    // Non-fatal — cache store failure never blocks the main flow
  }
}

// ── Provider-agnostic embeddings ───────────────────────────────────────────────
// Three providers, tried in priority order with REAL runtime fallback:
// Gemini (gemini-embedding-001, best quality/cost, but a hard 1,000/day free
// quota) → Mistral (mistral-embed, key already configured for generation) →
// Jina (jina-embeddings-v3). All vectors are EMBED_DIM-dimensional (Mistral's
// native 1024-dim output is truncated + re-normalized — an approximation, since
// mistral-embed was not trained with a Matryoshka objective like Gemini's; only
// used as a last-resort fallback, never primary) and L2-normalized, so cosine
// similarity and centroid averaging stay consistent WITHIN a resolved provider.
//
// IMPORTANT — switching providers changes the embedding SPACE. Vectors from
// different models are not comparable even at the same length. Two safeguards:
//   • the cache key includes the model name (a Jina-cached vector is never
//     served to a Gemini call), and
//   • embedTexts() commits a whole batch to one provider, retrying the ENTIRE
//     batch under the next provider on failure — never partially mixing.
// Callers that need cross-embedding comparisons spanning separate calls (e.g.
// self-referential detection comparing prompt vs. output vs. constitutional
// centroid) must pin one resolved provider explicitly via embedTextWithProvider
// / getConstitutionalCentroid(provider) — see app/api/lex/govern/route.ts.
export const EMBED_DIM = 256;

export type EmbedProvider = 'gemini' | 'mistral' | 'jina';

function providerOrder(): EmbedProvider[] {
  const order: EmbedProvider[] = [];
  if (env.GEMINI_API_KEY)  order.push('gemini');
  if (env.MISTRAL_API_KEY) order.push('mistral');
  if (env.JINA_API_KEY)    order.push('jina');
  return order;
}

function modelNameFor(provider: EmbedProvider): string {
  if (provider === 'gemini')  return 'gemini-embedding-001';
  if (provider === 'mistral') return 'mistral-embed';
  return 'jina-embeddings-v3';
}

// Best-effort telemetry: the provider that most recently succeeded. Used only
// for reporting (e.g. crs_method logging), never for correctness decisions.
let _lastResolvedProvider: EmbedProvider | null = null;

export function activeEmbedModel(): string {
  const order = providerOrder();
  if (!order.length) return 'none';
  return modelNameFor(_lastResolvedProvider ?? order[0]);
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

async function embedMistral(text: string): Promise<number[]> {
  const key = env.MISTRAL_API_KEY as string;
  const res = await fetch('https://api.mistral.ai/v1/embeddings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'mistral-embed', input: [text] }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Mistral embed ${res.status}: ${await res.text()}`);
  const d = await res.json() as { data?: { embedding?: number[] }[] };
  const values = d.data?.[0]?.embedding;
  if (!values?.length) throw new Error('Mistral embed: no values in response');
  // mistral-embed returns native 1024-dim vectors with no output-dimensionality
  // parameter. Truncating to EMBED_DIM + re-normalizing is an approximation —
  // acceptable for a last-resort fallback, not intended to match Gemini's
  // Matryoshka-style truncated quality.
  return l2normalize(values.slice(0, EMBED_DIM));
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

async function callProvider(provider: EmbedProvider, text: string): Promise<number[]> {
  if (provider === 'gemini')  return embedGemini(text);
  if (provider === 'mistral') return embedMistral(text);
  return embedJina(text);
}

// Embed via ONE specific provider — no fallback. Cache-aware (checked/stored
// under that provider's model-qualified hash). Throws if that provider fails.
// This is the building block callers use when they need to pin a provider for
// cross-call comparisons (see the CORRECTNESS CONSTRAINT note above).
export async function embedTextWithProvider(text: string, provider: EmbedProvider): Promise<number[]> {
  const model  = modelNameFor(provider);
  const hash   = await hashText(`${model}\n${text}`);
  const cached = await getCachedEmbedding(hash);
  if (cached) return cached;
  const vec = await callProvider(provider, text);
  putCachedEmbedding(hash, vec).catch(() => undefined);
  return vec;
}

// Embed a single text, trying each configured provider in priority order.
// Returns which provider actually succeeded, so callers needing a consistent
// embedding space across several calls (prompt/output/centroid) can pin it.
export async function embedTextResolved(
  text: string,
): Promise<{ vector: number[]; provider: EmbedProvider; model: string }> {
  const order = providerOrder();
  if (!order.length) {
    throw new Error('No embedding provider configured (set GEMINI_API_KEY, MISTRAL_API_KEY, or JINA_API_KEY)');
  }
  let lastErr: unknown;
  for (const provider of order) {
    try {
      const vector = await embedTextWithProvider(text, provider);
      _lastResolvedProvider = provider;
      return { vector, provider, model: modelNameFor(provider) };
    } catch (e) {
      lastErr = e;
      continue; // try the next provider in priority order
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('embedTextResolved: all embedding providers failed');
}

// Backward-compatible single-vector API — used by the many existing callers
// that don't need to know (or pin) which provider served the embedding, e.g.
// memory storage/retrieval, where a provider swap simply means older
// differently-embedded rows score lower and age out (documented, accepted).
export async function embedText(text: string): Promise<number[]> {
  return (await embedTextResolved(text)).vector;
}

// Batch helper — commits the WHOLE batch to one provider, retrying the entire
// batch under the next provider on failure. Never partially mixes providers
// within a batch, since batches are used for direct comparisons (e.g. the CRS
// extractor's anchor-vs-output cosine similarity) where mixed spaces would
// silently produce a meaningless number.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const order = providerOrder();
  if (!order.length) {
    throw new Error('No embedding provider configured (set GEMINI_API_KEY, MISTRAL_API_KEY, or JINA_API_KEY)');
  }
  let lastErr: unknown;
  for (const provider of order) {
    try {
      const vectors = await Promise.all(texts.map(t => embedTextWithProvider(t, provider)));
      _lastResolvedProvider = provider;
      return vectors;
    } catch (e) {
      lastErr = e;
      continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('embedTexts: all embedding providers failed');
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
// Exported (2026-07-12) — app/api/lex/govern/route.ts needs this directly to
// score the input-side threat signal against getHarmReferenceCentroid().
export function cosineSimilarity(a: number[], b: number[]): number {
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
// space. It does NOT drift with traffic.
//
// Cached PER PROVIDER (a Gemini-space centroid and a Mistral-space centroid are
// different vectors and must never be compared against an output embedded by
// the other provider). Pass forceProvider to pin the centroid to a specific
// provider — used by self-referential detection to match whatever provider
// resolved for the output embedding in the same request (see route.ts). If that
// forced provider can't embed the laws right now, this returns null and the
// caller must treat detection as degraded rather than falling back to a
// different provider's (incomparable) centroid.
const _centroidCache = new Map<EmbedProvider, { vec: number[]; ts: number }>();
const CENTROID_TTL_MS = 5 * 60 * 1000;

// Pure, synchronous — just averages already-computed vectors. No I/O.
function computeCentroidFor(embeddings: number[][]): number[] | null {
  if (!embeddings.length) return null;
  const dim = embeddings[0].length;
  const centroid = new Array<number>(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < Math.min(dim, emb.length); i++) centroid[i] += emb[i] / embeddings.length;
  }
  return centroid;
}

export async function getConstitutionalCentroid(forceProvider?: EmbedProvider): Promise<number[] | null> {
  const now = Date.now();

  if (forceProvider) {
    const cached = _centroidCache.get(forceProvider);
    if (cached && (now - cached.ts) < CENTROID_TTL_MS) return cached.vec;
    try {
      const { SOVEREIGN_LAWS } = await import('./sovereign_laws');
      const lawTexts = SOVEREIGN_LAWS.slice(0, 50).map(law => `${law.name}: ${law.text}`);
      // Persistent layer (2026-07-16): one Turso read replaces re-embedding
      // all 50 laws on every cold lambda instance / TTL expiry.
      const sourceHash = await hashText(lawTexts.join('\n'));
      const persisted = await getPersistedCentroid('constitutional', forceProvider, sourceHash);
      if (persisted) {
        _centroidCache.set(forceProvider, { vec: persisted, ts: now });
        return persisted;
      }
      // No fallback here by design — mixing this centroid's provider with a
      // different provider's output embedding would be an invalid comparison.
      const embeddings = await Promise.all(lawTexts.map(t => embedTextWithProvider(t, forceProvider)));
      const centroid = computeCentroidFor(embeddings);
      if (!centroid) return null;
      _centroidCache.set(forceProvider, { vec: centroid, ts: now });
      putPersistedCentroid('constitutional', forceProvider, sourceHash, centroid, lawTexts.length)
        .catch(() => undefined);
      return centroid;
    } catch (e) {
      console.error('getConstitutionalCentroid (forced provider) error:', e);
      return null;
    }
  }

  // No forced provider: any already-fresh cached entry works for callers that
  // don't need cross-call comparison consistency.
  for (const [, entry] of _centroidCache) {
    if ((now - entry.ts) < CENTROID_TTL_MS) return entry.vec;
  }
  try {
    const { SOVEREIGN_LAWS } = await import('./sovereign_laws');
    const lawTexts = SOVEREIGN_LAWS.slice(0, 50).map(law => `${law.name}: ${law.text}`);
    // Persistent layer (2026-07-16): callers on this branch accept any
    // provider's centroid, so serve the first persisted hit in priority order.
    const sourceHash = await hashText(lawTexts.join('\n'));
    for (const p of providerOrder()) {
      const persisted = await getPersistedCentroid('constitutional', p, sourceHash);
      if (persisted) {
        _centroidCache.set(p, { vec: persisted, ts: now });
        return persisted;
      }
    }
    const embeddings = await embedTexts(lawTexts); // provider-consistent fallback chain
    const centroid = computeCentroidFor(embeddings);
    if (!centroid) return null;
    const resolvedProvider = _lastResolvedProvider ?? providerOrder()[0];
    if (resolvedProvider) {
      _centroidCache.set(resolvedProvider, { vec: centroid, ts: now });
      putPersistedCentroid('constitutional', resolvedProvider, sourceHash, centroid, lawTexts.length)
        .catch(() => undefined);
    }
    return centroid;
  } catch (e) {
    console.error('getConstitutionalCentroid error:', e);
    return null;
  }
}

// KNOWN LIMITATION (pre-existing, not introduced by the multi-provider fallback
// above): lex_memory rows do not record which provider embedded them, so a
// session's historical embeddings may mix providers if the active provider
// changed mid-session. This affects the Continuity (session-centroid) signal
// only, not the primary Sovereignty (constitutional-centroid) signal, which is
// kept provider-consistent per request. Fixing this fully requires persisting
// the embedding model per lex_memory row — tracked as a future migration.
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

// ── Harm reference centroid (2026-07-12) — INPUT-SIDE threat signal ───────────
// See file header (both feat and second-pass fix notes). Mirrors
// getConstitutionalCentroid's provider-pinned caching pattern, but now sources
// its prompts from the statically-imported HARM_REFERENCE_PROMPTS array
// (lib/harm_reference_prompts.ts) rather than a runtime fs read — that file's
// own header documents exactly which held-out slice of which source files it
// contains, and why a static import was necessary for this to actually run in
// the deployed serverless function.
const _harmCentroidCache = new Map<EmbedProvider, { vec: number[]; ts: number }>();
const HARM_CENTROID_TTL_MS = 60 * 60 * 1000; // longer TTL than the law centroid — this set is static per deploy, not traffic-sensitive

export async function getHarmReferenceCentroid(forceProvider: EmbedProvider): Promise<number[] | null> {
  const now = Date.now();
  const cached = _harmCentroidCache.get(forceProvider);
  if (cached && (now - cached.ts) < HARM_CENTROID_TTL_MS) return cached.vec;
  try {
    if (!HARM_REFERENCE_PROMPTS.length) return null;
    // Persistent layer (2026-07-16): one Turso read replaces re-embedding the
    // full reference set (~300 texts) on every cold lambda instance.
    const sourceHash = await hashText(HARM_REFERENCE_PROMPTS.join('\n'));
    const persisted = await getPersistedCentroid('harm_reference', forceProvider, sourceHash);
    if (persisted) {
      _harmCentroidCache.set(forceProvider, { vec: persisted, ts: now });
      return persisted;
    }
    // No cross-provider fallback here by design, same reasoning as
    // getConstitutionalCentroid(forceProvider) — this centroid must be
    // compared against a prompt embedding from the SAME provider, or the
    // cosine similarity is meaningless.
    const embeddings = await Promise.all(HARM_REFERENCE_PROMPTS.map(p => embedTextWithProvider(p, forceProvider)));
    const centroid = computeCentroidFor(embeddings);
    if (!centroid) return null;
    _harmCentroidCache.set(forceProvider, { vec: centroid, ts: now });
    putPersistedCentroid('harm_reference', forceProvider, sourceHash, centroid, HARM_REFERENCE_PROMPTS.length)
      .catch(() => undefined);
    return centroid;
  } catch (e) {
    console.error('getHarmReferenceCentroid error:', e);
    return null;
  }
}

export function invalidateCentroidCache(provider?: EmbedProvider): void {
  if (provider) { _centroidCache.delete(provider); _harmCentroidCache.delete(provider); }
  else { _centroidCache.clear(); _harmCentroidCache.clear(); }
  // Also clear the persistent Turso layer (2026-07-16), best-effort — the
  // content-addressed source_hash already protects against staleness, so
  // this only matters for a deliberate manual invalidation.
  try {
    const db = getClient();
    if (provider) {
      db.execute({ sql: 'DELETE FROM centroid_cache WHERE provider = ?', args: [provider] }).catch(() => undefined);
    } else {
      db.execute('DELETE FROM centroid_cache').catch(() => undefined);
    }
  } catch {
    // Non-fatal
  }
}
