/**
 * Lex Aureon — Constitutional Agent Types
 * Each agent is isolated, auditable, and constitutionally bounded.
 * Article III: Separation of Powers — no agent generates, verifies, and approves.
 */

export interface CRSState {
  C: number; R: number; S: number; M: number;
}

export interface AgentContext {
  // Input
  prompt?: string;
  session_id?: string;

  // System prompt override — used by route.ts to pass constitutional identity
  // into the generator's system role (not the user role).
  // Bare arm omits this; anchored arm sets CONSTITUTIONAL_SYSTEM_PROMPT here.
  system_prompt?: string;

  // z-weights for V_z Lyapunov: computed from z_traj history in route.ts
  // and passed to CRSExtractorAgent. Normalised so Σzᵢ = 3.
  // When absent, extractor falls back to uniform weights (plain V).
  z_weights?: [number, number, number];

  // Turn counter — current session turn, passed from route.ts
  // Used by extractor for multi-turn CRS computations.
  turn?: number;

  // Accumulated sigma_viol from z_traj — passed to extractor
  sigma_viol?: number;

  // Neithra (III.5) — alignment verification
  proposed_law_id?:    number;
  neithra_verified?:   boolean;
  neithra_re_routed?:  boolean;

  // Clause Bank (III.6) — jurisdiction context
  jurisdiction?:       string;
  output_domain?:      string;
  clause_id?:          string;

  // Celeste (VI) — output format
  output_format?:      'api' | 'web' | 'pdf' | 'terminal';

  // Propagated through pipeline
  raw_output?: string;
  governed_output?: string;
  crs_state?: CRSState;
  prev_state?: CRSState;

  // Governor decisions
  intervention_required?: boolean;
  intervention_type?: string;
  trigger_reason?: string;

  // Governor decision
  weakest_dimension?: string;

  // Kernel internals
  theta?: number;
  attack_pressure?: number;
  semantic_signal?: { type: string; severity: number };
  lyapunov_V?: number;
  delta_V?: number;
  cbf_triggered?: boolean;
  projection_magnitude?: number;
  adv_gain?: number;
  velocity?: number;
  health_band?: string;

  // Audit
  audit_id?: string;
  timestamp?: number;
  receipts?: AgentReceipt[];
}

export interface AgentResult {
  success: boolean;
  output?: string;
  meta?: Record<string, unknown>;
  error?: string;
  duration_ms?: number;
}

export interface AgentReceipt {
  agent: string;
  timestamp: number;
  duration_ms: number;
  success: boolean;
  decision?: string;
  meta?: Record<string, unknown>;
}

export type AgentFn = (ctx: AgentContext) => Promise<AgentResult>;

// ══════════════════════════════════════════════════════════════════════════════
// TOOL CALL GOVERNANCE TYPES
// Completely separate from text governance. Same mathematical foundation,
// different input domain: structured tool calls instead of free text.
// ══════════════════════════════════════════════════════════════════════════════

/** A proposed tool call from an enterprise agent — the unit being governed. */
export interface ToolCallInput {
  id:            string;
  name:          string;
  arguments:     Record<string, unknown>;
  session_id:    string;
  task_context?: string;   // original task the agent was given (for C measurement)
  turn?:         number;
}

/** Constitutional state measurement for a single tool call. */
export interface ToolCRSState {
  C:          number;   // task Continuity — is this consistent with the original task?
  R:          number;   // intent Reciprocity — does this match the user's actual intent?
  S:          number;   // scope Sovereignty — is this within authorized scope?
  M:          number;   // min(C, R, S) — stability margin
  risk_level: 'ULTRA_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKED';
}

/** The interceptor's final verdict on a proposed tool call. */
export interface ToolCallDecision {
  approved:     boolean;
  decision:     'APPROVED_ULTRA_LOW' | 'APPROVED' | 'APPROVED_HIGH' | 'APPROVED_MEDIUM' |
                'DENIED_BLOCKED' | 'DENIED_LOCKED' | 'DENIED_INJECTION';
  reason:       string;
  crs:          ToolCRSState;
  receipt_id:   string;
  sigma_viol:   number;
  health_band:  'OPTIMAL' | 'ALERT' | 'STRESSED' | 'CRITICAL' | 'LOCKED';
  warning?:     string;
}

/**
 * Per-session tool governance state — persisted in Turso (tool_sessions table).
 * Tracks cumulative constitutional health across tool calls.
 * Implements the slow-drip defence: a single HIGH is allowed, but
 * recovery requires n_stable >= N_MIN before another HIGH proceeds.
 */
export interface ToolSessionState {
  session_id:     string;
  sigma_viol:     number;   // cumulative violation pressure
  n_stable:       number;   // consecutive non-HIGH calls since last HIGH
  locked:         boolean;  // hard lock: two HIGHs in recovery window
  tool_calls:     number;   // total calls this session
  last_high_at?:  number;   // timestamp of last HIGH action
  updated_at:     string;
}
