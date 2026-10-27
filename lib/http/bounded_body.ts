export type BoundedBodyResult =
  | { kind: 'ok'; text: string }
  | { kind: 'too_large' }
  | { kind: 'timed_out' }
  | { kind: 'read_error' };

/**
 * Read a request body without trusting Content-Length. This protects routes
 * that accept chunked HTTP bodies from parsing an arbitrarily large payload.
 */
export async function readBoundedBody(
  req: Request,
  maxBytes: number,
  timeoutMs: number,
): Promise<BoundedBodyResult> {
  if (!req.body) return { kind: 'ok', text: '' };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });

  try {
    while (true) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next === 'timeout') {
        await reader.cancel().catch(() => undefined);
        return { kind: 'timed_out' };
      }
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { kind: 'too_large' };
      }
      chunks.push(next.value);
    }
  } catch {
    return { kind: 'read_error' };
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', text: new TextDecoder().decode(body) };
}
