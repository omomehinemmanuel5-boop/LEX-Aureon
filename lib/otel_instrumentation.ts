/**
 * OpenTelemetry Instrumentation for Lex Aureon
 *
 * Provides deep observability into the 10-agent pipeline.
 * Traces every agent's execution, decision, and impact on the constitutional state.
 *
 * Exports to OpenTelemetry-compatible backends:
 * - Arize Phoenix (local or cloud)
 * - LangSmith
 * - Datadog
 * - New Relic
 * - Custom HTTP exporter
 */

interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  agent: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  status: 'pending' | 'success' | 'error';
  attributes: Record<string, unknown>;
  events: TraceEvent[];
}

interface TraceEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, unknown>;
}

interface PipelineTrace {
  traceId: string;
  sessionId: string;
  startTime: number;
  endTime?: number;
  spans: TraceSpan[];
  metadata: {
    prompt_hash: string;
    input_length: number;
    model: string;
    temperature: number;
  };
}

class OTelInstrumentor {
  private traces: Map<string, PipelineTrace> = new Map();
  private exportUrl: string | null = null;
  private enabled: boolean = false;

  constructor() {
    const otelEnabled = typeof process !== 'undefined' && process.env.OTEL_ENABLED === 'true';
    const otelEndpoint = typeof process !== 'undefined' ? process.env.OTEL_EXPORTER_OTLP_ENDPOINT : undefined;
    this.enabled = otelEnabled || otelEndpoint !== undefined;
    const langsmithKey = typeof process !== 'undefined' ? process.env.LANGSMITH_API_KEY : undefined;
    this.exportUrl = otelEndpoint || (langsmithKey ? 'https://api.smith.langchain.com' : null);
  }

  startTrace(
    sessionId: string,
    promptHash: string,
    inputLength: number,
    model: string,
    temperature: number
  ): string {
    const traceId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const trace: PipelineTrace = {
      traceId,
      sessionId,
      startTime: Date.now(),
      spans: [],
      metadata: { prompt_hash: promptHash, input_length: inputLength, model, temperature },
    };

    this.traces.set(traceId, trace);
    return traceId;
  }

  startSpan(traceId: string, agentName: string, parentSpanId?: string): string {
    const trace = this.traces.get(traceId);
    if (!trace) return '';

    const spanId = `${agentName}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const span: TraceSpan = {
      traceId,
      spanId,
      parentSpanId,
      name: `agent.${agentName}`,
      agent: agentName,
      startTime: Date.now(),
      status: 'pending',
      attributes: {},
      events: [],
    };

    trace.spans.push(span);
    return spanId;
  }

  addEvent(
    traceId: string,
    spanId: string,
    eventName: string,
    attributes: Record<string, unknown> = {}
  ): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find(s => s.spanId === spanId);
    if (!span) return;

    span.events.push({ name: eventName, timestamp: Date.now(), attributes });
  }

  endSpan(
    traceId: string,
    spanId: string,
    status: 'success' | 'error' = 'success',
    attributes: Record<string, unknown> = {}
  ): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find(s => s.spanId === spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    span.attributes = { ...span.attributes, ...attributes };
  }

  async endTrace(traceId: string, finalAttributes: Record<string, unknown> = {}): Promise<void> {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    trace.endTime = Date.now();

    for (const span of trace.spans) {
      span.attributes = { ...span.attributes, ...finalAttributes };
    }

    if (this.enabled && this.exportUrl) {
      try {
        await this.exportTrace(trace);
      } catch (e) {
        console.warn('[OTel] Export failed:', e);
      }
    }

    setTimeout(() => {
      this.traces.delete(traceId);
    }, 5 * 60 * 1000);
  }

  private async exportTrace(trace: PipelineTrace): Promise<void> {
    if (!this.exportUrl) return;

    const langsmithKey =
      typeof process !== 'undefined' ? process.env.LANGSMITH_API_KEY || '' : '';

    const payload = {
      resourceSpans: [
        {
          resource: { attributes: { 'service.name': 'lex-aureon', 'service.version': '2.0' } },
          scopeSpans: [
            {
              scope: { name: 'lex-aureon-pipeline' },
              spans: trace.spans.map(span => ({
                traceId: span.traceId,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                name: span.name,
                startTimeUnixNano: span.startTime * 1_000_000,
                endTimeUnixNano: (span.endTime || Date.now()) * 1_000_000,
                status: { code: span.status === 'success' ? 0 : 1 },
                attributes: span.attributes,
                events: span.events.map(evt => ({
                  name: evt.name,
                  timeUnixNano: evt.timestamp * 1_000_000,
                  attributes: evt.attributes,
                })),
              })),
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(this.exportUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${langsmithKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(`[OTel] Export returned ${response.status}`);
      }
    } catch (e) {
      console.warn('[OTel] Export network error:', e);
    }
  }

  getTrace(traceId: string): PipelineTrace | undefined {
    return this.traces.get(traceId);
  }

  getActiveTraces(): PipelineTrace[] {
    return Array.from(this.traces.values());
  }
}

export const otel = new OTelInstrumentor();

/**
 * Decorator for agent execution. TypeScript decorators require `any` for
 * the method descriptor pattern — suppressed with eslint-disable.
 *
 * Usage:
 *   @instrumentAgent('auditor')
 *   async executeAuditor(input) { ... }
 */
export function instrumentAgent(agentName: string) {
  return function (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _target: object,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value as (...args: unknown[]) => Promise<unknown>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descriptor.value = async function (this: any, ...args: unknown[]) {
      const traceId = (this as { traceId?: string }).traceId || '';
      const spanId = otel.startSpan(traceId, agentName);

      try {
        const result = await originalMethod.apply(this, args);
        otel.endSpan(traceId, spanId, 'success', { result_type: typeof result });
        return result;
      } catch (e) {
        otel.endSpan(traceId, spanId, 'error', { error: String(e) });
        throw e;
      }
    };

    return descriptor;
  };
}

export type { TraceSpan, TraceEvent, PipelineTrace };
