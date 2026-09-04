export interface RequestContext {
  requestId: string;
  traceId: string;
  parentSpanId?: string;
}

const requestIdPattern = /^[a-zA-Z0-9._:-]{1,128}$/;
const traceparentPattern = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/i;

function randomTraceId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

export function createRequestContext(headers: Headers): RequestContext {
  const candidate = headers.get('x-request-id') ?? undefined;
  const requestId = candidate && requestIdPattern.test(candidate) ? candidate : crypto.randomUUID();
  const traceparent = headers.get('traceparent')?.match(traceparentPattern);
  return {
    requestId,
    traceId: traceparent?.[1] ?? randomTraceId(),
    parentSpanId: traceparent?.[2],
  };
}

export function applyRequestContext<T extends Response>(response: T, context: RequestContext): T {
  response.headers.set('x-request-id', context.requestId);
  response.headers.set('x-trace-id', context.traceId);
  return response;
}
