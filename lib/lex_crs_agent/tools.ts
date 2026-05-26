/**
 * Lex CRS Agent — Tool Implementations
 * 10 constitutional tools giving the agent live access to the Lexaureon system.
 * Every tool is read or write — clearly separated.
 */

import { env } from '../env';

const REPO  = 'omomehinemmanuel5-boop/LEX-Aureon';
const API   = 'https://api.github.com';

// ── GitHub helpers ──────────────────────────────────────────────────────────
async function ghFetch(path: string, opts: RequestInit = {}) {
  const token = env.GITHUB_TOKEN;
  return fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      ...opts.headers,
    },
  });
}

// ── Tool: read_file ─────────────────────────────────────────────────────────
export async function read_file({ path }: { path: string }): Promise<string> {
  const res = await ghFetch(`/repos/${REPO}/contents/${path}`);
  if (!res.ok) return `Error: ${res.status} — file not found at ${path}`;
  const data = await res.json() as { content?: string; encoding?: string };
  if (!data.content) return 'Error: no content';
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

// ── Tool: list_directory ────────────────────────────────────────────────────
export async function list_directory({ path = '' }: { path?: string }): Promise<string> {
  const res = await ghFetch(`/repos/${REPO}/contents/${path}`);
  if (!res.ok) return `Error: ${res.status}`;
  const data = await res.json() as Array<{ type: string; name: string; path: string }>;
  if (!Array.isArray(data)) return 'Error: not a directory';
  return data.map(f => `${f.type === 'dir' ? '📁' : '📄'} ${f.name}`).join('\n');
}

// ── Tool: search_code ───────────────────────────────────────────────────────
export async function search_code({ query }: { query: string }): Promise<string> {
  const res = await ghFetch(
    `/search/code?q=${encodeURIComponent(query + ` repo:${REPO}`)}&per_page=10`
  );
  if (!res.ok) return `Error: ${res.status}`;
  const data = await res.json() as { items?: Array<{ path: string; html_url: string }> };
  if (!data.items?.length) return 'No results found.';
  return data.items.map(i => `${i.path}`).join('\n');
}

// ── Tool: write_file ────────────────────────────────────────────────────────
export async function write_file({
  path, content, message,
}: { path: string; content: string; message: string }): Promise<string> {
  // Get current SHA if file exists
  let sha: string | undefined;
  const existing = await ghFetch(`/repos/${REPO}/contents/${path}`);
  if (existing.ok) {
    const d = await existing.json() as { sha?: string };
    sha = d.sha;
  }

  const body: Record<string, unknown> = {
    message: `[Lex CRS Agent] ${message}`,
    content: Buffer.from(content).toString('base64'),
  };
  if (sha) body.sha = sha;

  const res = await ghFetch(`/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json() as { message?: string };
    return `Error committing: ${err.message ?? res.status}`;
  }
  const d = await res.json() as { commit?: { sha?: string } };
  return `✓ Committed: ${d.commit?.sha?.slice(0, 10)} — ${path}`;
}

// ── Tool: get_build_status ──────────────────────────────────────────────────
export async function get_build_status(): Promise<string> {
  const res = await ghFetch(`/repos/${REPO}/actions/runs?per_page=3`);
  if (!res.ok) return `Error: ${res.status}`;
  const data = await res.json() as {
    workflow_runs?: Array<{ status: string; conclusion: string | null; head_commit: { message: string }; created_at: string }>
  };
  return (data.workflow_runs ?? []).map(r =>
    `${r.conclusion === 'success' ? '✓' : r.conclusion === 'failure' ? '✗' : '⏳'} ${r.status} ${r.conclusion ?? ''} | ${r.head_commit.message.slice(0, 60)}`
  ).join('\n');
}

// ── Tool: get_constitutional_state ──────────────────────────────────────────
export async function get_constitutional_state(): Promise<string> {
  try {
    const { createClient } = await import('@libsql/client');
    const db = createClient({
      url:       env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    });
    const res = await db.execute(`
      SELECT session_id, last_c, last_r, last_s, last_m, velocity, sigma_viol, n_stable, updated_at
      FROM z_traj ORDER BY updated_at DESC LIMIT 5
    `);
    if (!res.rows.length) return 'No sessions found.';
    return res.rows.map(r =>
      `Session ${String(r.session_id).slice(0, 8)} | C=${Number(r.last_c).toFixed(3)} R=${Number(r.last_r).toFixed(3)} S=${Number(r.last_s).toFixed(3)} M=${Number(r.last_m).toFixed(3)} | updated: ${r.updated_at}`
    ).join('\n');
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

// ── Tool: query_database ────────────────────────────────────────────────────
export async function query_database({ sql }: { sql: string }): Promise<string> {
  // Read-only guard
  const lower = sql.toLowerCase().trim();
  if (!lower.startsWith('select') && !lower.startsWith('with')) {
    return 'Error: only SELECT queries allowed for safety.';
  }
  try {
    const { createClient } = await import('@libsql/client');
    const db = createClient({
      url:       env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    });
    const res = await db.execute(sql);
    if (!res.rows.length) return 'No rows returned.';
    const cols = res.columns.join(' | ');
    const rows = res.rows.slice(0, 20).map(r =>
      res.columns.map(c => String(r[c] ?? '')).join(' | ')
    ).join('\n');
    return `${cols}\n${'-'.repeat(cols.length)}\n${rows}`;
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

// ── Tool: run_governance ─────────────────────────────────────────────────────
export async function run_governance({
  prompt, session_id = 'lex-agent',
}: { prompt: string; session_id?: string }): Promise<string> {
  try {
    // Use SovereignKernel by default
    const res = await fetch(`${env.NEXT_PUBLIC_SITE_URL}/api/lex/kernel`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, session_id, turn: 1 }),
    });
    if (!res.ok) return `Error: ${res.status}`;
    const d = await res.json() as {
      governed_output?: string;
      health_band?: string;
      M?: number;
      theta?: number;
      semantic_signal?: { attack_type: string; severity: number };
      metrics?: { c_measured?: number; r_measured?: number; s_measured?: number };
      receipt_id?: string;
      version?: string;
    };
    const sig = d.semantic_signal ?? { attack_type: 'none', severity: 0 };
    const met = d.metrics ?? {};
    return [
      `Output: ${d.governed_output ?? ''}`,
      `Health: ${d.health_band ?? '?'} | M=${d.M ?? '?'} | θ=${d.theta ?? '?'}`,
      `Attack: ${sig.attack_type}(${sig.severity}) | CCP=${met.c_measured ?? '?'} IEC=${met.r_measured ?? '?'} ADV=${met.s_measured ?? '?'}`,
      `Receipt: ${d.receipt_id ?? '?'} | ${d.version ?? ''}`,
    ].join('\n');
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

// ── Tool: get_recent_receipts ────────────────────────────────────────────────
export async function get_recent_receipts({ limit = 5 }: { limit?: number }): Promise<string> {
  try {
    const { createClient } = await import('@libsql/client');
    const db = createClient({
      url:       env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    });
    const res = await db.execute(
      `SELECT receipt_id, session_id, health_band, m_score, intervention, created_at
       FROM praxis_receipts ORDER BY created_at DESC LIMIT ${Math.min(limit, 20)}`
    );
    return res.rows.map(r =>
      `${r.receipt_id} | ${r.health_band} M=${Number(r.m_score).toFixed(3)} | intervened=${r.intervention} | ${r.created_at}`
    ).join('\n');
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

// ── Tool: get_vercel_logs ────────────────────────────────────────────────────
export async function get_vercel_logs({ limit = 20 }: { limit?: number }): Promise<string> {
  try {
    const res = await fetch(
      `https://api.vercel.com/v2/deployments?projectId=prj_ZAcInydgb249gv8xZf1EXrIWSIc5&teamId=team_R3du1XYxrloM0xx5tHKWyxMx&limit=1`,
      { headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` } }
    );
    if (!res.ok) return `Error: ${res.status}`;
    const d = await res.json() as { deployments?: Array<{ uid: string; state: string; url: string }> };
    const dep = d.deployments?.[0];
    if (!dep) return 'No deployments found.';
    return `Latest: ${dep.uid} | ${dep.state} | ${dep.url}`;
  } catch (e) {
    return `Error: ${String(e)}`;
  }
}

// ── Tool registry ─────────────────────────────────────────────────────────────
export const TOOL_REGISTRY: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  read_file:                (a) => read_file(a as { path: string }),
  list_directory:           (a) => list_directory(a as { path?: string }),
  search_code:              (a) => search_code(a as { query: string }),
  write_file:               (a) => write_file(a as { path: string; content: string; message: string }),
  get_build_status:         ()  => get_build_status(),
  get_constitutional_state: ()  => get_constitutional_state(),
  query_database:           (a) => query_database(a as { sql: string }),
  run_governance:           (a) => run_governance(a as { prompt: string; session_id?: string }),
  get_recent_receipts:      (a) => get_recent_receipts(a as { limit?: number }),
  get_vercel_logs:          (a) => get_vercel_logs(a as { limit?: number }),
};

// ── Tool definitions for LLMs ─────────────────────────────────────────────────
export const TOOL_DEFINITIONS = [
  { name: 'read_file',          description: 'Read any file from the Lexaureon GitHub repository.',       parameters: { type: 'object', properties: { path: { type: 'string', description: 'File path e.g. lib/agents/generator.ts' } }, required: ['path'] } },
  { name: 'list_directory',     description: 'List files in a repo directory.',                           parameters: { type: 'object', properties: { path: { type: 'string', description: 'Directory path, empty for root' } } } },
  { name: 'search_code',        description: 'Search for code patterns across the repository.',           parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } },
  { name: 'write_file',         description: 'Create or update a file and commit it to GitHub.',          parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, message: { type: 'string', description: 'Commit message' } }, required: ['path', 'content', 'message'] } },
  { name: 'get_build_status',   description: 'Get the latest GitHub Actions build status.',               parameters: { type: 'object', properties: {} } },
  { name: 'get_constitutional_state', description: 'Get live CRS constitutional health from Turso.', parameters: { type: 'object', properties: {} } },
  { name: 'query_database',     description: 'Run a read-only SELECT query on the Turso database.',       parameters: { type: 'object', properties: { sql: { type: 'string', description: 'SQL SELECT query' } }, required: ['sql'] } },
  { name: 'run_governance',     description: 'Send a prompt through the SovereignKernel governance cycle (includes memory, adaptive θ, CCP/IEC/ADV metrics).', parameters: { type: 'object', properties: { prompt: { type: 'string' }, session_id: { type: 'string' } }, required: ['prompt'] } },
  { name: 'get_recent_receipts', description: 'Get recent constitutional audit receipts.',               parameters: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'get_vercel_logs',    description: 'Get recent Vercel deployment status.',                      parameters: { type: 'object', properties: { limit: { type: 'number' } } } },
];
