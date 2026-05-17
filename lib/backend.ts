/**
 * Resolve the upstream Lex API base URL.
 * In production the env var is required — we fail-fast rather than silently
 * routing user credentials to a hardcoded default that may not be deployed.
 */
export function getBackendUrl(): string {
  const url = process.env.LEX_API_BASE_URL;
  if (url) return url.replace(/\/+$/, '');
  if (process.env.NODE_ENV === 'production') {
    throw new Error('LEX_API_BASE_URL is not configured');
  }
  return 'https://api.lexaureon.com';
}
