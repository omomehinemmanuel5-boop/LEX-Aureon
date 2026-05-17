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
  raw_output: string;
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
  };
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
