const OFFICIAL_LEX_ORIGINS = new Set([
  'https://lexaureon.com',
  'https://www.lexaureon.com',
]);

/**
 * Prefer the explicit Origin header. Some WebKit form-navigation requests
 * omit Origin; accept those only when Fetch Metadata proves a same-origin
 * top-level HTML form navigation. Referer is intentionally suppressed on
 * approval pages to protect the bearer-capability URL.
 *
 * An explicit invalid Origin (including "null") always fails closed.
 */
export function isTrustedApprovalOrigin(req: Request): boolean {
  const suppliedOrigin = req.headers.get('origin');

  if (suppliedOrigin !== null) {
    try {
      const parsedOrigin = new URL(suppliedOrigin);
      return parsedOrigin.origin === suppliedOrigin
        && OFFICIAL_LEX_ORIGINS.has(parsedOrigin.origin);
    } catch {
      return false;
    }
  }

  const fetchSite = req.headers.get('sec-fetch-site');
  const fetchMode = req.headers.get('sec-fetch-mode');
  const fetchDest = req.headers.get('sec-fetch-dest');
  const contentType = req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();

  return req.method === 'POST'
    && fetchSite === 'same-origin'
    && fetchMode === 'navigate'
    && fetchDest === 'document'
    && contentType === 'application/x-www-form-urlencoded';
}
