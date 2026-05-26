/**
 * ═══════════════════════════════════════════════════════════════════════
 * Lex Memory — Semantic Constitutional Memory
 * TypeScript port of lex_memory/ using Jina + Turso instead of Supabase
 *
 * Original: lex_memory/{embedder,retrieve,store,engine}.py (Aureonics-OS-)
 * Adaptation: Jina jina-embeddings-v3 (already in PRAXIS) + Turso JSON storage
 *
 * Every governed interaction is embedded and stored.
 * On each new prompt, the 5 most constitutionally similar past
 * interactions are retrieved and injected into the kernel's context.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { createClient } from '@libsql/client';
import { env } from './env';

// ── Turso client ─────────────────────────────────────────────────────────────
function getDB() {
  return createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
}

// ── Memory event schema ───────────────────────────────────────────────────────
export interface LexMemoryEvent {
  session_id:           string;
  prompt:               string;
  prompt_hash:          string;
  embedding:            number[];
  M:                    number;
  C:                    number;
  R:                    number;
  S:                    number;
  health_band:          string;
  state_label:          'STABLE' | 'INTERVENED' | 'REFUSED' | 'UNSTABLE';
  intervention:         boolean;
  governed_response_hash?: string;
}

export interface MemoryContext {
  past_prompt:    string;
  past_outcome:   string;
  state:          string;
  M:              number;
  adjusted_score: number;
}

// ── Jina embedding ────────────────────────────────────────────────────────────
export async function embedText(text: string): Promise<number[]> {
  const key = env.JINA_API_KEY;
  if (!key) throw new Error('JINA_API_KEY not set');

  const res = await fetch('https://api.jina.ai/v1/embeddings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model:      'jina-embeddings-v3',
      task:       'text-matching',
      input:      [text],
      dimensions: 256,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Jina ${res.status}: ${await res.text()}`);
  const d = await res.json() as { data: { embedding: number[] }[] };
  return d.data[0].embedding;
}

// ── Cosine similarity (pure TypeScript, no numpy) ────────────────────────────
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

// ── Adjusted memory score (port of retrieve.adjusted_memory_score) ────────────
// Weights: intervention × 1.2, high-M × 1.1 — matches original Python exactly
function adjustedScore(currentEmb: number[], past: {
  embedding: number[];
  intervention: boolean;
  M: number;
}): number {
  let score = cosineSimilarity(currentEmb, past.embedding);
  if (past.intervention) score *= 1.2;
  if (past.M > 0.15)     score *= 1.1;
  return score;
}

// ── Store memory event ────────────────────────────────────────────────────────
export async function storeMemory(event: LexMemoryEvent): Promise<void> {
  const db = getDB();
  try {
    await db.execute({
      sql: `INSERT INTO lex_memory
              (session_id, prompt, prompt_hash, embedding,
               M, C, R, S, health_band, state_label,
               intervention, governed_response_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        event.session_id,
        event.prompt.slice(0, 2000),      // cap stored prompt
        event.prompt_hash,
        JSON.stringify(event.embedding),   // stored as JSON in Turso
        event.M, event.C, event.R, event.S,
        event.health_band,
        event.state_label,
        event.intervention ? 1 : 0,
        event.governed_response_hash ?? null,
        new Date().toISOString(),
      ],
    });
    invalidateCentroidCache(); // centroid must update after new memory
  } catch (e) {
    console.error('lex_memory storeMemory error:', e);
  }
}

// ── Retrieve similar memories ─────────────────────────────────────────────────
export async function retrieveSimilar(
  promptEmbedding: number[],
  topK: number = 5,
  limit: number = 300,
): Promise<MemoryContext[]> {
  const db = getDB();
  try {
    const res = await db.execute({
      sql: `SELECT prompt, governed_response_hash, state_label, M, embedding, intervention
            FROM lex_memory
            ORDER BY created_at DESC
            LIMIT ?`,
      args: [limit],
    });

    // Score all retrieved rows
    const scored = res.rows.map(row => {
      let embedding: number[] = [];
      try { embedding = JSON.parse(String(row.embedding)); } catch { /* skip */ }
      const score = adjustedScore(promptEmbedding, {
        embedding,
        intervention: Number(row.intervention) === 1,
        M: Number(row.M),
      });
      return {
        past_prompt:    String(row.prompt || ''),
        past_outcome:   String(row.governed_response_hash || ''),
        state:          String(row.state_label || 'UNKNOWN'),
        M:              Number(row.M),
        adjusted_score: score,
      };
    });

    // Sort by score descending, return top-K
    return scored
      .sort((a, b) => b.adjusted_score - a.adjusted_score)
      .slice(0, topK);

  } catch (e) {
    console.error('lex_memory retrieveSimilar error:', e);
    return [];
  }
}

// ── Build constitutional memory context for kernel injection ─────────────────
export function buildMemoryContext(memories: MemoryContext[]): string {
  if (!memories.length) return '';

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
  const lower = (response || '').toLowerCase();
  if (lower.includes("can't assist") || lower.includes('cannot assist')) return 'REFUSED';
  if (intervention) return 'INTERVENED';
  return 'STABLE';
}

// ── DB migration — called once on first use ────────────────────────────────────
export async function ensureLexMemoryTable(): Promise<void> {
  const db = getDB();
  try {
    await db.execute(`CREATE TABLE IF NOT EXISTS lex_memory (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id            TEXT    NOT NULL,
      prompt                TEXT    NOT NULL,
      prompt_hash           TEXT    NOT NULL,
      embedding             TEXT    NOT NULL,
      M                     REAL    NOT NULL,
      C                     REAL    NOT NULL DEFAULT 0.333,
      R                     REAL    NOT NULL DEFAULT 0.333,
      S                     REAL    NOT NULL DEFAULT 0.334,
      health_band           TEXT    NOT NULL DEFAULT 'UNKNOWN',
      state_label           TEXT    NOT NULL DEFAULT 'STABLE',
      intervention          INTEGER NOT NULL DEFAULT 0,
      governed_response_hash TEXT,
      created_at            TEXT    NOT NULL DEFAULT (datetime('now'))
    )`);
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_lex_memory_session ON lex_memory(session_id)`
    );
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_lex_memory_created ON lex_memory(created_at DESC)`
    );
  } catch (e) {
    console.error('ensureLexMemoryTable error:', e);
  }
}


// ── Constitutional centroid cache ─────────────────────────────────────────────
// Centroid = average Jina embedding of all constitutional memory entries.
// This IS the constitutional identity — what the system has said and believed.
// A jailbreak output far from this centroid → S drops → CBF fires.
let _centroidCache: { vec: number[]; ts: number } | null = null;
const CENTROID_TTL_MS = 5 * 60 * 1000; // 5 min

export async function getConstitutionalCentroid(): Promise<number[] | null> {
  const now = Date.now();
  if (_centroidCache && (now - _centroidCache.ts) < CENTROID_TTL_MS) {
    return _centroidCache.vec;
  }
  try {
    const db = getDB();

    // Primary: LexMemory constitutional responses
    const res = await db.execute({
      sql: `SELECT embedding FROM lex_memory
            WHERE embedding IS NOT NULL AND state_label IN ('STABLE','INTERVENED')
            ORDER BY created_at DESC LIMIT 100`,
      args: [],
    });
    const embeddings: number[][] = [];
    for (const row of res.rows) {
      try {
        const emb = JSON.parse(String(row.embedding));
        if (Array.isArray(emb) && emb.length > 0) embeddings.push(emb as number[]);
      } catch { /* skip */ }
    }

    // Seed: Vaulturex Sovereign Laws — the constitutional identity from day one.
    // One law per book (10 books = 10 laws) covers all constitutional dimensions.
    // Embedded and averaged to form the initial identity centroid.
    // This ensures the centroid is never empty — the system knows itself from birth.
    if (embeddings.length < 10) {
      const { SOVEREIGN_LAWS } = await import('./sovereign_laws');
      // One law per book
      const seedLaws = Object.values(
        SOVEREIGN_LAWS.reduce((acc: Record<number, typeof SOVEREIGN_LAWS[0]>, law) => {
          if (!acc[law.book]) acc[law.book] = law;
          return acc;
        }, {})
      ).slice(0, 10);

      const lawEmbeddings = await Promise.all(
        seedLaws.map(law =>
          embedText(`${law.name}: ${law.text}`).catch(() => [] as number[])
        )
      );
      embeddings.push(...lawEmbeddings.filter(e => e.length > 0));
    }

    if (!embeddings.length) return null;

    const dim = embeddings[0].length;
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

// Session centroid — average of this session's stored embeddings
export async function getSessionCentroid(sessionId: string): Promise<number[] | null> {
  try {
    const db = getDB();
    const res = await db.execute({
      sql: `SELECT embedding FROM lex_memory
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
    const dim = embeddings[0].length;
    const centroid = new Array<number>(dim).fill(0);
    for (const emb of embeddings) {
      for (let i = 0; i < Math.min(dim, emb.length); i++) {
        centroid[i] += emb[i] / embeddings.length;
      }
    }
    return centroid;
  } catch (e) {
    return null;
  }
}

// Invalidate centroid cache (call after storing new memory)
export function invalidateCentroidCache(): void {
  _centroidCache = null;
}
