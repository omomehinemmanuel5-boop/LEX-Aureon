import { GovernerRequest, GovernerResponse, VerifyResponse } from './types';
export declare class LexAureonClient {
    private baseUrl;
    constructor(baseUrl?: string);
    private request;
    govern(request: GovernerRequest): Promise<GovernerResponse>;
    verify(receiptId: string): Promise<VerifyResponse>;
    health(): Promise<{
        status: string;
        m: number;
    }>;
}
