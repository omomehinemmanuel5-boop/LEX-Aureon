'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const LyapunovVisualizer = dynamic(() => import('@/components/LyapunovVisualizer'), {
  ssr: false,
  loading: () => <div className="h-96 bg-slate-900/40 rounded-xl animate-pulse" />,
});

const G = { gold: '#c9a84c', navy: '#07070d', surface: '#0f1017', border: '#1a2030' };

interface TraceMetrics {
  active_traces: number;
  total_spans: number;
  avg_latency_ms: number;
  error_rate: number;
  top_agents: Array<{ name: string; count: number; avg_duration_ms: number }>;
}

export default function ObservabilityPage() {
  const [metrics, setMetrics] = useState<TraceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState('');

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/observability/metrics');
        if (res.ok) {
          const data = await res.json();
          setMetrics(data);
        }
      } catch (e) {
        console.error('Failed to fetch metrics:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen" style={{ background: G.navy, color: '#c4cfe0' }}>
      {/* Header */}
      <div style={{ background: G.surface, borderBottom: `1px solid ${G.border}` }}>
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div>
            <span style={{ fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.15em', color: G.gold }}>
              LEX AUREON
            </span>
            <h1 className="text-white font-bold text-2xl mt-1">Deep Observability</h1>
            <p className="text-sm text-gray-400 mt-2">Real-time pipeline tracing and performance metrics</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Key Metrics */}
        {metrics && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              { label: 'Active Traces', value: metrics.active_traces, color: '#4b8fff' },
              { label: 'Total Spans', value: metrics.total_spans, color: G.gold },
              { label: 'Avg Latency', value: `${metrics.avg_latency_ms.toFixed(0)}ms`, color: '#00e5a0' },
              { label: 'Error Rate', value: `${(metrics.error_rate * 100).toFixed(1)}%`, color: '#f7931a' },
            ].map(metric => (
              <div key={metric.label} className="rounded-xl p-4" style={{ background: G.surface, border: `1px solid ${G.border}` }}>
                <div style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.15em', color: '#4a5870', textTransform: 'uppercase', marginBottom: 4 }}>
                  {metric.label}
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, color: metric.color, fontFamily: 'monospace' }}>
                  {metric.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Lyapunov Trajectory */}
        <div>
          <h2 className="text-lg font-bold text-white mb-4">Constitutional State Trajectory</h2>
          <LyapunovVisualizer sessionId={sessionId || undefined} height={400} />
        </div>

        {/* Agent Performance */}
        {metrics && metrics.top_agents.length > 0 && (
          <div className="rounded-xl p-6" style={{ background: G.surface, border: `1px solid ${G.border}` }}>
            <h2 className="text-lg font-bold text-white mb-4">Agent Performance</h2>
            <div className="space-y-3">
              {metrics.top_agents.map(agent => (
                <div key={agent.name} className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                  <div>
                    <div className="font-mono font-bold text-white">{agent.name}</div>
                    <div className="text-xs text-gray-400">{agent.count} executions</div>
                  </div>
                  <div className="text-right">
                    <div style={{ color: G.gold }} className="font-mono font-bold">
                      {agent.avg_duration_ms.toFixed(0)}ms
                    </div>
                    <div className="text-xs text-gray-400">avg latency</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Session Filter */}
        <div className="rounded-xl p-6" style={{ background: G.surface, border: `1px solid ${G.border}` }}>
          <h2 className="text-lg font-bold text-white mb-4">Filter by Session</h2>
          <input
            type="text"
            placeholder="Enter session ID (optional)"
            value={sessionId}
            onChange={e => setSessionId(e.target.value)}
            className="w-full px-4 py-2 rounded-lg text-white"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: `1px solid ${G.border}`,
            }}
          />
          <p className="text-xs text-gray-400 mt-2">Leave empty to see all sessions</p>
        </div>

        {/* Documentation */}
        <div className="rounded-xl p-6" style={{ background: G.surface, border: `1px solid ${G.border}` }}>
          <h2 className="text-lg font-bold text-white mb-4">About Deep Observability</h2>
          <div className="space-y-3 text-sm text-gray-300">
            <p>
              Lex Aureon's 10-agent pipeline is instrumented with OpenTelemetry for deep observability. Every agent's execution is traced, including:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-2">
              <li>Agent initialization and setup</li>
              <li>Input processing and embedding</li>
              <li>Constitutional state measurement</li>
              <li>Decision points and interventions</li>
              <li>Output validation and projection</li>
              <li>Performance metrics and latency</li>
            </ul>
            <p className="mt-4">
              Traces are exported to OpenTelemetry-compatible backends including Arize Phoenix, LangSmith, Datadog, and New Relic.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
