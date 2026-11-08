import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  statements: [] as Array<{ sql: string; args: unknown[] }>,
  apiKeys: {} as Record<string, string>,
  activeEmails: new Set<string>(),
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({
    execute: async ({ sql, args = [] }: { sql: string; args?: unknown[] }) => {
      db.statements.push({ sql, args });
      if (sql.includes('CREATE TABLE')) return { rows: [], rowsAffected: 0 };
      if (sql.includes('FROM api_keys')) {
        const email = db.apiKeys[String(args[0])];
        return { rows: email ? [{ email }] : [], rowsAffected: 0 };
      }
      if (sql.includes('FROM account_quarantine') && sql.includes('cleared_at IS NULL')) {
        return { rows: db.activeEmails.has(String(args[0])) ? [{ active: 1 }] : [], rowsAffected: 0 };
      }
      return { rows: [], rowsAffected: 1 };
    },
  }),
}));

import {
  keyIdFromSession,
  emailForSession,
  markAccountQuarantined,
  isAccountQuarantined,
} from '../lib/agents/account_quarantine';

describe('account-level quarantine', () => {
  beforeEach(() => {
    db.statements.length = 0;
    db.apiKeys = { key_abc: 'Owner@Example.com', key_xyz: 'owner@example.com' };
    db.activeEmails = new Set();
  });

  it('reads the key id from an owner session and returns null for other session IDs', () => {
    expect(keyIdFromSession('key_abc:mcp-0123456789ab')).toBe('key_abc');
    expect(keyIdFromSession('mcp-0123456789ab')).toBeNull();
    expect(keyIdFromSession(':mcp-x')).toBeNull();
  });

  it('maps a session to its account email, normalized to lowercase', async () => {
    expect(await emailForSession('key_abc:mcp-0123456789ab')).toBe('owner@example.com');
    expect(await emailForSession('unknown:mcp-1')).toBeNull();
  });

  it('flags the account for any session of that email, across keys', async () => {
    await markAccountQuarantined('key_abc:mcp-0123456789ab', 1000);
    const write = db.statements.find(s => s.sql.includes('INSERT INTO account_quarantine'));
    expect(write?.args[0]).toBe('owner@example.com');
    db.activeEmails.add('owner@example.com');
    expect(await isAccountQuarantined('key_xyz:mcp-fresh')).toBe(true);
  });

  it('does not report quarantine for an account with no active flag', async () => {
    expect(await isAccountQuarantined('key_abc:mcp-0123456789ab')).toBe(false);
  });

  it('returns false for sessions that cannot be mapped to an account', async () => {
    expect(await isAccountQuarantined('operator-session-without-key')).toBe(false);
  });
});
