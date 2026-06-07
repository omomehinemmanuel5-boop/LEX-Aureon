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
    // Check if OpenTelemetry is enabled via environment
    this.enabled = process.env.OTEL_ENABLED === 'true' || process.env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined;
    this.exportUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.LANGSMITH_API_KEY ? 'https://api.smith.langchain.com' : null;
  }

  /**
   * Start a new trace for a governance cycle
   */
  startTrace(sessionId: string, promptHash: string, inputLength: number, model: string, temperature: number): string {
    const traceId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    const trace: PipelineTrace = {
      traceId,
      sessionId,
      startTime: Date.now(),
      spans: [],
      metadata: {
        prompt_hash: promptHash,
        input_length: inputLength,
        model,
        temperature,
      },
    };

    this.traces.set(traceId, trace);
    return traceId;
  }

  /**
   * Start a span for an agent
   */
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

  /**
   * Add an event to a span
   */
  addEvent(traceId: string, spanId: string, eventName: string, attributes: Record<string, unknown> = {}): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find(s => s.spanId === spanId);
    if (!span) return;

    span.events.push({
      name: eventName,
      timestamp: Date.now(),
      attributes,
    });
  }

  /**
   * End a span
   */
  endSpan(traceId: string, spanId: string, status: 'success' | 'error' = 'success', attributes: Record<string, unknown> = {}): void {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    const span = trace.spans.find(s => s.spanId === spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    span.attributes = { ...span.attributes, ...attributes };
  }

  /**
   * End a trace and export it
   */
  async endTrace(traceId: string, finalAttributes: Record<string, unknown> = {}): Promise<void> {
    const trace = this.traces.get(traceId);
    if (!trace) return;

    trace.endTime = Date.now();

    // Add final attributes to all spans
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

    // Keep trace in memory for 5 minutes, then clean up
    setTimeout(() => {
      this.traces.delete(traceId);
    }, 5 * 60 * 1000);
  }

  /**
   * Export trace to OpenTelemetry backend
   */
  private async exportTrace(trace: PipelineTrace): Promise<void> {
    if (!this.exportUrl) return;

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: {
              'service.name': 'lex-aureon',
              'service.version': '2.0',
            },
          },
          scopeSpans: [
            {
              scope: {
                name: 'lex-aureon-pipeline',
              },
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
          'Authorization': `Bearer ${process.env.LANGSMITH_API_KEY || ''}`,
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

  /**
   * Get a trace for inspection
   */
  getTrace(traceId: string): PipelineTrace | undefined {
    return this.traces.get(traceId);
  }

  /**
   * Get all active traces
   */
  getActiveTraces(): PipelineTrace[] {
    return Array.from(this.traces.values());
  }
}

// Singleton instance
export const otel = new OTelInstrumentor();

/**
 * Decorator for agent execution
 * Usage:
 *   @instrumentAgent('auditor')
 *   async executeAuditor(input) { ... }
 */
export function instrumentAgent(agentName: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (this: any, ...args: any[]) {
      const traceId = this.traceId || '';
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
