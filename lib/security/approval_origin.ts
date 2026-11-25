const OFFICIAL_LEX_ORIGINS = new Set([
  'https://lexaureon.com',
  'https://www.lexaureon.com',
]);

/**
 * Validate browser POST origins for the public, request-scoped approval
 * capability. Trust only Lex's exact HTTPS production origins. Do not make
 * approval availability depend on NEXT_PUBLIC_SITE_URL: that value may be
 * configured to a preview/deployment URL even while the request is served
 * through a verified Lex custom domain.
 *
 * Missing, malformed, non-canonical, and unrelated origins fail closed.
 */
export function isTrustedApprovalOrigin(req: Request): boolean {
  const suppliedOrigin = req.headers.get('origin');
  if (!suppliedOrigin) return false;

  try {
    const parsedOrigin = new URL(suppliedOrigin);
    return parsedOrigin.origin === suppliedOrigin
      && OFFICIAL_LEX_ORIGINS.has(parsedOrigin.origin);
  } catch {
    return false;
  }
}
