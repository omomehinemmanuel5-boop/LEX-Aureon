const OFFICIAL_LEX_ORIGINS = new Set([
  'https://lexaureon.com',
  'https://www.lexaureon.com',
]);

function isOfficialOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.origin === value && OFFICIAL_LEX_ORIGINS.has(parsed.origin);
  } catch {
    return false;
  }
}

/** Strict Origin validation retained for account and key-management routes. */
export function isTrustedApprovalOrigin(req: Request): boolean {
  const suppliedOrigin = req.headers.get('origin');
  return suppliedOrigin !== null && isOfficialOrigin(suppliedOrigin);
}

/**
 * Approval links use no-referrer to avoid leaking their bearer capability.
 * When WebKit omits Origin on a native form navigation, use Fetch Metadata as
 * a narrowly scoped fallback. Explicit invalid Origins always fail closed.
 */
export function isTrustedApprovalDecisionOrigin(req: Request): boolean {
  const suppliedOrigin = req.headers.get('origin');
  if (suppliedOrigin !== null) return isOfficialOrigin(suppliedOrigin);

  const contentType = req.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  return req.method === 'POST'
    && req.headers.get('sec-fetch-site') === 'same-origin'
    && req.headers.get('sec-fetch-mode') === 'navigate'
    && req.headers.get('sec-fetch-dest') === 'document'
    && contentType === 'application/x-www-form-urlencoded';
}
