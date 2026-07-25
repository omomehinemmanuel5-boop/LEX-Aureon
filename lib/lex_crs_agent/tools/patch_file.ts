/**
 * lib/lex_crs_agent/tools/patch_file.ts
 *
 * Surgical, exact-match file patching for the Lex CRS Agent.
 *
 * WHY THIS EXISTS (2026-07-25). write_file / write_file_governed are whole-file
 * GitHub Contents API PUTs. That is fine for creating a file and fine for small
 * ones, but it makes editing a large existing file a RECONSTRUCTION job: to
 * change two characters in app/chat/page.tsx (1,527 lines / 81,378 chars) the
 * agent must load the entire file into context and re-emit it verbatim. In
 * practice that does not fit — reading the file consumes the budget needed to
 * write it — so the agent simply cannot maintain its own largest files.
 *
 * That was not hypothetical. Commit 52ddcb2 broke the build with a two-character
 * defect (markdown backticks inside a CSS template literal, which terminated the
 * literal at app/chat/page.tsx:1283). CI caught it, Vercel deployment
 * dpl_46AeKso9CZE9AD9aRngTEH6hfMAP went to state=ERROR, and the agent could not
 * fix a defect it had precisely diagnosed, because the only available write
 * primitive demanded 81 KB to change 2 bytes.
 *
 * DESIGN — three properties, in order of importance:
 *
 * 1. EXACT MATCH, UNIQUENESS ENFORCED. old_str must appear exactly once unless
 *    replace_all is set. Zero matches and multiple matches are both errors, not
 *    best-effort guesses. Fuzzy matching on source code is how an agent
 *    silently edits the wrong call site.
 *
 * 2. DIFFERENTIAL PARSE GATE, not absolute. For .ts/.tsx/.mts the patched
 *    content is parsed and compared against the ORIGINAL's diagnostic count.
 *    A patch is refused only if it INCREASES diagnostics. Absolute gating would
 *    be worse than useless here: it would have refused the very fix that
 *    motivated this tool, because page.tsx was already broken (21 diagnostics)
 *    and the correct patch takes it to 0. "Do not make it worse" is the
 *    invariant that actually holds during repair work.
 *
 *    Note on why a cheaper check was rejected: a delimiter-balance heuristic
 *    (brace/paren/backtick counting) does NOT catch the page.tsx defect. The
 *    stray backtick closes one template literal and opens another, so backtick
 *    parity and brace balance both remain balanced while the file is
 *    syntactically dead. Only a real parse distinguishes them. Verified: the
 *    gate permits the 21->0 repair and refuses the 0->21 regression, i.e. it
 *    would have blocked commit 52ddcb2.
 *
 * 3. HONEST DEGRADATION. `typescript` is a devDependency, so it may be absent
 *    at serverless runtime. When the parser cannot be loaded the gate reports
 *    status 'unavailable' and the patch proceeds — but the report says so
 *    explicitly. A gate that silently passes when it cannot run is worse than
 *    no gate, because it manufactures false confidence. To make the gate always
 *    active, move typescript into dependencies.
 *
 * dry_run returns the full report — match count, diff preview, parse gate
 * verdict — without committing. Prefer it for any non-trivial patch.
 *
 * KNOWN DUPLICATION: commitToGitHub and ghFetch are module-private in
 * ../tools.ts and are reimplemented here rather than exported, to keep this a
 * purely additive new file. Once this tool is live it can patch ../tools.ts to
 * export them and delete the duplicates — the bootstrap step this tool exists
 * to enable.
 */

import { env } from '../../env';

/* Type-only import: erased at compile time, so it adds no runtime dependency on
   typescript. The VALUE is loaded dynamically in parseGate() and may be absent
   at serverless runtime, which the gate handles explicitly. */
import type * as TS from 'typescript';

const FRONTEND_REPO = 'omomehinemmanuel5-boop/LEX-Aureon';
const API = 'https://api.github.com';

function ghFetch(path: string, opts: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
      ...opts.headers,
    },
  });
}

/* ── pure core: exported separately so it is unit-testable without network ── */

export interface PatchOutcome {
  ok: boolean;
  content?: string;
  count: number;
  error?: string;
}

/**
 * Apply an exact-match replacement. Pure. Never throws.
 * Counts with indexOf rather than a RegExp so old_str needs no escaping —
 * source code is full of regex metacharacters and escaping it is a footgun.
 */
export function applyPatch(
  src: string,
  oldStr: string,
  newStr: string,
  replaceAll = false,
): PatchOutcome {
  if (oldStr === '') return { ok: false, count: 0, error: 'old_str must not be empty' };
  if (oldStr === newStr) return { ok: false, count: 0, error: 'old_str and new_str are identical — nothing to do' };

  let count = 0;
  let idx = src.indexOf(oldStr);
  while (idx !== -1) {
    count++;
    idx = src.indexOf(oldStr, idx + oldStr.length);
  }

  if (count === 0) {
    return {
      ok: false,
      count: 0,
      error: 'old_str not found. Exact match required — check leading whitespace, indentation width, and CRLF vs LF.',
    };
  }
  if (count > 1 && !replaceAll) {
    return {
      ok: false,
      count,
      error: `old_str is not unique (${count} matches). Extend old_str with surrounding context, or set replace_all.`,
    };
  }

  const content = replaceAll ? src.split(oldStr).join(newStr) : src.replace(oldStr, newStr);
  return { ok: true, content, count };
}

export interface GateResult {
  status: 'pass' | 'refused' | 'unavailable' | 'skipped';
  before: number | null;
  after: number | null;
  detail: string;
}

/** File extensions the parse gate applies to. */
function isParseable(path: string): boolean {
  return /\.(ts|tsx|mts|cts)$/.test(path);
}

/**
 * Differential parse gate. Refuses only if the patch increases the diagnostic
 * count. Loads typescript dynamically so its absence degrades to 'unavailable'
 * rather than throwing.
 */
export async function parseGate(path: string, before: string, after: string): Promise<GateResult> {
  if (!isParseable(path)) {
    return { status: 'skipped', before: null, after: null, detail: 'not a TypeScript source file' };
  }

  let ts: typeof TS;
  try {
    ts = await import('typescript');
  } catch {
    return {
      status: 'unavailable',
      before: null,
      after: null,
      detail: 'typescript could not be loaded at runtime (it is a devDependency) — patch NOT syntax-checked. Move typescript into dependencies to activate this gate.',
    };
  }

  const kind = /\.tsx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;

  /**
   * parseDiagnostics is an INTERNAL TypeScript API — present at runtime but
   * absent from the public SourceFile type, hence the cast. It returns null
   * (not 0) when the property is missing, so that a future TypeScript release
   * dropping it degrades to 'unavailable' rather than reporting zero
   * diagnostics on both sides — which would be a permanent silent false pass,
   * the exact failure mode this gate exists to avoid.
   */
  const count = (src: string): number | null => {
    const sf = ts.createSourceFile(path, src, ts.ScriptTarget.ESNext, true, kind) as TS.SourceFile & {
      parseDiagnostics?: readonly unknown[];
    };
    return Array.isArray(sf.parseDiagnostics) ? sf.parseDiagnostics.length : null;
  };

  const b = count(before);
  const a = count(after);

  if (b === null || a === null) {
    return {
      status: 'unavailable',
      before: b,
      after: a,
      detail: 'typescript no longer exposes parseDiagnostics on SourceFile — gate could not run and did NOT verify this patch. Update parseGate to the current API.',
    };
  }

  if (a > b) {
    return {
      status: 'refused',
      before: b,
      after: a,
      detail: `patch increases parse diagnostics ${b} -> ${a}; no commit made`,
    };
  }
  return {
    status: 'pass',
    before: b,
    after: a,
    detail: a < b ? `patch reduces parse diagnostics ${b} -> ${a}` : `parse diagnostics unchanged at ${a}`,
  };
}

/** Compact context preview of the first changed region, for the report. */
export function previewChange(oldStr: string, newStr: string, width = 220): string {
  const trim = (s: string) => (s.length > width ? `${s.slice(0, width)}…` : s);
  return [`- ${trim(oldStr).replace(/\n/g, '\n- ')}`, `+ ${trim(newStr).replace(/\n/g, '\n+ ')}`].join('\n');
}

/* ── the tool ── */

export async function patch_file({
  path,
  old_str,
  new_str,
  message,
  repo = FRONTEND_REPO,
  replace_all = false,
  dry_run = false,
}: {
  path: string;
  old_str: string;
  new_str: string;
  message: string;
  repo?: string;
  replace_all?: boolean;
  dry_run?: boolean;
}): Promise<string> {
  const head = await ghFetch(`/repos/${repo}/contents/${path}`);
  if (!head.ok) return `Error: ${head.status} — file not found at ${path} in ${repo}`;
  const meta = (await head.json()) as { content?: string; sha?: string };
  if (!meta.content || !meta.sha) return 'Error: no content or sha returned by GitHub';

  const before = Buffer.from(meta.content, 'base64').toString('utf-8');
  const outcome = applyPatch(before, old_str, new_str, replace_all);

  const report: string[] = [`── patch_file ──`, `path:    ${path} [${repo}]`];

  if (!outcome.ok || outcome.content === undefined) {
    report.push(`matches: ${outcome.count}`, `✗ ${outcome.error}`, `no commit made`);
    return report.join('\n');
  }

  const gate = await parseGate(path, before, outcome.content);
  report.push(
    `matches: ${outcome.count}${replace_all ? ' (replace_all)' : ''}`,
    `gate:    ${gate.status} — ${gate.detail}`,
    ``,
    previewChange(old_str, new_str),
    ``,
  );

  if (gate.status === 'refused') {
    report.push(`✗ PATCH REFUSED by parse gate — no commit made.`);
    return report.join('\n');
  }
  if (dry_run) {
    report.push(`◌ dry_run — no commit made. Re-run with dry_run:false to apply.`);
    return report.join('\n');
  }

  const res = await ghFetch(`/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `[Lex CRS Agent] ${message}`,
      content: Buffer.from(outcome.content).toString('base64'),
      sha: meta.sha,
    }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { message?: string };
    report.push(`Error committing: ${err.message ?? res.status}`);
    return report.join('\n');
  }
  const d = (await res.json()) as { commit?: { sha?: string } };
  report.push(`✓ Committed: ${d.commit?.sha?.slice(0, 10)} — ${path} [${repo}]`);
  return report.join('\n');
}

/** MCP tool definition, merged into the served tool list by app/api/mcp/route.ts. */
export const PATCH_FILE_DEFINITION = {
  name: 'patch_file',
  description:
    'Surgically edit an existing file by exact string replacement, committing only the changed region instead of re-uploading the whole file. Use this INSTEAD of write_file for any edit to an existing file, and especially for large ones where a whole-file PUT is impractical. old_str must match the file byte-for-byte (including indentation) and must be unique unless replace_all is set; zero or multiple matches are errors, never guesses. For .ts/.tsx a differential parse gate refuses any patch that increases TypeScript parse diagnostics, while still permitting patches that repair an already-broken file. Set dry_run to preview the match count, diff and gate verdict without committing.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Repo-relative file path, e.g. app/chat/page.tsx' },
      old_str: { type: 'string', description: 'Exact existing text to replace, including indentation. Include enough surrounding context to be unique.' },
      new_str: { type: 'string', description: 'Replacement text. Use an empty string to delete the matched region.' },
      message: { type: 'string', description: 'Commit message (prefixed with [Lex CRS Agent]).' },
      repo: { type: 'string', description: `Optional. Defaults to ${FRONTEND_REPO}.` },
      replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring uniqueness. Default false.' },
      dry_run: { type: 'boolean', description: 'Report match count, diff and gate verdict without committing. Default false.' },
    },
    required: ['path', 'old_str', 'new_str', 'message'],
  },
} as const;
