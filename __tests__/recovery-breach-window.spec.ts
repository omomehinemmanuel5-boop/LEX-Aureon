import { describe, it, expect, vi, beforeEach } from 'vitest';

const fake = vi.hoisted(() => ({
  breachRows: [] as Array<Record<string, unknown>>,
  recentRows: [] as Array<Record<string, unknown>>,
  failCanaryQuery: false,
}));

vi.mock('../lib/db', () => ({
  getClient: () => ({
    execute: async ({ sql }: { sql: string; args?: unknown[] }) => {
      if (fake.failCanaryQuery && sql.includes('recovery_canary_evidence')) throw new Error('db down');
      if (sql.includes('recovery_canary_evidence')) return { rows: [] };
      if (sql.includes("LIKE 'recovery-canary-breach-%'")) return { rows: fake.breachRows };
      if (sql.includes('ORDER BY id DESC')) return { rows: fake.recentRows };
      return { rows: [] };
    },
  }),
}));

import { readRecoveryEpisodeBreachCount, RECOVERY_RECEIPT_WINDOW } from '../lib/agents/recovery_runtime';

function clean(i: number) {
  return {
    id: i,
    receipt_id: `r-${i}`,
    created_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
    state_snapshot: '{}',
  };
}

describe('recovery breach count over long histories', () => {
  beforeEach(() => {
    fake.breachRows = [];
    fake.recentRows = [];
    fake.failCanaryQuery = false;
  });

  it('does not pin a long clean session at the maximum spacing', async () => {
    fake.recentRows = Array.from({ length: RECOVERY_RECEIPT_WINDOW }, (_, k) => clean(RECOVERY_RECEIPT_WINDOW - k + 10));
    expect(await readRecoveryEpisodeBreachCount('s')).toBe(0);
  });

  it('still counts a breach that is older than the receipt window', async () => {
    fake.breachRows = [{
      id: 1,
      receipt_id: 'recovery-canary-breach-1',
      created_at: new Date(Date.UTC(2025, 0, 1)).toISOString(),
      state_snapshot: '{}',
    }];
    fake.recentRows = Array.from({ length: RECOVERY_RECEIPT_WINDOW }, (_, k) => clean(RECOVERY_RECEIPT_WINDOW - k + 10));
    expect(await readRecoveryEpisodeBreachCount('s')).toBe(1);
  });

  it('fails safe to the maximum spacing when history cannot be read', async () => {
    fake.failCanaryQuery = true;
    expect(await readRecoveryEpisodeBreachCount('s')).toBe(2);
  });
});
