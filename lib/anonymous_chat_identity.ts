import crypto from 'crypto';

export const ANONYMOUS_CHAT_COOKIE = 'lex_anon';
export const ANONYMOUS_CHAT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export interface AnonymousChatIdentity {
  ownerId: string;
  sessionId: string;
  setCookie?: string;
}

function isCanonicalRandomId(value: string): boolean {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.length === 16 && decoded.toString('base64url') === value;
  } catch {
    return false;
  }
}

function cookieValue(header: string | null): string | null {
  if (!header || header.length > 8192) return null;
  const matches = header.split(';').map(part => part.trim())
    .filter(part => part.startsWith(`${ANONYMOUS_CHAT_COOKIE}=`));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(ANONYMOUS_CHAT_COOKIE.length + 1);
  return isCanonicalRandomId(value) ? value : null;
}

export function namespaceAnonymousSession(ownerId: string, clientSessionId: string): string {
  const prefix = `${ownerId}:`;
  return clientSessionId.startsWith(prefix) ? clientSessionId : `${prefix}${clientSessionId}`;
}

/**
 * Identity is derived only from the first-party cookie. Client body fields,
 * query parameters, and owner headers are intentionally never consulted.
 * Missing or malformed cookies are replaced with a fresh random 128-bit ID.
 */
export function resolveAnonymousChatIdentity(
  req: Request,
  clientSessionId: string,
): AnonymousChatIdentity | null {
  let header: string | null;
  try {
    header = req.headers.get('cookie');
  } catch {
    return null;
  }
  let id = header ? cookieValue(header) : null;
  let setCookie: string | undefined;
  if (!id) {
    try {
      id = crypto.randomBytes(16).toString('base64url');
      if (!isCanonicalRandomId(id)) return null;
      setCookie = `${ANONYMOUS_CHAT_COOKIE}=${id}; Max-Age=${ANONYMOUS_CHAT_COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`;
    } catch {
      return null;
    }
  }
  const ownerId = `anon:${id}`;
  return { ownerId, sessionId: namespaceAnonymousSession(ownerId, clientSessionId), setCookie };
}
