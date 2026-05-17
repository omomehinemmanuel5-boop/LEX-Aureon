import { kv } from '@vercel/kv';
import { logger } from './logger';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

const mem = new Map<string, { count: number; resetAt: number }>();

function hasKV(): boolean {
  return !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;

  if (hasKV()) {
    try {
      const fullKey = `rl:${key}`;
      const count = await kv.incr(fullKey);
      if (count === 1) {
        await kv.expire(fullKey, windowSeconds);
      }
      const ttl = await kv.ttl(fullKey);
      const allowed = count <= limit;
      return {
        allowed,
        remaining: Math.max(0, limit - count),
        retryAfter: allowed ? 0 : Math.max(1, ttl ?? windowSeconds),
      };
    } catch (e) {
      logger.warn('rate_limit', 'KV rate limit failed, falling back to memory', { error: String(e) });
    }
  }

  const now = Date.now();
  const entry = mem.get(key);
  if (!entry || entry.resetAt < now) {
    mem.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }
  entry.count += 1;
  const allowed = entry.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - entry.count),
    retryAfter: allowed ? 0 : Math.ceil((entry.resetAt - now) / 1000),
  };
}
