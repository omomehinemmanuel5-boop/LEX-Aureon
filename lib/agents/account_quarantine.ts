import { getClient } from '../db';

/**
 * Account-level quarantine. Quarantine follows the account (the API key's email),
 * not the key, so rotating keys does not start a fresh trajectory on an
 * account that is currently quarantined.
 *
 * A flag is set whenever any session owned by an email drops below the floor.
 * While the flag is active, a new session for that email bootstraps already
 * below the floor. The owner clears the flag by resetting a quarantined session.
 */

let schemaReady: Promise<void> | null = null;

export function initAccountQuarantineSchema(): Promise<void> {
  schemaReady ??= getClient()
    .execute({
      sql: `CREATE TABLE IF NOT EXISTS account_quarantine (
        email          TEXT PRIMARY KEY,
        session_id     TEXT NOT NULL,
        quarantined_at INTEGER NOT NULL,
        cleared_at     INTEGER
      )`,
    })
    .then(() => undefined);
  return schemaReady;
}

/** Owner sessions are "<key id>:<...>". Returns the key id, or null for other session IDs. */
export function keyIdFromSession(sessionId: string): string | null {
  const i = sessionId.indexOf(':');
  return i > 0 ? sessionId.slice(0, i) : null;
}

export async function emailForSession(sessionId: string): Promise<string | null> {
  const keyId = keyIdFromSession(sessionId);
  if (!keyId) return null;
  const result = await getClient().execute({
    sql: 'SELECT email FROM api_keys WHERE id = ? LIMIT 1',
    args: [keyId],
  });
  const email = result.rows?.[0]?.email;
  return typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
}

export async function markAccountQuarantined(sessionId: string, nowMs: number = Date.now()): Promise<void> {
  await initAccountQuarantineSchema();
  const email = await emailForSession(sessionId);
  if (!email) return;
  await getClient().execute({
    sql: `INSERT INTO account_quarantine (email, session_id, quarantined_at, cleared_at)
          VALUES (?, ?, ?, NULL)
          ON CONFLICT(email) DO UPDATE SET
            session_id = excluded.session_id,
            quarantined_at = excluded.quarantined_at,
            cleared_at = NULL`,
    args: [email, sessionId, nowMs],
  });
}

export async function isAccountQuarantined(sessionId: string): Promise<boolean> {
  await initAccountQuarantineSchema();
  const email = await emailForSession(sessionId);
  if (!email) return false;
  const result = await getClient().execute({
    sql: 'SELECT 1 AS active FROM account_quarantine WHERE email = ? AND cleared_at IS NULL LIMIT 1',
    args: [email],
  });
  return (result.rows?.length ?? 0) > 0;
}
