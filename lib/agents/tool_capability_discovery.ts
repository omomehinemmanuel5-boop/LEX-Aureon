/**
 * Lex Capability Discovery & Resolution.
 *
 * External environments advertise tools (MCP tools/list, SDK manifests, or
 * adapter-native metadata). Lex normalizes those declarations into its stable
 * capability ontology. Discovery is namespaced by environment and persisted
 * so a new serverless instance does not forget what was learned.
 *
 * Security rule: discovery never grants execution authority by itself.
 * It only records the most conservative capability Lex can justify. The
 * normal CRS/approval/reference-monitor gates remain authoritative.
 */

import crypto from 'crypto';
import { getClient } from '../db';
import {
  type ToolCapability,
  type ToolCapabilityRecord,
} from './tool_capability_registry';

export type CapabilityConfidence = 'high' | 'medium' | 'low' | 'unresolved';

export interface ToolManifest {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
    idempotentHint?: boolean;
  };
}

export interface ResolvedToolCapability extends ToolCapabilityRecord {
  confidence: CapabilityConfidence;
  environmentId: string;
  evidence: string[];
  manifestHash: string;
  discoveredAt: number;
  snapshotHash: string;
  revision: number;
  expiresAt: number;
  active: boolean;
}

const EXECUTE_WORDS = /^(?:exec|execute|shell|bash|sh|zsh|powershell|cmd|run_command|run_shell|terminal|eval)$/i;
const DESTRUCTIVE_WORDS = /(?:delete|destroy|drop|purge|wipe|remove|revoke|reset|terminate|format)/i;
const FINANCIAL_WORDS = /(?:payment|pay|transfer|charge|billing|purchase|refund|withdraw|deposit)/i;
const IDENTITY_WORDS = /(?:impersonat|rotate[_ -]?identity|credential|permission|privilege|access[_ -]?control|auth(?:enticate|orization)?)/i;
const DELEGATE_WORDS = /(?:delegate|spawn[_ -]?agent|create[_ -]?agent|handoff|subagent)/i;
const EXTERNAL_WORDS = /(?:send|publish|post|email|deploy|webhook|http|browser|network|api[_ -]?call|external)/i;
const WRITE_WORDS = /(?:write|edit|modify|patch|update|create|insert|commit|push|save|set|change|alter|upload)/i;
const READ_WORDS = /(?:read|get|list|search|find|inspect|review|audit|query|lookup|fetch|check|verify|status|describe)/i;
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function manifestHash(manifest: ToolManifest): string {
  return crypto.createHash('sha256').update(JSON.stringify({
    name: manifest.name,
    description: manifest.description ?? '',
    inputSchema: manifest.inputSchema ?? {},
    annotations: manifest.annotations ?? {},
  })).digest('hex');
}

function hasSchemaProperty(manifest: ToolManifest, names: RegExp): boolean {
  const properties = manifest.inputSchema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return false;
  return Object.keys(properties).some(key => names.test(key));
}
/**
 * Deterministic, conservative resolver. MCP annotations are treated as hints,
 * not proof; ambiguous declarations are never silently downgraded to read.
 */
export function resolveToolManifest(environmentId: string, manifest: ToolManifest): ResolvedToolCapability {
  const name = normalize(manifest.name);
  const description = normalize(manifest.description ?? '');
  const combined = `${name} ${description}`;
  const annotations = manifest.annotations ?? {};
  const evidence: string[] = [];

  let capability: ToolCapability | null = null;
  let confidence: CapabilityConfidence = 'unresolved';

  if (EXECUTE_WORDS.test(name) || /\b(?:shell|command|execute|eval)\b/.test(description)) {
    capability = 'execute';
    confidence = 'high';
    evidence.push('tool identity/description indicates arbitrary execution');
  } else if (DESTRUCTIVE_WORDS.test(combined)) {
    capability = 'destructive';
    confidence = 'high';
    evidence.push('tool identity/description contains destructive operation');
  } else if (FINANCIAL_WORDS.test(combined)) {
    capability = 'financial';
    confidence = 'high';
    evidence.push('tool identity/description contains financial operation');
  } else if (IDENTITY_WORDS.test(combined)) {
    capability = 'identity';
    confidence = 'high';
    evidence.push('tool identity/description contains identity or privilege operation');
  } else if (DELEGATE_WORDS.test(combined)) {
    capability = 'delegate';
    confidence = 'high';
    evidence.push('tool identity/description indicates delegation');
  } else if (annotations.destructiveHint === true) {
    capability = 'destructive';
    confidence = 'high';
    evidence.push('MCP destructiveHint=true');
  } else if (annotations.readOnlyHint === true) {
    capability = 'read';
    confidence = 'high';
    evidence.push('MCP readOnlyHint=true');
  } else if (EXTERNAL_WORDS.test(combined) || annotations.openWorldHint === true) {
    capability = 'external';
    confidence = annotations.openWorldHint === true ? 'medium' : 'high';
    evidence.push(annotations.openWorldHint === true ? 'MCP openWorldHint=true' : 'tool identity/description indicates external interaction');
  } else if (WRITE_WORDS.test(combined) || hasSchemaProperty(manifest, /^(?:content|body|patch|mutation|operation|command)$/i)) {
    capability = 'write';
    confidence = 'medium';
    evidence.push('tool identity/description/schema indicates state mutation');
  } else if (READ_WORDS.test(combined)) {
    capability = 'read';
    confidence = 'medium';
    evidence.push('tool identity/description indicates observation');
  }

  if (!capability) {
    return {
      name: manifest.name,
      capability: 'destructive',
      approvalRequired: true,
      reversible: false,
      source: 'extension',
      confidence: 'unresolved',
      environmentId,
      evidence: ['No safe capability mapping could be established; execution remains blocked.'],
      manifestHash: manifestHash(manifest),
      discoveredAt: Date.now(),
    };
  }

  return {
    name: manifest.name,
    capability,
    approvalRequired: capability !== 'read',
    reversible: capability === 'read' || capability === 'write',
    source: 'extension',
    confidence,
    environmentId,
    evidence,
    manifestHash: manifestHash(manifest),
    discoveredAt: Date.now(),
  };
}

const DISCOVERY_TTL_MS = 10 * 60 * 1000;

async function addColumnIfMissing(sql: string): Promise<void> {
  try { await getClient().execute({ sql, args: [] }); } catch { /* existing deployment */ }
}

export async function ensureCapabilityDiscoverySchema(): Promise<void> {
  await getClient().execute({
    sql: `CREATE TABLE IF NOT EXISTS discovered_tool_capabilities (
      environment_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      capability TEXT NOT NULL,
      confidence TEXT NOT NULL,
      approval_required INTEGER NOT NULL,
      reversible INTEGER NOT NULL,
      source TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      discovered_at INTEGER NOT NULL,
      snapshot_hash TEXT NOT NULL DEFAULT '',
      revision INTEGER NOT NULL DEFAULT 1,
      expires_at INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (environment_id, tool_name)
    )`,
    args: [],
  });
  await addColumnIfMissing("ALTER TABLE discovered_tool_capabilities ADD COLUMN snapshot_hash TEXT NOT NULL DEFAULT ''");
  await addColumnIfMissing("ALTER TABLE discovered_tool_capabilities ADD COLUMN revision INTEGER NOT NULL DEFAULT 1");
  await addColumnIfMissing("ALTER TABLE discovered_tool_capabilities ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0");
  await addColumnIfMissing("ALTER TABLE discovered_tool_capabilities ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
}

export async function registerDiscoveredTool(
  environmentId: string,
  manifest: ToolManifest,
  snapshotHash?: string,
  revision = 1,
  expiresAt = Date.now() + DISCOVERY_TTL_MS,
): Promise<ResolvedToolCapability> {
  if (!environmentId.trim()) throw new Error('environmentId is required.');
  if (!manifest.name.trim()) throw new Error('tool name is required.');

  const resolved = resolveToolManifest(environmentId, manifest);
  await ensureCapabilityDiscoverySchema();
  await getClient().execute({
    sql: `INSERT INTO discovered_tool_capabilities
      (environment_id, tool_name, capability, confidence, approval_required,
       reversible, source, evidence_json, manifest_hash, discovered_at, snapshot_hash, revision, expires_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(environment_id, tool_name) DO UPDATE SET
        capability=excluded.capability,
        confidence=excluded.confidence,
        approval_required=excluded.approval_required,
        reversible=excluded.reversible,
        source=excluded.source,
        evidence_json=excluded.evidence_json,
        manifest_hash=excluded.manifest_hash,
        discovered_at=excluded.discovered_at,
        snapshot_hash=excluded.snapshot_hash,
        revision=excluded.revision,
        expires_at=excluded.expires_at,
        active=1`,
    args: [
      environmentId,
      resolved.name,
      resolved.capability,
      resolved.confidence,
      resolved.approvalRequired ? 1 : 0,
      resolved.reversible ? 1 : 0,
      resolved.source,
      JSON.stringify(resolved.evidence),
      resolved.manifestHash,
      resolved.discoveredAt,
      snapshotHash ?? resolved.manifestHash,
      revision,
      expiresAt,
      1,
    ],
  });
  return resolved;
}

export async function discoverToolManifests(
  environmentId: string,
  manifests: ToolManifest[],
): Promise<ResolvedToolCapability[]> {
  if (!Array.isArray(manifests) || manifests.length === 0) {
    throw new Error('At least one tool manifest is required.');
  }
  if (manifests.length > 500) throw new Error('Tool manifest batch exceeds the 500-tool limit.');
  const normalized = manifests.map(m => ({ ...m, name: m.name.trim() }));
  const snapshotHash = crypto.createHash('sha256')
    .update(normalized.map(m => manifestHash(m)).sort().join('|')).digest('hex');
  await ensureCapabilityDiscoverySchema();
  const revisionResult = await getClient().execute({
    sql: "SELECT COALESCE(MAX(revision), 0) AS revision FROM discovered_tool_capabilities WHERE environment_id = ?",
    args: [environmentId],
  });
  const previousRevision = Number(revisionResult.rows[0]?.revision ?? 0);
  const previousSnapshotResult = await getClient().execute({
    sql: "SELECT snapshot_hash FROM discovered_tool_capabilities WHERE environment_id = ? AND active = 1 LIMIT 1",
    args: [environmentId],
  });
  const previousSnapshot = previousSnapshotResult.rows[0]?.snapshot_hash ? String(previousSnapshotResult.rows[0].snapshot_hash) : '';
  const revision = previousSnapshot === snapshotHash && previousRevision > 0 ? previousRevision : previousRevision + 1;
  const expiresAt = Date.now() + DISCOVERY_TTL_MS;
  const results: ResolvedToolCapability[] = [];
  for (const manifest of normalized) {
    results.push(await registerDiscoveredTool(environmentId, manifest, snapshotHash, revision, expiresAt));
  }
  const names = normalized.map(m => normalize(m.name));
  const placeholders = names.map(() => '?').join(',');
  await getClient().execute({
    sql: `UPDATE discovered_tool_capabilities
          SET active = 0, expires_at = ?, revision = ?
          WHERE environment_id = ? AND active = 1 AND tool_name NOT IN (${placeholders})`,
    args: [Date.now(), revision, environmentId, ...names],
  });
  return results;
}

export async function getDiscoveredToolCapability(
  environmentId: string,
  toolName: string,
): Promise<ResolvedToolCapability | undefined> {
  await ensureCapabilityDiscoverySchema();
  const result = await getClient().execute({
    sql: `SELECT tool_name, capability, confidence, approval_required, reversible, source,
                 evidence_json, manifest_hash, discovered_at
          FROM discovered_tool_capabilities
          WHERE environment_id = ? AND tool_name = ? LIMIT 1`,
    args: [environmentId, toolName, Date.now()],
  });
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    name: String(row.tool_name),
    capability: String(row.capability) as ToolCapability,
    approvalRequired: Boolean(Number(row.approval_required)),
    reversible: Boolean(Number(row.reversible)),
    source: String(row.source) as ToolCapabilityRecord['source'],
    confidence: String(row.confidence) as CapabilityConfidence,
    environmentId,
    evidence: (() => { try { return JSON.parse(String(row.evidence_json)) as string[]; } catch { return []; } })(),
    manifestHash: String(row.manifest_hash),
    discoveredAt: Number(row.discovered_at),
    snapshotHash: String(row.snapshot_hash),
    revision: Number(row.revision),
    expiresAt: Number(row.expires_at),
    active: Boolean(Number(row.active)),
  };
}

export async function listDiscoveredToolCapabilities(environmentId: string): Promise<ResolvedToolCapability[]> {
  await ensureCapabilityDiscoverySchema();
  const result = await getClient().execute({
    sql: `SELECT tool_name, capability, confidence, approval_required, reversible,
                   source, evidence_json, manifest_hash, discovered_at, snapshot_hash, revision, expires_at, active
            FROM discovered_tool_capabilities
            WHERE environment_id = ? AND active = 1 AND expires_at > ?
            ORDER BY tool_name ASC`,
    args: [environmentId, Date.now()],
  });
  return result.rows.map(row => ({
    name: String(row.tool_name),
    capability: String(row.capability) as ToolCapability,
    approvalRequired: Boolean(Number(row.approval_required)),
    reversible: Boolean(Number(row.reversible)),
    source: String(row.source) as ToolCapabilityRecord['source'],
    confidence: String(row.confidence) as CapabilityConfidence,
    environmentId,
    evidence: (() => {
      try { return JSON.parse(String(row.evidence_json)) as string[]; } catch { return []; }
    })(),
    manifestHash: String(row.manifest_hash),
    discoveredAt: Number(row.discovered_at),
    snapshotHash: String(row.snapshot_hash),
    revision: Number(row.revision),
    expiresAt: Number(row.expires_at),
    active: Boolean(Number(row.active)),
  }));
}
