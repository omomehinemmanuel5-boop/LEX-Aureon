import { env } from '@/lib/env';

const OFFICIAL_LEX_ORIGINS = new Set([
  'https://lexaureon.com',
  'https://www.lexaureon.com',
]);

/**
 * Validate browser POST origins for the operator approval surface.
 * The deployment's configured origin remains authoritative; in production,
 * also accept the two HTTPS aliases owned by Lex because the apex redirects
 * to www and mobile browsers may preserve the original origin on form posts.
 * Missing, malformed, and unrelated origins fail closed.
 */
export function isTrustedApprovalOrigin(req: Request): boolean {
  const suppliedOrigin = req.headers.get('origin');
  if (!suppliedOrigin) return false;

  try {
    const parsedOrigin = new URL(suppliedOrigin);
    if (parsedOrigin.origin !== suppliedOrigin) return false;

    const configuredOrigin = new URL(env.NEXT_PUBLIC_SITE_URL).origin;
    if (suppliedOrigin === configuredOrigin) return true;

    return OFFICIAL_LEX_ORIGINS.has(suppliedOrigin)
      && OFFICIAL_LEX_ORIGINS.has(configuredOrigin);
  } catch {
    return false;
  }
}
