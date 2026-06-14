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
