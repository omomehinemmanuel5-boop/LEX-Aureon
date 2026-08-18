/**
 * ═══════════════════════════════════════════════════════════════
 * ARTICLE 0.5 — Tool Call Interceptor
 * Constitutional role: Approve or deny tool calls before execution.
 * Cannot: execute tools, measure CRS independently, or generate content.
 * Implements: cumulative V_z tracking (slow-drip defence).
 *
 * Decision hierarchy:
 *   BLOCKED injection  → DENIED_INJECTION  (no execution ever)
 *   BLOCKED pattern    → DENIED_BLOCKED    (no execution ever)
 *   Session LOCKED     → DENIED_LOCKED     (two HIGHs in recovery)
 *   HIGH in recovery   → DENIED_LOCKED     (sigma_viol elevated)
 *   HIGH (clean state) → APPROVED_HIGH     (executes, sigma_viol rises)
 *   MEDIUM             → APPROVED_MEDIUM   (executes, logged)
 *   LOW                → APPROVED          (executes)
 *
 * fix: uses singleton getClient() from db.ts — was calling createClient()
 * on every DB operation (getSessionState, updateSessionState, writeReceipt,
 * getKernelM) — same connection leak fixed in lex_memory.ts and kernel_bridge.ts.
 *
 * fix (2026-07-11): measureToolCRS is now async (semantic/embedding-based
 * injection detection as a second pass — see tool_crs.ts's file header) —
 * this call site now awaits it. Latency note: for calls that the fast regex
 * pass doesn't already resolve, this adds a real embedding-API round trip to
 * interceptToolCall's total time, not just a compute-bound classification —
 * stated here since it's a real behavior change from before, not silent.
 * ═══════════════════════════════════════════════════════════════
 */

import { ToolCallInput, ToolCallDecision, ToolCRSState, ToolSessionState } from './types';
import { measureToolCRS } from './tool_crs';
import { getClient } from '../db';
import crypto from 'crypto';

// ── Constitutional Tool-Call Cache ───────────────────────────────────────────
// fix (2026-08-03): session-local cache for identical read-only tool calls.
// Identical read_file / read_memory calls within the same session should not
// re-run the full embedding + DB round-trip every time. The cache is keyed on
// (session_id, tool_name, args_hash) and TTL-limited to avoid stale results.
//
// Only READ operations are cached — write operations (create_file, execute_sql,
// etc.) must always go through the full interceptor since their effects are
// not idempotent and the constitutional state must be re-measured.
//
// The cache is in-memory (per process). On Vercel's serverless it resets each
// cold start, which is the correct behavior — it is an optimization, not a
// correctness requirement.

const READ_TOOLS = new Set(['read_file','read_directory','list_files','read_memory',
  'search_memory','fetch_page','curl','http_get','get_file','cat','head','tail',
  'grep','find','ls','dir','glob','read_json','parse_csv']);

interface CacheEntry {
  result:   string;
  decision: ToolCallDecision;
  ts:       number;
}

const _toolCache = new Map<string, CacheEntry>();
const TOOL_CACHE_TTL_MS = 60_000; // 1 minute — long enough for agent loops, short enough to avoid staleness

function cacheKey(session_id: string, toolName: string, args_hash: string): string {
  return `${session_id}:${toolName}:${args_hash}`;
}

function isCacheableTool(toolName: string): boolean {
  return READ_TOOLS.has(toolName);
}

// Constitutional constants — same as text governance
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _TAU_FLOOR    = 0.05;  // Reserved — matches kernel CBF floor
const N_MIN         = 3;     // stable calls before HIGH recovery
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SIGMA_THRESHOLD = 0.25; // cumulative violation threshold

// ── Kernel-informed proxy thresholds ─────────────────────────────────────────
// The kernel's constitutional M for this session informs tool-call strictness.
// Lower M → tighter proxy. Higher M → normal operation.
const KERNEL_CRITICAL  = 0.05;  // deny ALL tool calls
const KERNEL_STRESSED  = 0.15;  // deny write operations, allow reads only
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const KERNEL_ALERT     = 0.22;  // stricter HIGH threshold
const WRITE_TOOLS      = new Set(['write_file','create_file','delete_file','drop_table',
                           'execute_sql','run_command','bash','shell','eval']);

async function getKernelM(session_id: string): Promise<number> {
  try {
    const db = getClient();
    const res = await db.execute({
      sql: 'SELECT last_m FROM z_traj WHERE session_id = ? LIMIT 1',
      args: [session_id],
    });
    if (!res.rows.length) return 1.0; // no kernel state = treat as stable
    return Number(res.rows[0].last_m ?? 1.0);
  } catch {
    return 1.0; // fail open — don't block tools on DB error
  }
}

// ── Session state — persisted in Turso ────────────────────────────────────
async function getSessionState(session_id: string): Promise<ToolSessionState> {
  try {
    const db = getClient();
    const res = await db.execute({
      sql: 'SELECT * FROM tool_sessions WHERE session_id = ? LIMIT 1',
      args: [session_id],
    });
    if (res.rows.length === 0) {
      return {
        session_id,
        sigma_viol: 0,
        n_stable: N_MIN, // start in clean state
        locked: false,
        tool_calls: 0,
        updated_at: new Date().toISOString(),
      };
    }
    const r = res.rows[0];
    return {
      session_id:   String(r.session_id),
      sigma_viol:   Number(r.sigma_viol),
      n_stable:     Number(r.n_stable),
      locked:       Boolean(r.locked),
      tool_calls:   Number(r.tool_calls),
      last_high_at: r.last_high_at ? Number(r.last_high_at) : undefined,
      updated_at:   String(r.updated_at),
    };
  } catch {
    return {
      session_id, sigma_viol: 0, n_stable: N_MIN,
      locked: false, tool_calls: 0, updated_at: new Date().toISOString(),
    };
  }
}

async function updateSessionState(state: ToolSessionState): Promise<void> {
  try {
    const db = getClient();
    await db.execute({
      sql: `INSERT INTO tool_sessions
              (session_id, sigma_viol, n_stable, locked, tool_calls, last_high_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
              sigma_viol   = excluded.sigma_viol,
              n_stable     = excluded.n_stable,
              locked       = excluded.locked,
              tool_calls   = excluded.tool_calls,
              last_high_at = excluded.last_high_at,
              updated_at   = excluded.updated_at`,
      args: [
        state.session_id,
        state.sigma_viol,
        state.n_stable,
        state.locked ? 1 : 0,
        state.tool_calls,
        state.last_high_at ?? null,
        new Date().toISOString(),
      ],
    });
  } catch { /* non-fatal — session state is best-effort */ }
}

// ── Constitutional receipt ─────────────────────────────────────────────────
async function writeReceipt(params: {
  receipt_id: string;
  session_id: string;
  tool_name:  string;
  args_hash:  string;
  decision:   string;
  crs:        ToolCRSState;
  reason:     string;
  sigma_viol: number;
}): Promise<void> {
  try {
    const db = getClient();
    await db.execute({
      sql: `INSERT INTO tool_receipts
              (receipt_id, session_id, tool_name, args_hash,
               decision, c_score, r_score, s_score, m_score,
               risk_level, reason, sigma_viol, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        params.receipt_id,
        params.session_id,
        params.tool_name,
        params.args_hash,
        params.decision,
        params.crs.C,
        params.crs.R,
        params.crs.S,
        params.crs.M,
        params.crs.risk_level,
        params.reason,
        params.sigma_viol,
        new Date().toISOString(),
      ],
    });
  } catch { /* non-fatal */ }
}

// ── Health band from sigma_viol ────────────────────────────────────────────
function toolHealthBand(sigma: number, locked: boolean): ToolCallDecision['health_band'] {
  if (locked)        return 'LOCKED';
  if (sigma >= 0.25) return 'CRITICAL';
  if (sigma >= 0.15) return 'STRESSED';
  if (sigma >= 0.08) return 'ALERT';
  return 'OPTIMAL';
}

// ── Main interceptor ───────────────────────────────────────────────────────
/**
 * Universal wrapper for governed tool execution.
 * 1. Intercepts the call (governance check).
 * 2. If approved, executes the tool function.
 * 3. Returns a unified report string.
 */
async function runToolGoverned(
  toolName: string,
  args: Record<string, unknown>,
  toolFn: (args: Record<string, unknown>) => Promise<string>,
  session_id?: string,
  task_context?: string,
): Promise<string> {
  const sid = session_id ?? `lex-crs-agent-${new Date().toISOString().slice(0, 10)}`;

  // Compute args hash for cache key
  const args_hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(args))
    .digest('hex')
    .slice(0, 32);

  // ── Cache check for identical read-only calls ──────────────────────────────
  if (isCacheableTool(toolName)) {
    const key = cacheKey(sid, toolName, args_hash);
    const cached = _toolCache.get(key);
    if (cached && (Date.now() - cached.ts) < TOOL_CACHE_TTL_MS) {
      // fix (2026-08-18): re-verify kernel M before serving a cache hit.
      // The cache previously returned immediately on a hit, bypassing
      // interceptToolCall entirely — which skipped Step 0 (kernel-critical
      // gate). If a session's kernel M degraded to CRITICAL mid-window,
      // a stale cached read would still be served for up to
      // TOOL_CACHE_TTL_MS, defeating "all tool calls suspended." This is
      // a single cheap DB read (no embedding call), so it doesn't
      // reintroduce the cost the cache exists to avoid — it only restores
      // the one safety invariant the cache broke.
      const currentKernelM = await getKernelM(sid);
      if (currentKernelM < KERNEL_CRITICAL) {
        _toolCache.delete(key); // stale under current kernel state — evict
      } else {
        // Cache hit — skip the rest of the full interceptor + execution
        const report = [
          `── Constitutional tool-call decision [${toolName}] — CACHED ──`,
          `decision:    ${cached.decision.decision}`,
          `approved:    ${cached.decision.approved}`,
          `crs:         C=${cached.decision.crs.C.toFixed(3)} R=${cached.decision.crs.R.toFixed(3)} S=${cached.decision.crs.S.toFixed(3)} M=${cached.decision.crs.M.toFixed(3)}`,
          `risk_level:  ${cached.decision.crs.risk_level}`,
          `health_band: ${cached.decision.health_band}`,
          `sigma_viol:  ${cached.decision.sigma_viol.toFixed(3)}`,
          `receipt_id:  ${cached.decision.receipt_id}`,
          `reason:      ${cached.decision.reason}`,
          `cache_hit:   true`,
          ``,
        ];
        report.push(cached.result);
        return report.join('\n');
      }
    }
  }

  const toolInput: ToolCallInput = {
    id:            crypto.randomUUID(),
    name:          toolName,
    arguments:     args,
    session_id:    sid,
    task_context:  task_context
      ?? (args.message as string | undefined)
      ?? (args.query as string | undefined)
      ?? (args.sql as string | undefined)
      // Fall back to a description that mirrors describeToolCall()'s own
      // "Tool call: X. Target: Y" format instead of a bare tool name. A bare
      // name embeds with near-zero cosine similarity against that format,
      // which floors C at TAU_FLOOR on every ungoverned call and forces
      // risk_level to HIGH regardless of what the tool actually does.
      ?? `Tool call: ${toolName}. Target: ${JSON.stringify(args).slice(0, 200)}`,
  };

  const decision = await interceptToolCall(toolInput);

  const report = [
    `── Constitutional tool-call decision [${toolName}] ──`,
    `decision:    ${decision.decision}`,
    `approved:    ${decision.approved}`,
    `crs:         C=${decision.crs.C.toFixed(3)} R=${decision.crs.R.toFixed(3)} S=${decision.crs.S.toFixed(3)} M=${decision.crs.M.toFixed(3)}`,
    `risk_level:  ${decision.crs.risk_level}`,
    `health_band: ${decision.health_band}`,
    `sigma_viol:  ${decision.sigma_viol.toFixed(3)}`,
    `receipt_id:  ${decision.receipt_id}`,
    `reason:      ${decision.reason}`,
    ...(decision.warning ? [`warning:     ${decision.warning}`] : []),
    ``,
  ];

  if (!decision.approved) {
    report.push(`✗ TOOL BLOCKED — execution halted by constitutional proxy.`);
    return report.join('\n');
  }

  let toolResult = '';
  try {
    toolResult = await toolFn(args);
    report.push(toolResult);
  } catch (e) {
    const errMsg = `Error executing ${toolName}: ${e instanceof Error ? e.message : String(e)}`;
    report.push(errMsg);
    toolResult = errMsg;
  }

  // ── Cache the result for future identical calls ────────────────────────────
  if (isCacheableTool(toolName)) {
    const key = cacheKey(sid, toolName, args_hash);
    _toolCache.set(key, {
      result:   toolResult,
      decision: decision,
      ts:       Date.now(),
    });
  }

  return report.join('\n');
}

export async function interceptToolCall(tool: ToolCallInput): Promise<ToolCallDecision> {
  const t = Date.now();

  // Generate receipt ID
  const receipt_id = 'TCR-' + crypto
    .createHash('sha256')
    .update(`${tool.session_id}:${tool.name}:${JSON.stringify(tool.arguments)}:${t}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();

  // Hash arguments for receipt (never store raw args — may contain sensitive data)
  const args_hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(tool.arguments))
    .digest('hex')
    .slice(0, 32);

  // Step 0: Kernel-informed check — kernel M gates tool execution
  const kernelM = await getKernelM(tool.session_id);
  const kernelCRS = { C: kernelM, R: kernelM, S: kernelM, M: kernelM, risk_level: 'BLOCKED' as const };

  if (kernelM < KERNEL_CRITICAL) {
    await writeReceipt({ receipt_id, session_id: tool.session_id, tool_name: tool.name,
      args_hash, decision: 'DENIED_KERNEL_CRITICAL',
      crs: kernelCRS,
      reason: `Kernel M=${kernelM.toFixed(3)} < τ_floor=${KERNEL_CRITICAL} — constitutional floor violated`,
      sigma_viol: 1 });
    return {
      approved: false,
      decision: 'DENIED_BLOCKED' as const,
      receipt_id,
      crs: kernelCRS,
      health_band: 'CRITICAL' as const,
      reason: `Kernel M=${kernelM.toFixed(3)} < τ_floor=${KERNEL_CRITICAL} — constitutional floor violated in active session. All tool calls suspended.`,
      sigma_viol: 1,
    };
  }

  if (kernelM < KERNEL_STRESSED && WRITE_TOOLS.has(tool.name)) {
    await writeReceipt({ receipt_id, session_id: tool.session_id, tool_name: tool.name,
      args_hash, decision: 'DENIED_KERNEL_STRESSED',
      crs: kernelCRS,
      reason: `Kernel M=${kernelM.toFixed(3)} < ${KERNEL_STRESSED} — write operations suspended during constitutional stress`,
      sigma_viol: 0 });
    return {
      approved: false,
      decision: 'DENIED_BLOCKED' as const,
      receipt_id,
      crs: kernelCRS,
      health_band: 'STRESSED' as const,
      reason: `Kernel M=${kernelM.toFixed(3)} < ${KERNEL_STRESSED} — write operations suspended during constitutional stress. Read-only operations allowed.`,
      sigma_viol: 0,
    };
  }

  // Step 1: CRS measurement (includes injection + hardcoded pattern checks)
  // fix (2026-07-11): now async (semantic injection second-pass) — awaited.
  const crs = await measureToolCRS(tool);

  // Step 2: Immediate BLOCKED — no session state update needed
  if (crs.risk_level === 'BLOCKED') {
    const decision = crs.injection ? 'DENIED_INJECTION' : 'DENIED_BLOCKED';
    const reason = crs.injection
      ? `Prompt injection detected in tool arguments: ${crs.blocked_pattern}`
      : `Hardcoded constitutional invariant violated: ${crs.blocked_pattern}`;

    await writeReceipt({
      receipt_id, session_id: tool.session_id,
      tool_name: tool.name, args_hash, decision,
      crs, reason, sigma_viol: 1.0,
    });

    return {
      approved: false,
      decision,
      reason,
      crs,
      receipt_id,
      sigma_viol: 1.0,
      health_band: 'LOCKED',
    };
  }

  // Step 3: Load session state (cumulative slow-drip defence)
  const session = await getSessionState(tool.session_id);

  // fix (2026-08-15): hard lock previously had no expiry — locked:true was
  // written once (with a real last_high_at timestamp, right below) and never
  // auto-cleared, so a legitimate solo operator working across a real day
  // had no path back in except raw SQL against production (UPDATE
  // tool_sessions SET locked=0 ...). Found 6 separate sessions stuck this
  // way, dating back to 2026-08-07. The lock is a slow-drip CIRCUIT BREAKER
  // — its actual purpose is to block RAPID compounding HIGH actions in a
  // short window, not to require permanent manual intervention. Auto-expiry
  // preserves that real protection (a burst of HIGH actions within
  // LOCK_TTL_MS still gets denied) while removing the requirement to ever
  // touch the database by hand again.
  const LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes — tunable, not safety-critical
  const lockExpired = session.locked && session.last_high_at != null
    && (Date.now() - session.last_high_at) > LOCK_TTL_MS;

  // Step 4: Hard lock check
  if (session.locked && !lockExpired) {
    await writeReceipt({
      receipt_id, session_id: tool.session_id,
      tool_name: tool.name, args_hash, decision: 'DENIED_LOCKED',
      crs, reason: 'Session hard-locked: two HIGH-risk actions in recovery window.',
      sigma_viol: session.sigma_viol,
    });

    return {
      approved: false,
      decision:     'DENIED_LOCKED',
      reason:       'Session hard-locked. Two HIGH-risk actions were detected in the same recovery window. Session requires manual review.',
      crs,
      receipt_id,
      sigma_viol:   session.sigma_viol,
      health_band:  'LOCKED',
    };
  }
  if (lockExpired) {
    // Auto-clear: same fresh state a manual DB reset would have produced.
    session.locked = false;
    session.sigma_viol = 0;
    session.n_stable = N_MIN;
  }

  // Step 5: HIGH action in recovery window — deny to prevent slow-drip
  if (crs.risk_level === 'HIGH' && session.n_stable < N_MIN) {
    // Second HIGH in recovery: hard lock the session
    const newSigma = Math.min(1.0, session.sigma_viol + 0.30);
    const newState: ToolSessionState = {
      ...session,
      sigma_viol: newSigma,
      n_stable:   0,
      locked:     true, // HARD LOCK
      tool_calls: session.tool_calls + 1,
      last_high_at: t,
    };
    await updateSessionState(newState);

    await writeReceipt({
      receipt_id, session_id: tool.session_id,
      tool_name: tool.name, args_hash, decision: 'DENIED_LOCKED',
      crs, reason: `Slow-drip attack detected: HIGH action during recovery (n_stable=${session.n_stable} < N_MIN=${N_MIN}). Session locked.`,
      sigma_viol: newSigma,
    });

    return {
      approved: false,
      decision:    'DENIED_LOCKED',
      reason:      `Slow-drip protection: HIGH-risk action attempted while session is recovering from a previous HIGH action (${session.n_stable}/${N_MIN} stable calls). Session locked.`,
      crs,
      receipt_id,
      sigma_viol:  newSigma,
      health_band: 'LOCKED',
    };
  }

  // Step 6: Approve — update session state based on risk level
  let newState: ToolSessionState;
  let decision: ToolCallDecision['decision'];
  let warning: string | undefined;

  if (crs.risk_level === 'ULTRA_LOW') {
    // ULTRA_LOW — zero sigma_viol impact, faster decay, increments n_stable
    newState = {
      ...session,
      sigma_viol: Math.max(0, session.sigma_viol - 0.10), // faster decay
      n_stable:   Math.min(N_MIN, session.n_stable + 1),
      tool_calls: session.tool_calls + 1,
    };
    decision = 'APPROVED_ULTRA_LOW';

  } else if (crs.risk_level === 'HIGH') {
    // HIGH approved (clean state) — sigma_viol rises, n_stable resets
    newState = {
      ...session,
      sigma_viol:   Math.min(1.0, session.sigma_viol + 0.20),
      n_stable:     0,   // must recover before next HIGH is allowed
      tool_calls:   session.tool_calls + 1,
      last_high_at: t,
    };
    decision = 'APPROVED_HIGH';
    warning  = `HIGH-risk action approved. Session now in recovery: ${N_MIN} stable calls required before next HIGH action.`;

  } else if (crs.risk_level === 'MEDIUM') {
    // MEDIUM — slight sigma_viol rise, n_stable increments toward recovery
    newState = {
      ...session,
      sigma_viol: Math.max(0, session.sigma_viol - 0.02),
      n_stable:   Math.min(N_MIN, session.n_stable + 1),
      tool_calls: session.tool_calls + 1,
    };
    decision = 'APPROVED_MEDIUM';

  } else {
    // LOW — sigma_viol slowly decays, n_stable increments
    newState = {
      ...session,
      sigma_viol: Math.max(0, session.sigma_viol - 0.05),
      n_stable:   Math.min(N_MIN, session.n_stable + 1),
      tool_calls: session.tool_calls + 1,
    };
    decision = 'APPROVED';
  }

  await updateSessionState(newState);
  await writeReceipt({
    receipt_id, session_id: tool.session_id,
    tool_name: tool.name, args_hash, decision,
    crs, reason: `Approved: risk_level=${crs.risk_level}, M=${crs.M.toFixed(3)}`,
    sigma_viol: newState.sigma_viol,
  });

  return {
    approved:    true,
    decision,
    reason:      `Constitutional bounds satisfied. C=${crs.C.toFixed(3)} R=${crs.R.toFixed(3)} S=${crs.S.toFixed(3)} M=${crs.M.toFixed(3)}`,
    crs,
    receipt_id,
    sigma_viol:  newState.sigma_viol,
    health_band: toolHealthBand(newState.sigma_viol, false),
    warning,
  };
}
