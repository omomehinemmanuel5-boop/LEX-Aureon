export interface TrustReceipt {
  id?: string;
  run_id?: string;
  timestamp?: number;
  generated_at?: string;
  plan?: string;
  model?: string;
  input_hash?: string;
  prompt_hash?: string;
  output_hash?: string;
  raw_output_hash?: string;
  governed_output_hash?: string;
  integrity_signature?: string;
  signature?: string;
  key_id?: string;
  receipt_version?: string;
  governor_version?: string;
  health?: string;
  M?: number;
  M_score?: number;
  intervention?: boolean;
  intervention_applied?: boolean;
  crs_state?: { C: number; R: number; S: number };
  crs_vector?: { C: number; R: number; S: number };
}

export interface GovernanceResponse {
  /** Bare LLM output — no constitutional preamble. The "what would the LLM say
   *  without governance" arm. Used for transparency / comparison only; not
   *  measured, not governed. Empty on blocked path (no LLM call made). */
  raw_output: string;
  /** LLM output under CONSTITUTIONAL_SYSTEM_PROMPT. The pre-intervention arm
   *  that CRS extraction, the governor, and the intervention agent all
   *  operate on. Empty on blocked path. */
  anchored_output?: string;
  governed_output: string;
  metrics: {
    c: number;
    r: number;
    s: number;
    m: number;
    M_raw?: number;    // pre-governance stability margin
    M_governed?: number; // post-governance measured stability margin
    health?: string;
    health_band?: string;
    c_measured?: number;
    r_measured?: number;
    s_measured?: number;
  };
  law_fired?: string | null;
  intervention?: {
    triggered?: boolean;
    applied?: boolean;
    type?: string;
    reason?: string;
  };
  diff?: {
    changed?: boolean;
    delta_score?: number;
    summary?: string;
    removed: string[];
    added: string[];
    unchanged: string[];
  };
  state?: {
    raw: { c: number; r: number; s: number };
    governed: { c: number; r: number; s: number };
  };
  triggers?: {
    collapse: boolean;
    velocity: boolean;
    per_invariant?: { C?: boolean; R?: boolean; S?: boolean };
  };
  audit_id?: string;
  timestamp?: number;
  upgrade_required?: boolean;
  trust_receipt?: TrustReceipt | null;
  z_traj?: {
    velocity: number;
    n_stable: number;
    drift_dir: string;
    sigma_viol: number;
    attack_pressure?: number;
  };
  // Kernel-specific fields returned by the API but not in the original interface
  M?: number;
  health_band?: string;
  temperature?: number;
  theta?: number;
  effective_theta?: number;
  attack_pressure?: number;
  semantic_signal?: {
    attack_type?: string;
    severity?: number;
  };
  lyapunov_V?: number;
  delta_V?: number;
  stability_ratio?: number;
  memory_injected?: boolean;
  pre_eval?: any;
  governor?: any;
  law_invoked?: any;
  vaulturex?: any;
  self_referential_fired?: boolean;
  receipt_id?: string;
  version?: string;
  projection_triggered?: boolean;
}

export interface PreEvalResult {
  riskLevel: 'low' | 'medium' | 'high';
  flags: string[];
  predictedC: number;
  predictedR: number;
  predictedS: number;
  confidence: number;
}

export interface AuthUser {
  id?: string;
  email?: string;
  name?: string;
  plan?: string;
}
