"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LexAureonClient = void 0;
class LexAureonClient {
    baseUrl;
    constructor(baseUrl = 'https://lexaureon.com') {
        this.baseUrl = baseUrl;
    }
    async request(method, path, data) {
        const url = `${this.baseUrl}${path}`;
        const options = {
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
    async govern(request) {
        return this.request('POST', '/api/lex/govern', request);
    }
    async verify(receiptId) {
        return this.request('GET', `/api/lex/verify/${receiptId}`);
    }
    async health() {
        return this.request('GET', '/api/lex/health');
    }
}
exports.LexAureonClient = LexAureonClient;
