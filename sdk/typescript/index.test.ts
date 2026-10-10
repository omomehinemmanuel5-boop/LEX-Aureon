import { afterEach, describe, expect, it, vi } from 'vitest';
import { LexAureonClient } from './index';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LexAureonClient HTTP contract', () => {
  it('sends the optional API key as a bearer token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      raw_output: 'raw',
      governed_output: 'governed',
      receipt_id: 'receipt-1',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const client = new LexAureonClient({
      baseURL: 'https://example.test',
      sessionId: 'sdk-session',
      apiKey: 'lex_sk_test',
      retries: 1,
    });
    const response = await client.govern({ prompt: 'hello', turn: 2 });

    expect(response.receipt_id).toBe('receipt-1');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: 'Bearer lex_sk_test',
        'Content-Type': 'application/json',
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      prompt: 'hello',
      session_id: 'sdk-session',
      turn: 2,
    });
  });

  it('retries an explicit rate-limit response only when Retry-After is supplied', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        raw_output: 'raw',
        governed_output: 'governed',
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const client = new LexAureonClient({
      baseURL: 'https://example.test',
      retries: 2,
    });
    const response = await client.govern({ prompt: 'retry me' });

    expect(response.governed_output).toBe('governed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not replay a stateful governance POST after a server error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('temporary server failure', { status: 503 }));

    const client = new LexAureonClient({
      baseURL: 'https://example.test',
      retries: 3,
    });

    await expect(client.govern({ prompt: 'may already have executed' })).rejects.toThrow('HTTP 503');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
