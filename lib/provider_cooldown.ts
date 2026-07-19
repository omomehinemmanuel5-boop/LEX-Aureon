/**
 * lib/provider_cooldown.ts
 *
 * Shared, cross-instance provider cooldown tracking.
 *
 * fix (2026-07-19) — ROOT CAUSE OF SEVERE BENCHMARK PROVIDER EXHAUSTION:
 * lib/llm_provider.ts's cooldown (added 2026-07-12, specifically to stop
 * re-hitting a provider already known to be rate-limited) was a plain
 * in-memory `Map`, scoped to ONE Vercel serverless instance. Diagnosed
 * directly from a real benchmark run's provenance data (2026-07-19): a
 * sharded benchmark run triggers MANY concurrent serverless invocations —
 * each one gets its OWN fresh, empty cooldown Map. So once instance A
 * discovers Gemini is 429'ing, instance B (a different concurrent
 * invocation, which is the normal case under any real concurrency) has no
 * way to know and re-discovers the identical exhaustion from scratch,
 * paying the full 429 round-trip latency again — the very cost the cooldown
 * was built to eliminate. Under a run's actual concurrency pattern, the
 * protection was structurally incapable of working.
 *
 * Also found (same investigation): lib/lex_memory.ts's embedding provider
 * calls (embedGemini/embedMistral/embedJina) had NO cooldown mechanism at
 * all — every single embed call, on every turn, unconditionally tried
 * Gemini first regardless of how recently or how many times it had already
 * 429'd. Since embeddings run on every governed turn (prompt embedding,
 * output embedding for self-referential detection, threat-signal
 * comparison) and Gemini is ALSO the primary generation provider AND the
 * primary embedding provider, this compounds: a single exhausted Gemini
 * account gets re-probed from at least 3 different call sites per turn
 * (raw-arm generation, governed-arm generation — same function, see
 * lib/sovereign_kernel.ts's callLLMRaw — and embeddings), with zero shared
 * memory of the outcome.
 *
 * This module backs cooldown state with a shared Turso table
 * (provider_cooldowns) so any instance that discovers a real 429/402/403
 * becomes visible to every other concurrent instance. To avoid adding a
 * database round-trip to every single LLM/embed call — which would
 * undermine the whole point, and risk reintroducing the Turso read-quota
 * pressure this project has hit before — each instance keeps a local L1
 * cache and only re-syncs with Turso at most once per SYNC_INTERVAL_MS per
 * provider:model key, not on every check. Used by both lib/llm_provider.ts
 * (generation) and lib/lex_memory.ts (embeddings) — one shared mechanism,
 * not two independently-drifting copies.
 */

import { getClient } from './db';

// How often to re-check Turso for a cooldown another instance may have set,
// when THIS instance's local state currently believes the provider is clear.
// Short enough that a fresh instance discovers another instance's cooldown
// promptly (within one benchmark shard's typical per-prompt cadence); long
// enough that a high-QPS run doesn't turn this into a read on every call.
const SYNC_INTERVAL_MS = 20_000;

const _localUntil = new Map<string, number>();
const _lastSyncedAt = new Map<string, number>();

let _tableEnsured = false;
async function ensureTable(): Promise<void> {
  if (_tableEnsured) return;
  try {
    await getClient().execute(`
      CREATE TABLE IF NOT EXISTS provider_cooldowns (
        provider_model TEXT    PRIMARY KEY,
        until_ts        INTEGER NOT NULL,
        reason          TEXT,
        updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    _tableEnsured = true;
  } catch {
    // Non-fatal — falls back to local-only cooldown behavior (the pre-fix
    // per-instance behavior), never blocks the actual provider call.
  }
}

function key(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/**
 * Returns true if this provider:model should be SKIPPED right now — no
 * request should be sent. Fast path: if local state already believes it's
 * on cooldown, return immediately with zero I/O (the common case once any
 * cooldown has been discovered). Otherwise, at most once per
 * SYNC_INTERVAL_MS for this key, check Turso in case ANOTHER concurrent
 * instance marked a cooldown this instance doesn't know about yet — then
 * cache that result locally for the same interval, so repeated calls within
 * the window don't each pay a Turso round-trip.
 */
export async function isOnCooldown(provider: string, model: string): Promise<boolean> {
  const k = key(provider, model);
  const now = Date.now();

  const localUntil = _localUntil.get(k);
  if (localUntil !== undefined && now < localUntil) return true; // fast path, zero I/O

  const lastSynced = _lastSyncedAt.get(k) ?? 0;
  if (now - lastSynced < SYNC_INTERVAL_MS) return false; // recently confirmed clear, trust it, no I/O

  // Due for a cross-instance check.
  _lastSyncedAt.set(k, now);
  try {
    await ensureTable();
    const r = await getClient().execute({
      sql: 'SELECT until_ts FROM provider_cooldowns WHERE provider_model = ?',
      args: [k],
    });
    if (r.rows.length) {
      const untilTs = Number(r.rows[0].until_ts);
      if (untilTs > now) {
        _localUntil.set(k, untilTs);
        return true;
      }
    }
    return false;
  } catch {
    return false; // Turso unavailable this check — degrade to "assume clear", never block the call
  }
}

/**
 * Marks provider:model on cooldown for durationMs. Local effect is
 * immediate (this instance's very next call to the same provider:model
 * skips it, zero I/O). The Turso write is fire-and-forget — the caller
 * (which just got a 429 and needs to fall through to the next provider in
 * its chain) is never made to wait on it. Other concurrent instances will
 * see it on their own next sync check, within SYNC_INTERVAL_MS.
 */
export function markCooldown(provider: string, model: string, durationMs: number, reason: string): void {
  const k = key(provider, model);
  const until = Date.now() + durationMs;
  _localUntil.set(k, until);
  _lastSyncedAt.set(k, Date.now()); // just set locally — no need to immediately re-sync

  void (async () => {
    try {
      await ensureTable();
      await getClient().execute({
        sql: `INSERT INTO provider_cooldowns (provider_model, until_ts, reason, updated_at)
              VALUES (?, ?, ?, unixepoch())
              ON CONFLICT(provider_model) DO UPDATE SET
                until_ts   = excluded.until_ts,
                reason     = excluded.reason,
                updated_at = excluded.updated_at`,
        args: [k, until, reason],
      });
    } catch {
      // Non-fatal — this instance still has the local cooldown applied;
      // other instances simply won't learn about it until they discover it
      // themselves. No worse than pre-fix behavior, never better than that
      // alone is the point of this module.
    }
  })();
}
