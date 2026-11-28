import crypto from 'crypto';
import { getClient } from './db';
import { validateApiKey, getApiKeyById, getKeysByTenantId, generateApiKey } from './api_keys';
import { accountFromCookie } from './auth_accounts';

export const MCP_RESOURCE = 'https://www.lexaureon.com/api/mcp';
export const MCP_RESOURCES = [MCP_RESOURCE, 'https://lexaureon.com/api/mcp'] as const;
export function normalizeMcpResource(resource: string | null | undefined): string | null {
  if (resource == null) return MCP_RESOURCE;
  const normalized = resource.endsWith('/') ? resource.slice(0, -1) : resource;
  return (MCP_RESOURCES as readonly string[]).includes(normalized) ? normalized : null;
}
export function isMcpResource(resource: string): boolean {
  return normalizeMcpResource(resource) !== null;
}
export const MCP_ISSUER = 'https://www.lexaureon.com';
export const MCP_SCOPE = 'mcp';
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const CLIENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

function randomToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}
function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function validRedirectUri(uri: string): boolean {
  // OAuth clients register their exact callback URI before authorization.
  // Support arbitrary HTTPS callbacks (Claude, ChatGPT, and other MCP clients)
  // while allowing HTTP only for native-app loopback redirects.
  try {
    const parsed = new URL(uri);
    if (parsed.username || parsed.password || parsed.hash) return false;
    if (parsed.protocol === 'https:') return Boolean(parsed.hostname);
    if (parsed.protocol !== 'http:') return false;
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

export async function initMcpOAuthSchema(): Promise<void> {
  const db = getClient();
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
      client_id TEXT PRIMARY KEY, redirect_uris TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
      code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL,
      key_id TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL,
      code_challenge TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
    )`, args: [] },
    { sql: `CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
      access_hash TEXT PRIMARY KEY, refresh_hash TEXT UNIQUE, client_id TEXT NOT NULL,
      key_id TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      refresh_expires_at INTEGER NOT NULL, revoked_at INTEGER
    )`, args: [] },
  ], 'write');
}

export async function registerClient(input: { redirectUris: string[]; tokenEndpointAuthMethod?: string }) {
  await initMcpOAuthSchema();
  if (!input.redirectUris.length || input.redirectUris.length > 5 || input.redirectUris.some(uri => !validRedirectUri(uri))) {
    return { error: 'redirect_uris must contain an allowed ChatGPT OAuth redirect URI' } as const;
  }
  if (input.tokenEndpointAuthMethod && input.tokenEndpointAuthMethod !== 'none') {
    return { error: 'Only public PKCE clients (token_endpoint_auth_method=none) are supported' } as const;
  }
  const clientId = randomToken('lex_client');
  await getClient().execute({
    sql: 'INSERT INTO mcp_oauth_clients (client_id, redirect_uris, created_at, expires_at) VALUES (?, ?, ?, ?)',
    args: [clientId, JSON.stringify(input.redirectUris), Date.now(), Date.now() + CLIENT_TTL_MS],
  });
  return { clientId } as const;
}

async function getClientRedirects(clientId: string): Promise<string[] | null> {
  await initMcpOAuthSchema();
  const r = await getClient().execute({ sql: 'SELECT redirect_uris, expires_at FROM mcp_oauth_clients WHERE client_id = ?', args: [clientId] });
  if (!r.rows.length || Date.now() >= Number(r.rows[0].expires_at)) return null;
  try { return JSON.parse(String(r.rows[0].redirect_uris)) as string[]; } catch { return null; }
}

/** Validate the client/redirect pair before displaying any account credential form. */
export async function isRegisteredRedirectUri(clientId: string, redirectUri: string): Promise<boolean> {
  const redirects = await getClientRedirects(clientId);
  return Boolean(redirects?.includes(redirectUri) && validRedirectUri(redirectUri));
}

export async function createAuthorizationCode(input: {
  clientId: string; redirectUri: string; apiKey: string; scope: string; resource: string; codeChallenge: string;
}) {
  const redirects = await getClientRedirects(input.clientId);
  if (!redirects?.includes(input.redirectUri) || !validRedirectUri(input.redirectUri)) return { error: 'invalid_client' } as const;
  if (!isMcpResource(input.resource)) return { error: 'invalid_target' } as const;
  const requestedScopes = input.scope.split(/\s+/).filter(Boolean);
  if (!requestedScopes.includes(MCP_SCOPE) || requestedScopes.some(scope => scope !== MCP_SCOPE)) return { error: 'invalid_scope' } as const;
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) return { error: 'invalid_request' } as const;
  const checked = await validateApiKey(input.apiKey);
  if (!checked.valid || !checked.key) return { error: 'invalid_api_key' } as const;
  await initMcpOAuthSchema();
  const code = randomToken('lex_code');
  await getClient().execute({
    sql: `INSERT INTO mcp_oauth_codes
      (code_hash, client_id, redirect_uri, key_id, scope, resource, code_challenge, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [hash(code), input.clientId, input.redirectUri, checked.key.id, MCP_SCOPE, input.resource, input.codeChallenge, Date.now(), Date.now() + CODE_TTL_MS],
  });
  return { code } as const;
}

/**
 * Issue an OAuth code for a verified Lex account without asking the user to
 * copy an API secret into a third-party authorization form. The connection
 * is represented by a normal free-tier API key bound to the account tenant;
 * it never inherits operator/private_test or sovereign privileges.
 */
export async function createAuthorizationCodeForAccount(input: {
  clientId: string; redirectUri: string; cookieHeader: string | null;
  scope: string; resource: string; codeChallenge: string;
}) {
  const user = await accountFromCookie(input.cookieHeader);
  if (!user) return { error: 'account_required' } as const;
  const redirects = await getClientRedirects(input.clientId);
  if (!redirects?.includes(input.redirectUri) || !validRedirectUri(input.redirectUri)) return { error: 'invalid_client' } as const;
  if (!isMcpResource(input.resource)) return { error: 'invalid_target' } as const;
  const requestedScopes = input.scope.split(/\s+/).filter(Boolean);
  if (!requestedScopes.includes(MCP_SCOPE) || requestedScopes.some(scope => scope !== MCP_SCOPE)) return { error: 'invalid_scope' } as const;
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) return { error: 'invalid_request' } as const;

  const existing = await getKeysByTenantId(user.tenantId);
  let connectionKey = existing.find(key => key.name === 'ChatGPT MCP connection' && key.plan === 'free'
    && (key.expires_at === null || key.expires_at > Date.now()) && key.runs_used < key.runs_limit);
  if (!connectionKey) {
    if (existing.length >= 3) return { error: 'account_key_limit' } as const;
    const created = await generateApiKey({
      email: user.email, name: 'ChatGPT MCP connection', plan: 'free', tenantId: user.tenantId,
    });
    if (!created) return { error: 'account_key_unavailable' } as const;
    connectionKey = created;
  }

  await initMcpOAuthSchema();
  const code = randomToken('lex_code');
  await getClient().execute({
    sql: `INSERT INTO mcp_oauth_codes
      (code_hash, client_id, redirect_uri, key_id, scope, resource, code_challenge, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [hash(code), input.clientId, input.redirectUri, connectionKey.id, MCP_SCOPE, input.resource, input.codeChallenge, Date.now(), Date.now() + CODE_TTL_MS],
  });
  return { code } as const;
}

export async function exchangeAuthorizationCode(input: {
  code: string; clientId: string; redirectUri: string; codeVerifier: string; resource: string;
}) {
  await initMcpOAuthSchema();
  const db = getClient();
  const codeHash = hash(input.code);
  // Atomically claim the authorization code. A SELECT followed by DELETE is
  // replayable under concurrency: two requests can both read before either deletes.
  // DELETE ... RETURNING gives exactly one concurrent exchange the code row.
  const r = await db.execute({
    sql: `DELETE FROM mcp_oauth_codes
          WHERE code_hash = ? AND client_id = ? AND redirect_uri = ?
          RETURNING *`,
    args: [codeHash, input.clientId, input.redirectUri],
  });
  if (!r.rows.length) return { error: 'invalid_grant' } as const;
  const row = r.rows[0] as Record<string, unknown>;
  if (String(row.resource) !== input.resource || Date.now() >= Number(row.expires_at)) return { error: 'invalid_grant' } as const;
  const actual = crypto.createHash('sha256').update(input.codeVerifier).digest('base64url');
  if (actual !== String(row.code_challenge)) return { error: 'invalid_grant' } as const;
  if (!(await getApiKeyById(String(row.key_id)))) return { error: 'invalid_grant' } as const;
  return issueTokens({ clientId: input.clientId, keyId: String(row.key_id), scope: String(row.scope), resource: input.resource });
}

async function issueTokens(input: { clientId: string; keyId: string; scope: string; resource: string }) {
  await initMcpOAuthSchema();
  const access = randomToken('lex_at');
  const refresh = randomToken('lex_rt');
  const now = Date.now();
  await getClient().execute({
    sql: `INSERT INTO mcp_oauth_tokens
      (access_hash, refresh_hash, client_id, key_id, scope, resource, created_at, expires_at, refresh_expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [hash(access), hash(refresh), input.clientId, input.keyId, input.scope, input.resource, now, now + ACCESS_TTL_MS, now + REFRESH_TTL_MS],
  });
  return { access_token: access, token_type: 'Bearer', expires_in: Math.floor(ACCESS_TTL_MS / 1000), refresh_token: refresh, scope: input.scope };
}

export async function refreshAccessToken(input: { refreshToken: string; clientId: string; resource: string }) {
  await initMcpOAuthSchema();
  const db = getClient();
  const refreshHash = hash(input.refreshToken);
  // Rotate refresh tokens with a single conditional write. Only one concurrent
  // request can transition this token from active to revoked and receive a successor.
  const now = Date.now();
  const r = await db.execute({
    sql: `UPDATE mcp_oauth_tokens SET revoked_at = ?
          WHERE refresh_hash = ? AND client_id = ? AND resource = ?
            AND revoked_at IS NULL AND refresh_expires_at > ?
          RETURNING *`,
    args: [now, refreshHash, input.clientId, input.resource, now],
  });
  if (!r.rows.length) return { error: 'invalid_grant' } as const;
  const row = r.rows[0] as Record<string, unknown>;
  if (!(await getApiKeyById(String(row.key_id)))) return { error: 'invalid_grant' } as const;
  return issueTokens({ clientId: input.clientId, keyId: String(row.key_id), scope: String(row.scope), resource: input.resource });
}

export async function resolveAccessToken(token: string, resource?: string) {
  await initMcpOAuthSchema();
  const r = await getClient().execute({ sql: 'SELECT * FROM mcp_oauth_tokens WHERE access_hash = ? LIMIT 1', args: [hash(token)] });
  if (!r.rows.length) return { valid: false } as const;
  const row = r.rows[0] as Record<string, unknown>;
  const tokenResource = String(row.resource);
  const resourceMatches = resource ? tokenResource === resource : isMcpResource(tokenResource);
  if (row.revoked_at != null || Date.now() >= Number(row.expires_at) || !resourceMatches) return { valid: false } as const;
  const key = await getApiKeyById(String(row.key_id));
  if (!key) return { valid: false } as const;
  return { valid: true, keyId: String(row.key_id), scope: String(row.scope) } as const;
}
