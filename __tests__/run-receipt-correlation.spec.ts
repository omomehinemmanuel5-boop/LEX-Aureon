import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ inserts: [] as Array<{ sql: string; args: unknown[] }> }));

vi.mock('../lib/db', () => ({
  getClient: () => ({
    execute: async ({ sql, args = [] }: { sql: string; args?: unknown[] }) => {
      if (sql.includes('INSERT INTO tool_receipts')) h.inserts.push({ sql, args });
      return { rows: [], rowsAffected: 1 };
    },
  }),
  runZTrajMigrations: async () => undefined,
}));

import { runWithRunId, currentRunId } from '../lib/agents/run_context';
import { writeGovernanceReceipt } from '../lib/agents/governance_commit';

const receipt = {
  receipt_id: 'TCR-TEST-1',
  session_id: 'key_own:mcp-abc',
  actor_id: 'api_key:key_own',
  tool_name: 'read_file',
  args_hash: 'hash',
  decision: 'APPROVED',
  crs: { C: 0.3, R: 0.3, S: 0.4, M: 0.3, risk_level: 'ULTRA_LOW' },
  reason: 'test',
  sigma_viol: 0,
} as never;

describe('run identity propagates to receipts', () => {
  beforeEach(() => {
    h.inserts.length = 0;
  });

  it('has no run identity outside a run, and the run identity inside it', async () => {
    expect(currentRunId()).toBeNull();
    const seen = await runWithRunId('run-A', async () => {
      await Promise.resolve();
      return currentRunId();
    });
    expect(seen).toBe('run-A');
    expect(currentRunId()).toBeNull();
  });

  it('keeps two concurrent runs separate', async () => {
    const [a, b] = await Promise.all([
      runWithRunId('run-A', async () => { await new Promise(r => setTimeout(r, 5)); return currentRunId(); }),
      runWithRunId('run-B', async () => currentRunId()),
    ]);
    expect(a).toBe('run-A');
    expect(b).toBe('run-B');
  });

  it('stores the run identity on a receipt written during that run', async () => {
    await runWithRunId('run-A', () => writeGovernanceReceipt(receipt));
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0].sql).toContain('run_id');
    expect(h.inserts[0].args[h.inserts[0].args.length - 1]).toBe('run-A');
  });

  it('stores null for a receipt written outside any run', async () => {
    await writeGovernanceReceipt(receipt);
    expect(h.inserts[0].args[h.inserts[0].args.length - 1]).toBeNull();
  });
});
