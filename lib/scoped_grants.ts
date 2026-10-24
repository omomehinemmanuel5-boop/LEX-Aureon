import crypto from 'crypto';
import { getClient } from './db';

export const SCOPED_GRANT_TOOLS = ['create_branch', 'write_file', 'patch_file', 'open_pr'] as const;
export type ScopedGrantTool = typeof SCOPED_GRANT_TOOLS[number];

export interface ScopedGrantRecord {
  grant_id: string;
  owner_id: string;
  allowed_tools: ScopedGrantTool[];
  branch_prefixes: string[];
  path_prefixes: string[];
  max_uses: number;
  uses: number;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
}

export interface ScopedGrantInput {
  owner_id: string;
  allowed_tools: string[];
  branch_prefixes?: string[];
  path_prefixes: string[];
  max_uses: number;
  expires_at: number | string;
}

export interface ScopedGrantAction {
  ownerId: string;
  toolName: string;
  args: Record<string, unknown>;
  nowMs?: number;
  recoveryAllowed?: boolean;
}

function asStrings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(v => typeof v !== 'string' || !v.trim())) {
    throw new Error(`${field} must be a non-empty array of strings.`);
  }
  return [...new Set(value.map(v => (v as string).trim()))];
}

export function validateScopedGrantInput(input: ScopedGrantInput, nowMs = Date.now()) {
  if (!input || typeof input.owner_id !== 'string' || !input.owner_id.trim()) {
    throw new Error('owner_id is required.');
  }
  const allowedTools = asStrings(input.allowed_tools, 'allowed_tools');
  if (allowedTools.some(tool => !(SCOPED_GRANT_TOOLS as readonly string[]).includes(tool))) {
    throw new Error('allowed_tools must be a subset of create_branch, write_file, patch_file, and open_pr.');
  }
  const branchPrefixes = input.branch_prefixes === undefined
    ? ['govern/', 'fix/']
    : asStrings(input.branch_prefixes, 'branch_prefixes');
  if (branchPrefixes.some(prefix => prefix.toLowerCase().includes('main'))) {
    throw new Error('branch_prefixes must not include main.');
  }
  const pathPrefixes = asStrings(input.path_prefixes, 'path_prefixes');
  const maxUses = Number(input.max_uses);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 20) {
    throw new Error('max_uses must be an integer between 1 and 20.');
  }
  const expiresAt = typeof input.expires_at === 'number' ? input.expires_at : Date.parse(input.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) {
    throw new Error('expires_at must be in the future.');
  }
  if (expiresAt > nowMs + 60 * 60 * 1000) {
    throw new Error('expires_at must be no more than 60 minutes ahead.');
  }
  return {
    ownerId: input.owner_id.trim(),
    allowedTools: allowedTools as ScopedGrantTool[],
    branchPrefixes,
    pathPrefixes,
    maxUses,
    expiresAt,
  };
}

function parseArray(value: unknown): string[] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function branchFor(toolName: string, args: Record<string, unknown>): string {
  const value = toolName === 'open_pr' ? args.head : args.branch;
  return typeof value === 'string' ? value.trim() : '';
}

function isMainBranch(branch: string): boolean {
  return branch.toLowerCase() === 'main';
}

function isSafeRelativePath(path: string): boolean {
  return !path.startsWith('/')
    && !path.includes(String.fromCharCode(92))
    && !path.split('/').some(segment => segment === '.' || segment === '..');
}

export function scopedGrantMatchesAction(grant: ScopedGrantRecord, action: ScopedGrantAction): boolean {
  const now = action.nowMs ?? Date.now();
  if (action.recoveryAllowed === false) return false;
  if (!action.ownerId || action.ownerId !== grant.owner_id) return false;
  if (!(SCOPED_GRANT_TOOLS as readonly string[]).includes(action.toolName)
    || !grant.allowed_tools.includes(action.toolName as ScopedGrantTool)) return false;
  if (grant.revoked_at !== null || grant.uses >= grant.max_uses || now >= grant.expires_at) return false;
  const branch = branchFor(action.toolName, action.args);
  if (!branch || isMainBranch(branch) || !grant.branch_prefixes.some(prefix => branch.startsWith(prefix))) return false;
  if (action.toolName === 'open_pr') {
    if (action.args.base !== 'main') return false;
  }
  if (action.toolName === 'write_file' || action.toolName === 'patch_file') {
    const path = typeof action.args.path === 'string' ? action.args.path.trim() : '';
    if (!path || !isSafeRelativePath(path) || !grant.path_prefixes.some(prefix => path.startsWith(prefix))) return false;
  }
  return true;
}

export async function ensureScopedGrantSchema(): Promise<void> {
  const db = getClient();
  await db.execute(`CREATE TABLE IF NOT EXISTS scoped_grants (
    grant_id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    allowed_tools TEXT NOT NULL,
    branch_prefixes TEXT NOT NULL,
    path_prefixes TEXT NOT NULL,
    max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 20),
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at INTEGER NOT NULL
  )`);
  const alter = async (sql: string) => { try { await db.execute(sql); } catch { /* already migrated */ } };
  await alter('ALTER TABLE tool_receipts ADD COLUMN grant_id TEXT');
  await alter('ALTER TABLE tool_receipts ADD COLUMN grant_branch TEXT');
  await alter('ALTER TABLE tool_receipts ADD COLUMN grant_path TEXT');
  await alter('ALTER TABLE tool_receipts ADD COLUMN grant_use_number INTEGER');
  await db.execute('CREATE INDEX IF NOT EXISTS idx_scoped_grants_owner ON scoped_grants(owner_id)');
}

export async function createScopedGrant(input: ScopedGrantInput, operator: boolean, nowMs = Date.now()): Promise<ScopedGrantRecord> {
  if (!operator) throw new Error('Operator authority is required to create a scoped grant.');
  const normalized = validateScopedGrantInput(input, nowMs);
  const grantId = crypto.randomUUID();
  await ensureScopedGrantSchema();
  await getClient().execute({
    sql: `INSERT INTO scoped_grants
      (grant_id, owner_id, allowed_tools, branch_prefixes, path_prefixes, max_uses, uses, expires_at, revoked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)`,
    args: [grantId, normalized.ownerId, JSON.stringify(normalized.allowedTools), JSON.stringify(normalized.branchPrefixes),
      JSON.stringify(normalized.pathPrefixes), normalized.maxUses, normalized.expiresAt, nowMs],
  });
  return {
    grant_id: grantId, owner_id: normalized.ownerId, allowed_tools: normalized.allowedTools,
    branch_prefixes: normalized.branchPrefixes, path_prefixes: normalized.pathPrefixes,
    max_uses: normalized.maxUses, uses: 0, expires_at: normalized.expiresAt, revoked_at: null, created_at: nowMs,
  };
}

export async function revokeScopedGrant(grantId: string, operator: boolean, nowMs = Date.now()): Promise<boolean> {
  if (!operator) throw new Error('Operator authority is required to revoke a scoped grant.');
  if (!grantId || !grantId.trim()) throw new Error('grant_id is required.');
  await ensureScopedGrantSchema();
  const result = await getClient().execute({
    sql: 'UPDATE scoped_grants SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL',
    args: [nowMs, grantId.trim()],
  });
  return (result.rowsAffected ?? 0) === 1;
}

function recordFromRow(row: Record<string, unknown>): ScopedGrantRecord {
  return {
    grant_id: String(row.grant_id),
    owner_id: String(row.owner_id),
    allowed_tools: parseArray(row.allowed_tools) as ScopedGrantTool[],
    branch_prefixes: parseArray(row.branch_prefixes),
    path_prefixes: parseArray(row.path_prefixes),
    max_uses: Number(row.max_uses),
    uses: Number(row.uses),
    expires_at: Number(row.expires_at),
    revoked_at: row.revoked_at === null || row.revoked_at === undefined ? null : Number(row.revoked_at),
    created_at: Number(row.created_at),
  };
}

export async function findMatchingScopedGrant(action: ScopedGrantAction): Promise<ScopedGrantRecord | null> {
  try {
    await ensureScopedGrantSchema();
    const result = await getClient().execute({
      sql: 'SELECT * FROM scoped_grants WHERE owner_id = ? AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses',
      args: [action.ownerId, action.nowMs ?? Date.now()],
    });
    for (const raw of result.rows) {
      const grant = recordFromRow(raw as Record<string, unknown>);
      if (scopedGrantMatchesAction(grant, action)) return grant;
    }
    return null;
  } catch {
    return null;
  }
}

export async function consumeScopedGrant(action: ScopedGrantAction & { grantId: string; sessionId: string; actorId: string }): Promise<{ grantId: string; useNumber: number; receiptId: string } | null> {
  const now = action.nowMs ?? Date.now();
  const client = getClient() as ReturnType<typeof getClient> & {
    transaction?: (mode?: 'read' | 'write') => Promise<{
      execute: (stmt: { sql: string; args: unknown[] }) => Promise<{ rowsAffected?: number; rows?: Array<Record<string, unknown>> }>;
      commit: () => Promise<void>;
      rollback: () => Promise<void>;
    }>;
  };
  try {
    await ensureScopedGrantSchema();
    if (!client.transaction) return null;
    const tx = await client.transaction('write');
    try {
      const found = await tx.execute({
        sql: 'SELECT * FROM scoped_grants WHERE grant_id = ? AND owner_id = ? LIMIT 1',
        args: [action.grantId, action.ownerId],
      });
      if (!found.rows.length) { await tx.rollback(); return null; }
      const grant = recordFromRow(found.rows[0]);
      if (!scopedGrantMatchesAction(grant, action)) { await tx.rollback(); return null; }
      const updated = await tx.execute({
        sql: `UPDATE scoped_grants SET uses = uses + 1
          WHERE grant_id = ? AND owner_id = ? AND uses = ? AND uses < max_uses
            AND expires_at > ? AND revoked_at IS NULL RETURNING uses`,
        args: [grant.grant_id, action.ownerId, grant.uses, now],
      });
      if ((updated.rowsAffected ?? 0) !== 1 || !updated.rows?.length) { await tx.rollback(); return null; }
      const useNumber = Number(updated.rows[0].uses);
      const receiptId = `SGR-${crypto.randomUUID()}`;
      const branch = branchFor(action.toolName, action.args);
      const path = typeof action.args.path === 'string' ? action.args.path : null;
      const argsHash = crypto.createHash('sha256').update(stableJson(action.args)).digest('hex');
      await tx.execute({
        sql: `INSERT INTO tool_receipts
          (receipt_id, session_id, actor_id, tool_name, args_hash, decision, c_score, r_score, s_score, m_score,
           risk_level, reason, sigma_viol, created_at, grant_id, grant_branch, grant_path, grant_use_number)
          VALUES (?, ?, ?, ?, ?, 'SCOPED_GRANT_USED', 1, 1, 1, 1, 'LOW', ?, 0, ?, ?, ?, ?, ?)`,
        args: [receiptId, action.sessionId, action.actorId, action.toolName, argsHash,
          `Scoped grant use ${useNumber}`, new Date(now).toISOString(), grant.grant_id, branch, path, useNumber],
      });
      await tx.commit();
      return { grantId: grant.grant_id, useNumber, receiptId };
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  } catch {
    return null;
  }
}
