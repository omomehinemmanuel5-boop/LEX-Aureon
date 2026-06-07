/**
 * Turso (libSQL) persistence layer for Lex Aureon.
 * Single backend. No in-memory fallback. No silent failures.
 */

import { createClient, type Client } from '@libsql/client';
import { env } from './env';
import { SOVEREIGN_LAWS } from './sovereign_laws';

let _client: Client | null = null;

export function getClient(): Client {
  if (_client) return _client;
  _client = createClient({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });
  return _client;
}

// Proxy that forwards all property access to the real client.
// IMPORTANT: methods must be bound to the real client, not the Proxy target.
// Without .bind(c), `this` inside libsql methods (which use private class
// fields like #promiseLimitFunction) will be the Proxy target — causing
// "Cannot read private member" errors at runtime.
export const db = new Proxy({} as Client, {
  get(_, prop: string | symbol) {
    const c = getClient() as unknown as Record<string | symbol, unknown>;
    const value = c[prop];
    return typeof value === 'function' ? (value as Function).bind(c) : value;
  },
}) as Client;
