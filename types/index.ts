export interface ConstitutionalState {
  C: number; // Continuity
  R: number; // Reciprocity
  S: number; // Sovereignty
}

export interface SemanticSignal {
  attack_type: 'identity' | 'coercion' | 'exploitative' | 'none';
  severity: number;
}

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
