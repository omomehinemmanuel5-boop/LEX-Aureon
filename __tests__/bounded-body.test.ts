import { describe, expect, it } from 'vitest';
import { readBoundedBody } from '../lib/http/bounded_body';

function requestFromStream(chunks: Uint8Array[]) {
  return new Request('http://localhost/test', {
    method: 'POST',
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    // Deliberately omit Content-Length: chunked requests must still be bounded.
    duplex: 'half',
  } as RequestInit);
}

describe('readBoundedBody', () => {
  it('rejects oversized chunked bodies before JSON parsing', async () => {
    const result = await readBoundedBody(requestFromStream([
      new TextEncoder().encode('{"large":"payload"}'),
    ]), 8, 1000);

    expect(result).toEqual({ kind: 'too_large' });
  });

  it('reads a bounded chunked body successfully', async () => {
    const result = await readBoundedBody(requestFromStream([
      new TextEncoder().encode('{"a":'),
      new TextEncoder().encode('1}'),
    ]), 32, 1000);

    expect(result).toEqual({ kind: 'ok', text: '{"a":1}' });
  });

  it('returns an empty body when no stream is present', async () => {
    const result = await readBoundedBody(new Request('http://localhost/test'), 32, 1000);
    expect(result).toEqual({ kind: 'ok', text: '' });
  });
});
