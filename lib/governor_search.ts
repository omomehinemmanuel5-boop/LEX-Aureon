/**
 * ═══════════════════════════════════════════════════════════════════════
 * lib/governor_search.ts
 *
 * Web search adapter for the Governor Sensing Layer.
 *
 * Fires N parallel queries when governor uncertainty spikes (U(t) > 0.5).
 * Results are passed to computeIEC() which calculates ρ(t) — if variance
 * is too high, the correction G(x,z) is rejected before it touches state.
 *
 * Uses the SERPER_API_KEY env var (Google Search API).
 * Falls back to Groq web browsing if Serper unavailable.
 * Returns empty results (safe) if all providers fail.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { env } from './env';
import { shannonEntropy, type SearchResult } from './governor_sensing';

const SERPER_URL = 'https://google.serper.dev/search';
const TIMEOUT_MS = 8_000;

interface SerperResult {
  title?:   string;
  snippet?: string;
  link?:    string;
}

interface SerperResponse {
  organic?: SerperResult[];
}

async function searchSerper(
  query:  string,
  apiKey: string,
): Promise<SearchResult | null> {
  try {
    const res = await fetch(SERPER_URL, {
      method:  'POST',
      headers: {
        'X-API-KEY':    apiKey,
        'Content-Type': 'application/json',
      },
      body:   JSON.stringify({ q: query, num: 3 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const data  = await res.json() as SerperResponse;
    const items = data.organic ?? [];
    const content = items
      .map(r => [r.title, r.snippet].filter(Boolean).join(' '))
      .join(' ')
      .trim();

    if (!content) return null;

    return {
      query,
      content,
      source:  'serper',
      entropy: shannonEntropy(content),
    };
  } catch {
    return null;
  }
}

// ── Build N parallel queries from a prompt ──────────────────────────────────
// Decomposition strategy: general + specific + contrasting
// This maximises IEC discriminative power — conflicting angles reveal low ρ(t)
function buildQueries(prompt: string, n: number): string[] {
  const base = prompt.slice(0, 200).trim();
  const queries = [
    base,
    `${base} — facts and evidence`,
    `${base} — counterarguments and limitations`,
    `${base} — recent developments 2025 2026`,
    `${base} — expert consensus`,
  ];
  return queries.slice(0, n);
}

// ── Run N parallel searches ─────────────────────────────────────────────────
export async function runParallelSearch(
  prompt:  string,
  n:       number = 3,
): Promise<SearchResult[]> {
  const apiKey = env.SERPER_API_KEY;
  if (!apiKey) {
    // No search key — return empty. Governor sensing degrades gracefully.
    return [];
  }

  const queries  = buildQueries(prompt, n);
  const settled  = await Promise.allSettled(
    queries.map(q => searchSerper(q, apiKey))
  );

  return settled
    .filter((r): r is PromiseFulfilledResult<SearchResult> =>
      r.status === 'fulfilled' && r.value !== null
    )
    .map(r => r.value);
}
