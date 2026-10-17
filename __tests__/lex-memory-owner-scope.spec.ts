import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { execute, rows } = vi.hoisted(() => ({
  execute: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({
    execute: async (query: string | { sql: string; args?: unknown[] }) => {
      const sql = typeof query === 'string' ? query : query.sql;
      const args = typeof query === 'string' ? [] : (query.args ?? []);
      if (sql.includes('INSERT INTO lex_memory')) {
        execute(sql, args);
        return { rows: [] };
      }
      if (sql.includes('FROM lex_memory')) {
        const ownerId = sql.includes('owner_id = ?')
          ? String(args[sql.includes('session_id = ? AND owner_id = ?') ? 1 : 0])
          : undefined;
        const sessionId = sql.includes('session_id = ?') ? String(args[0]) : undefined;
        const selected = rows.filter(row =>
          (ownerId === undefined || row.owner_id === ownerId)
          && (sessionId === undefined || row.session_id === sessionId),
        );
        return { rows: selected };
      }
      return { rows: [] };
    },
  }),
}));

import { getSessionCentroid, retrieveSessionHistory, retrieveSimilar, storeMemory } from '../lib/lex_memory';
import { resolveAnonymousChatIdentity } from '../lib/anonymous_chat_identity';

function memory(owner_id: string, session_id: string, prompt: string) {
  return {
    owner_id,
    session_id,
    prompt,
    prompt_hash: `${owner_id}-${prompt}`,
    embedding: [1, 0],
    M: 0.8,
    C: 0.8,
    R: 0.8,
    S: 0.8,
    health_band: 'OPTIMAL',
    state_label: 'STABLE' as const,
    intervention: false,
  };
}

describe('lex_memory owner isolation', () => {
  beforeEach(() => {
    rows.splice(0, rows.length,
      { ...memory('owner-a', 'shared-session', 'A prompt'), embedding: '[1,0]', created_at: '2026-01-02' },
      { ...memory('owner-b', 'shared-session', 'B prompt'), embedding: '[1,0]', created_at: '2026-01-01' },
      { ...memory('owner-b', 'private-session', 'B private'), embedding: '[1,0]', created_at: '2026-01-03' },
    );
    execute.mockClear();
  });

  it('does not write or emit an error for a memory event without an owner_id', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await storeMemory(memory('', 'shared-session', 'no owner'));
      expect(execute).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('never returns owner B semantic memories to owner A', async () => {
    const found = await retrieveSimilar([1, 0], 'owner-a');
    expect(found.map(item => item.past_prompt)).toEqual(['A prompt']);
  });

  it("does not return another owner's session history even when given that session ID", async () => {
    const found = await retrieveSessionHistory('private-session', 'owner-a');
    expect(found).toEqual([]);
  });

  it('returns null without querying the database when owner_id is empty', async () => {
    expect(await getSessionCentroid('shared-session', '')).toBeNull();
  });

  it('gives two browsers with the same raw session label separate memory namespaces', async () => {
    const browserA = resolveAnonymousChatIdentity(new Request('https://site.example/chat'), 'shared-session')!;
    const browserB = resolveAnonymousChatIdentity(new Request('https://site.example/chat'), 'shared-session')!;
    expect(browserA.ownerId).not.toBe(browserB.ownerId);
    expect(browserA.sessionId).not.toBe(browserB.sessionId);
    rows.push(
      { ...memory(browserA.ownerId, browserA.sessionId, 'browser A history'), embedding: '[1,0]', created_at: '2026-10-01' },
      { ...memory(browserB.ownerId, browserB.sessionId, 'browser B history'), embedding: '[1,0]', created_at: '2026-10-02' },
    );
    const historyA = await retrieveSessionHistory(browserA.sessionId, browserA.ownerId);
    const historyB = await retrieveSessionHistory(browserB.sessionId, browserB.ownerId);
    expect(historyA.map(item => item.past_prompt)).toEqual(['browser A history']);
    expect(historyB.map(item => item.past_prompt)).toEqual(['browser B history']);
  });

  it('issues a new 16-byte owner cookie when missing or malformed and ignores client owner fields', () => {
    const missing = resolveAnonymousChatIdentity(new Request('https://site.example/chat', {
      headers: { 'x-lex-owner': 'attacker-owner' },
    }), 'same-session')!;
    const malformed = resolveAnonymousChatIdentity(new Request('https://site.example/chat', {
      headers: { cookie: 'lex_anon=not-a-valid-id', 'x-lex-owner': missing.ownerId },
    }), 'same-session')!;
    expect(missing.ownerId).not.toBe('attacker-owner');
    expect(malformed.ownerId).not.toBe(missing.ownerId);
    expect(missing.ownerId).toMatch(/^anon:[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(missing.ownerId.slice(5), 'base64url')).toHaveLength(16);
    expect(missing.sessionId).toBe(`${missing.ownerId}:same-session`);
    expect(missing.setCookie).toContain('HttpOnly');
    expect(missing.setCookie).toContain('Secure');
    expect(missing.setCookie).toContain('SameSite=Lax');
    expect(missing.setCookie).toContain('Max-Age=31536000');
  });

  it('reuses a valid first-party cookie and never doubles its own session prefix', () => {
    const first = resolveAnonymousChatIdentity(new Request('https://site.example/chat'), 'session')!;
    const cookie = first.setCookie!.split(';')[0];
    const second = resolveAnonymousChatIdentity(new Request('https://site.example/chat', {
      headers: { cookie },
    }), first.sessionId)!;
    expect(second.ownerId).toBe(first.ownerId);
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.setCookie).toBeUndefined();
  });

  it('fails closed when the request cookie header cannot be read', () => {
    const unreadable = { headers: { get: () => { throw new Error('unreadable'); } } } as unknown as Request;
    expect(resolveAnonymousChatIdentity(unreadable, 'shared-session')).toBeNull();
  });

  it('uses the cookie-derived owner and scoped session for every chat memory operation before starting the stream', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/api/lex/govern/stream/route.ts'), 'utf8');
    expect(source).toContain('resolveAnonymousChatIdentity(req, clientSessionId)');
    expect(source).toContain('const { ownerId, sessionId: session_id } = anonymousIdentity;');
    expect(source).toContain('retrieveSessionHistory(session_id, ownerId, 6)');
    expect(source).toContain('retrieveSimilar(promptEmbedding, ownerId, 5)');
    expect(source).toContain('getSessionCentroid(session_id, ownerId)');
    expect(source).toContain('storeMemory({ owner_id: ownerId, session_id');
    expect(source.indexOf('responseHeaders.append(\'Set-Cookie\'' )).toBeLessThan(source.indexOf('const stream = new ReadableStream'));
    expect(source).not.toContain('retrieveSessionHistory(session_id, \'\'');
    expect(source).not.toContain('retrieveSimilar(promptEmbedding, \'\'');
    expect(source).not.toContain('storeMemory({ owner_id: \'\'');
  });
});
