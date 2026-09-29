import { GovernerRequest, GovernerResponse, VerifyResponse, ToolManifest, CapabilityDiscoveryResponse } from './types';

export class LexAureonClient {
  constructor(
    private baseUrl: string = 'https://lexaureon.com',
    private apiKey?: string,
  ) {}

  private async request<T>(method: string, path: string, data?: any): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'x-lex-api-key': this.apiKey } : {}),
      },
    };
    if (data) {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    return response.json();
  }

  async govern(request: GovernerRequest): Promise<GovernerResponse> {
    return this.request<GovernerResponse>('POST', '/api/lex/govern', request);
  }

  async verify(receiptId: string): Promise<VerifyResponse> {
    return this.request<VerifyResponse>('GET', `/api/lex/verify/${receiptId}`);
  }

  async health(): Promise<{ status: string; m: number }> {
    return this.request<{ status: string; m: number }>('GET', '/api/lex/health');
  }

  /**
   * Register the current environment's native tool manifest with Lex.
   * For MCP, pass the exact objects returned by tools/list(). Lex resolves
   * capabilities conservatively; discovery never bypasses execution gates.
   */
  async discoverCapabilities(tools: ToolManifest[]): Promise<CapabilityDiscoveryResponse> {
    return this.request<CapabilityDiscoveryResponse>('POST', '/api/lex/capabilities/discover', { tools });
  }
}
