/**
 * lib/safe_error.ts
 *
 * Maps internal exceptions to a user-safe message for public endpoints.
 *
 * Why (2026-07-20): the console streamed RAW internal error text to end
 * users — during the 2026-07-14 Turso read-quota incident, visitors saw
 * `LibsqlError: ... reads are blocked, do you need to upgrade your plan?`
 * complete with the database hostname, in the terminal UI. Infrastructure
 * detail (DB hostnames, provider quota state, stack fragments) is an
 * information leak and reads as broken; the full error already goes to the
 * structured logger (and the log drain, when configured) — the user only
 * needs to know the request can't be served right now.
 *
 * Usage: `publicError(scope, e)` logs the real error server-side and
 * returns the generic message to send to the client. Admin-gated or
 * secret-gated endpoints can keep returning detailed errors — this is for
 * surfaces anonymous users see.
 */
import { logger, errorFields } from './logger';

export const PUBLIC_ERROR_MESSAGE =
  'The governance backend is temporarily unavailable. The request was not completed — please try again shortly.';

export function publicError(scope: string, e: unknown): string {
  logger.error(scope, 'internal error (sanitized for client)', errorFields(e));
  return PUBLIC_ERROR_MESSAGE;
}
