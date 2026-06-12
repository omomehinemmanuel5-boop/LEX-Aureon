import { TrustReceipt, ConstitutionalState, SemanticSignal } from './index';

export interface GovernanceResponse {
  raw_output: string;
  anchored_output?: string;
  governed_output: string;
  metrics: {
    c: number;
    r: number;
    s: number;
    m: number;
    M_raw?: number;
    M_governed?: number;
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
  } | ConstitutionalState; // Allow for both nested and flat state
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
  // Kernel-specific fields, now part of the unified type
  M?: number;
  health_band?: string;
  temperature?: number;
  theta?: number;
  effective_theta?: number;
  attack_pressure?: number;
  semantic_signal?: SemanticSignal;
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
  // SDK-specific fields that were top-level
  C?: number;
  R?: number;
  S?: number;
  adv_gain?: number;
  suspension_triggered?: boolean;
  epsilon_injected?: boolean;
  projection_magnitude?: number;
  invariance_violations?: number;
}
