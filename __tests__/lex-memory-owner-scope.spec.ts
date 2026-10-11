import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  it('does not write a memory event without an owner_id', async () => {
    await storeMemory(memory('', 'shared-session', 'no owner'));
    expect(execute).not.toHaveBeenCalled();
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
});
