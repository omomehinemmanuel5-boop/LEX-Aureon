import { getClient } from './db';
import { logger } from './logger';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

let _schemaReady = false;
async function ensureSchema(): Promise<void> {
  if (_schemaReady) return;
  await getClient().execute(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key          TEXT PRIMARY KEY,
      count        INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL
    )
  `);
  _schemaReady = true;
}

// Sliding-window rate limit on Turso. Atomic via INSERT ... ON CONFLICT DO UPDATE.
//   key            — unique identifier for the limited resource ("lex.run:<ip>")
//   limit          — max requests allowed within the window
//   windowSeconds  — window length in seconds
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    await ensureSchema();
    const result = await getClient().execute({
      sql: `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET
              count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END,
              window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END
            RETURNING count, window_start`,
      args: [key, now, windowStart, windowStart, now],
    });

    const row = result.rows[0];
    const count = (row?.count as number) ?? 0;
    const ws    = (row?.window_start as number) ?? now;
    const allowed = count <= limit;
    const remaining = Math.max(0, limit - count);
    const retryAfter = allowed ? 0 : Math.max(1, Math.ceil((ws + windowMs - now) / 1000));

    return { allowed, remaining, retryAfter };
  } catch (e) {
    // Storage outage shouldn't gate user traffic — fail open and surface in logs.
    logger.warn('rate_limit', 'turso rate limit failed, failing open', { error: String(e) });
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}
