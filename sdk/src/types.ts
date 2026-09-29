export interface GovernerRequest {
  prompt: string;
  model?: string;
  session_id?: string;
}

export interface GovernerResponse {
  governed_output: string;
  bare_output: string;
  health: 'OPTIMAL' | 'ALERT' | 'STRESSED' | 'CRITICAL';
  m_score: number;
  c: number;
  r: number;
  s: number;
  intervention: boolean;
  receipt_id: string;
}

export interface VerifyResponse {
  valid: boolean;
  receipt_id: string;
  timestamp: string;
}

export interface ToolManifest {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
    idempotentHint?: boolean;
  };
}

export interface DiscoveredToolCapability {
  name: string;
  capability: string;
  confidence: 'high' | 'medium' | 'low' | 'unresolved';
  requires_approval: boolean;
  reversible: boolean;
  evidence: string[];
  manifest_hash: string;
  discovered_at: number;
  snapshot_hash: string;
  revision: number;
  expires_at: number;
  active: boolean;
}

export interface CapabilityDiscoveryResponse {
  environment_id: string;
  discovered: DiscoveredToolCapability[];
  snapshot?: { hash: string | null; revision: number | null; expires_at: number | null };
  policy: string;
}

export interface CapabilityDiscoveryState {
  environment_id: string;
  tools: DiscoveredToolCapability[];
}
