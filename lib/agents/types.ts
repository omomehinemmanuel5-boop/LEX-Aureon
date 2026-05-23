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
  prompt: string;
  session_id: string;

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


