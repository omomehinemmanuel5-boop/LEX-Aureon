import { GovernerRequest, GovernerResponse, VerifyResponse } from './types';

export class LexAureonClient {
  constructor(private baseUrl: string = 'https://lexaureon.com') {}

  private async request<T>(method: string, path: string, data?: any): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
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
}
