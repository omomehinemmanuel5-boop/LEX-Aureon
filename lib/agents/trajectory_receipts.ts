import crypto from 'crypto';
import { getClient } from '../db';
import type { TrajectoryState } from './trajectory_governance';

let schemaEnsured = false;

async function ensureSchema(): Promise<void> {
  if (schemaEnsured) return;
  await getClient().execute(`CREATE TABLE IF NOT EXISTS trajectory_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id TEXT,
    session_id TEXT NOT NULL,
    action_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    args_hash TEXT NOT NULL,
    state_before_hash TEXT NOT NULL,
    state_after_hash TEXT NOT NULL,
    actual_effect_hash TEXT NOT NULL,
    approved INTEGER NOT NULL,
    decision TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await getClient().execute('CREATE INDEX IF NOT EXISTS idx_trajectory_receipts_session ON trajectory_receipts(session_id)');
  schemaEnsured = true;
}

function hash(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface TrajectoryReceiptInput {
  receiptId?: string | null;
  sessionId: string;
  actionId: string;
  toolName: string;
  args: Record<string, unknown>;
  stateBefore: TrajectoryState;
  stateAfter: TrajectoryState;
  actualEffect: string;
  approved: boolean;
  decision: string;
}

/** Persists trajectory evidence without storing raw arguments or tool output. */
export async function writeTrajectoryReceipt(input: TrajectoryReceiptInput): Promise<void> {
  await ensureSchema();
  await getClient().execute({
    sql: `INSERT INTO trajectory_receipts
      (receipt_id, session_id, action_id, tool_name, args_hash, state_before_hash,
       state_after_hash, actual_effect_hash, approved, decision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      input.receiptId ?? null,
      input.sessionId,
      input.actionId,
      input.toolName,
      hash(input.args),
      hash(input.stateBefore),
      hash(input.stateAfter),
      hash(input.actualEffect),
      input.approved ? 1 : 0,
      input.decision,
    ],
  });
}
