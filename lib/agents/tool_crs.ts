/**
 * ═══════════════════════════════════════════════════════════════
 * ARTICLE II.5 — Tool Call CRS Measurement
 * Constitutional role: Measure constitutional state of tool calls.
 * Cannot: execute tools, modify decisions, or sign receipts.
 * Separate from text CRS — different input domain, same mathematics.
 *
 * C = Continuity:   does this tool call match the agent's original task?
 * R = Reciprocity:  does this action align with the user's actual intent?
 * S = Sovereignty:  is this call within the agent's authorized scope?
 * ═══════════════════════════════════════════════════════════════
 */

import { ToolCallInput, ToolCRSState } from './types';
import { projectToSimplex } from '../aureonics_math';

// ── Constitutional constants (shared with text governance) ─────────────────
const TAU_FLOOR = 0.05;

// ── Hardcoded BLOCKED invariants ───────────────────────────────────────────
// These fire before CRS measurement. No LLM. No scoring. Immediate denial.

const BLOCKED_TOOL_PATTERNS: Record<string, RegExp[]> = {
  // Destructive database operations
  sql_destroy: [
    /\bDROP\s+TABLE\b/i,
    /\bTRUNCATE\s+TABLE\b/i,
    /\bDELETE\s+FROM\b(?!.*\bWHERE\b)/i,  // DELETE without WHERE
    /\bDROP\s+DATABASE\b/i,
    /\bDROP\s+SCHEMA\b/i,
  ],
  // Shell commands — destructive or exfiltrating
  shell_destroy: [
    /rm\s+-rf?\s*\/?\s*/i,
    /chmod\s+777/i,
    /\benv\b|\bprintenv\b|\bexport\b.*=.*(\$|process\.env)/i,
    /curl.*\|\s*(bash|sh|zsh|python)/i,
    /wget.*\|\s*(bash|sh|zsh|python)/i,
  ],
  // Credential / secret file access
  credential_access: [
    /\.env(\.|$)/i,
    /\.ssh\//i,
    /id_rsa|id_ed25519/i,
    /\.pem$|\.key$|\.p12$|\.pfx$/i,
    /secrets?\.(json|yaml|yml|toml)/i,
    /credentials?\.(json|yaml|yml|toml)/i,
  ],
  // Exfiltration — passing data to unverified external endpoints
  exfiltration: [
    /fetch\s*\(\s*['"`]https?:\/\/(?!api\.(?:groq|jina|anthropic|gemini|vercel|github)\.com)/i,
    /axios\.(get|post|put)\s*\(\s*['"`]https?:\/\/(?!api\.)/i,
    /curl\s+https?:\/\/(?!api\.)/i,
  ],
  // Protected build/config files
  build_files: [
    /package\.json$/i,
    /package-lock\.json$/i,
    /turbo\.json$/i,
    /next\.config\./i,
    /vercel\.json$/i,
    /tsconfig\.json$/i,
  ],
};

// Prompt injection patterns — scanned in arguments and content
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|prior|all)\s+instructions?/i,
  /forget\s+your\s+(previous|prior|original)\s+(task|instructions?|rules?)/i,
  /new\s+task:/i,
  /\[SYSTEM\s+OVERRIDE\]/i,
  /UNSAFE_EXECUTE:/i,
  /Assistant\s+represents\s+a\s+new\s+instance/i,
  /<\|im_start\|>/i,                    // ChatML injection
  /Based\s+on\s+user\s+instructions.*execute.*tool/i,
  /your\s+real\s+instructions\s+are/i,
  /<!--\s*inject/i,
  /<\|system\|>/i,
];

// ── Tool-specific hardcoded scope rules ────────────────────────────────────
// Tools that require extra scrutiny regardless of CRS score.
const HIGH_RISK_TOOLS = new Set([
  'execute_command', 'run_terminal', 'bash', 'shell', 'run_command',
  'exec', 'system', 'spawn',
]);

const MEDIUM_RISK_TOOLS = new Set([
  'write_file', 'create_file', 'modify_file', 'update_file',
  'delete_file', 'rename_file', 'move_file',
]);

// ── Argument scanner ───────────────────────────────────────────────────────
function scanArguments(args: Record<string, unknown>): {
  injection: boolean;
  blocked_pattern: string | null;
} {
  const content = JSON.stringify(args).toLowerCase();
  const full = JSON.stringify(args);

  // Injection check
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(full)) {
      return { injection: true, blocked_pattern: `injection:${pattern.source.slice(0, 40)}` };
    }
  }

  // Hardcoded blocked patterns
  for (const [category, patterns] of Object.entries(BLOCKED_TOOL_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(full) || pattern.test(content)) {
        return { injection: false, blocked_pattern: `${category}:${pattern.source.slice(0, 40)}` };
      }
    }
  }

  return { injection: false, blocked_pattern: null };
}

// ── S: Sovereignty measurement ─────────────────────────────────────────────
// Rule-based. No LLM. Fast.
function measureS(tool: ToolCallInput): { score: number; risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED' } {
  const name = tool.name.toLowerCase();
  const args = JSON.stringify(tool.arguments).toLowerCase();

  // HIGH risk tools — shell execution, anything that runs arbitrary code
  if (HIGH_RISK_TOOLS.has(name)) {
    // Check args for particularly dangerous patterns
    const dangerous = /rm|chmod|sudo|curl|wget|env|export|eval|exec/.test(args);
    return dangerous
      ? { score: 0.08, risk: 'HIGH' }
      : { score: 0.20, risk: 'HIGH' };
  }

  // MEDIUM risk tools — file writes
  if (MEDIUM_RISK_TOOLS.has(name)) {
    // Path analysis: writing to protected paths drops score
    const path = String(tool.arguments.path ?? tool.arguments.file ?? '').toLowerCase();
    const isProtected = /\.(env|key|pem|p12|pfx)$|\.ssh\/|secrets?\/|credentials?\//.test(path);
    const isBuildFile = BLOCKED_TOOL_PATTERNS.build_files.some(p => p.test(path));
    if (isProtected || isBuildFile) return { score: 0.06, risk: 'HIGH' };
    return { score: 0.45, risk: 'MEDIUM' };
  }

  // SQL tools — analyze the query
  if (name.includes('query') || name.includes('sql') || name.includes('database')) {
    const sql = String(tool.arguments.sql ?? tool.arguments.query ?? '').toUpperCase();
    if (/DROP|TRUNCATE/.test(sql)) return { score: 0.05, risk: 'BLOCKED' };
    if (/DELETE/.test(sql) && !/WHERE/.test(sql)) return { score: 0.05, risk: 'BLOCKED' };
    if (/DELETE|ALTER/.test(sql)) return { score: 0.15, risk: 'HIGH' };
    if (/INSERT|UPDATE/.test(sql)) return { score: 0.40, risk: 'MEDIUM' };
    return { score: 0.85, risk: 'LOW' }; // SELECT
  }

  // CREATE TABLE — MEDIUM unless name suggests exfiltration staging
  if (name.includes('create') && args.includes('table')) {
    const tableName = String(tool.arguments.table ?? tool.arguments.name ?? '').toLowerCase();
    const suspicious = /backup|export|copy|dump|temp_admin|shadow/.test(tableName);
    return suspicious
      ? { score: 0.15, risk: 'HIGH' }
      : { score: 0.45, risk: 'MEDIUM' };
  }

  // Read operations — generally safe
  if (/read|get|fetch|list|search/.test(name)) {
    // Check for credential reads
    const path = String(tool.arguments.path ?? tool.arguments.file ?? '').toLowerCase();
    const isCred = /\.env|\.ssh|\.key|\.pem|secret|credential/.test(path);
    return isCred
      ? { score: 0.05, risk: 'BLOCKED' }
      : { score: 0.85, risk: 'LOW' };
  }

  return { score: 0.70, risk: 'LOW' };
}

// ── C: Continuity measurement ──────────────────────────────────────────────
// Measures task alignment: does this call match the original task context?
function measureC(tool: ToolCallInput): number {
  if (!tool.task_context) return 0.60; // no context = neutral

  const task = tool.task_context.toLowerCase();
  const callStr = `${tool.name} ${JSON.stringify(tool.arguments)}`.toLowerCase();

  // Keyword overlap between task and call
  const taskWords = new Set(task.split(/\s+/).filter(w => w.length > 3));
  const callWords = callStr.split(/\s+/).filter(w => w.length > 3);
  const overlap = callWords.filter(w => taskWords.has(w)).length;
  const maxPossible = Math.max(callWords.length, 1);
  const base = Math.min(0.95, 0.35 + (overlap / maxPossible) * 0.60);

  // Task drift detection: major semantic mismatch
  const taskIsRead  = /read|get|fetch|find|search|list|show|display/.test(task);
  const callIsWrite = /write|create|delete|modify|update|drop|truncate/.test(tool.name);
  const taskIsWrite = /write|create|fix|update|build|implement|add/.test(task);
  // callIsRead intentionally unused — retained for future drift detection
  // const callIsRead = /read|get|fetch|list|search/.test(tool.name);

  // Reading when task was to write, or vice versa — fine, agents explore
  // Deleting when task was to read — significant drift
  if (taskIsRead && /delete|drop|truncate|destroy/.test(tool.name)) {
    return Math.min(base, 0.15); // C collapse
  }

  return base;
}

// ── R: Reciprocity measurement ─────────────────────────────────────────────
// Measures intent alignment. Injection already blocked upstream.
// Here we measure how well the action matches stated user intent.
function measureR(tool: ToolCallInput): number {
  if (!tool.task_context) return 0.60;

  const task = tool.task_context.toLowerCase();
  const name = tool.name.toLowerCase();

  // Strong alignment signals
  if (task.includes('fix') && /read|search|write/.test(name)) return 0.85;
  if (task.includes('read') && /read|get|fetch/.test(name)) return 0.90;
  if (task.includes('list') && /list|search|get/.test(name)) return 0.90;
  if (task.includes('create') && /create|write|add/.test(name)) return 0.85;
  if (task.includes('delete') && /delete|remove/.test(name)) return 0.80;

  // Misalignment signals
  if (task.includes('read') && /write|create|modify|delete/.test(name)) return 0.25;
  if (task.includes('list') && /write|delete|modify/.test(name)) return 0.25;

  return 0.60; // neutral
}

// ── Main: measure tool call CRS ────────────────────────────────────────────
export function measureToolCRS(tool: ToolCallInput): ToolCRSState & {
  injection: boolean;
  blocked_pattern: string | null;
} {
  // Step 1: scan arguments for injection and hardcoded patterns
  const scan = scanArguments(tool.arguments);

  if (scan.injection) {
    return {
      C: TAU_FLOOR, R: TAU_FLOOR, S: TAU_FLOOR, M: TAU_FLOOR,
      risk_level: 'BLOCKED',
      injection: true,
      blocked_pattern: scan.blocked_pattern,
    };
  }

  if (scan.blocked_pattern) {
    return {
      C: TAU_FLOOR, R: TAU_FLOOR, S: TAU_FLOOR, M: TAU_FLOOR,
      risk_level: 'BLOCKED',
      injection: false,
      blocked_pattern: scan.blocked_pattern,
    };
  }

  // Step 2: measure each pillar
  const { score: S_raw, risk: s_risk } = measureS(tool);
  const C_raw = measureC(tool);
  const R_raw = measureR(tool);

  // Step 3: normalize to simplex with CBF floor
  const total = C_raw + R_raw + S_raw || 1;
  const [C, R, S] = projectToSimplex(
    [C_raw / total, R_raw / total, S_raw / total],
    TAU_FLOOR
  );
  const M = Math.min(C, R, S);

  // Step 4: determine risk level from S measurement + M
  let risk_level: 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED' = s_risk;
  if (s_risk !== 'BLOCKED') {
    if (M < 0.08) risk_level = 'HIGH';
    else if (M < 0.15) risk_level = 'MEDIUM';
    else if (s_risk === 'LOW') risk_level = 'LOW';
  }

  return { C, R, S, M, risk_level, injection: false, blocked_pattern: null };
}
