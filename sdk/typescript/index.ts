/**
 * Lex Aureon TypeScript SDK
 * Drop-in governance layer for any LLM
 *
 * Usage:
 * ```
 * import { LexAureonClient } from '@lex-aureon/sdk';
 *
 * const client = new LexAureonClient({
 *   baseURL: 'https://lexaureon.com',
 *   sessionId: 'user-123'
 * });
 *
 * const result = await client.govern({
 *   prompt: 'Your user input here',
 *   turn: 1
 * });
 *
 * console.log(result.governed_output);
 * console.log(result.M); // Constitutional health score
 * ```
 */

export interface GovernanceRequest {
  prompt: string;
  session_id?: string;
  turn?: number;
}

import { GovernanceResponse } from '../../types/governance-types';
import { ConstitutionalState, SemanticSignal } from '../../types';




export interface LexAureonClientConfig {
  baseURL?: string;
  sessionId?: string;
  timeout?: number;
  retries?: number;
}

/**
 * Main Lex Aureon Client
 * Provides a type-safe interface to the governance API
 */
export class LexAureonClient {
  private baseURL: string;
  private sessionId: string;
  private timeout: number;
  private retries: number;

  constructor(config: LexAureonClientConfig = {}) {
    this.baseURL = config.baseURL ?? 'https://lexaureon.com';
    this.sessionId = config.sessionId ?? `session-${Date.now()}`;
    this.timeout = config.timeout ?? 30000;
    this.retries = config.retries ?? 3;
  }

  /**
   * Govern a prompt through the constitutional framework
   */
  async govern(request: GovernanceRequest): Promise<GovernanceResponse> {
    const sessionId = request.session_id ?? this.sessionId;
    const turn = request.turn ?? 1;

    const payload = {
      prompt: request.prompt,
      session_id: sessionId,
      turn,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.retries; attempt++) {
      try {
        const response = await fetch(`${this.baseURL}/api/lex/govern`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeout),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`HTTP ${response.status}: ${error}`);
        }

        return (await response.json()) as GovernanceResponse;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < this.retries - 1) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError ?? new Error('Failed to govern prompt after retries');
  }

  /**
   * Batch govern multiple prompts
   */
  async governBatch(requests: GovernanceRequest[]): Promise<GovernanceResponse[]> {
    return Promise.all(requests.map(req => this.govern(req)));
  }

  /**
   * Get the current session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Set a new session ID
   */
  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  /**
   * Health check — verify the governance API is operational
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseURL}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Convenience function for quick governance
 */
export async function govern(
  prompt: string,
  baseURL: string = 'https://lexaureon.com',
): Promise<GovernanceResponse> {
  const client = new LexAureonClient({ baseURL });
  return client.govern({ prompt });
}

export default LexAureonClient;
