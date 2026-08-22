'use client';
import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import LiveGovernanceState from '@/components/LiveGovernanceState';
import TimelineReplayControls from '@/components/TimelineReplayControls';

const LyapunovVisualizer = dynamic(() => import('@/components/LyapunovVisualizer'), {
  ssr: false,
  loading: () => <div className="h-96 bg-slate-900/40 rounded-xl animate-pulse" />,
});

const G = { gold: '#c9a84c', navy: '#07070d', surface: '#0f1017', border: '#1a2030' };

// Shape matches /api/observability/metrics response exactly
interface AgentStat {
  calls: number;
  avg_duration_ms: number;
  error_count: number;
  error_rate: number;
  last_call: string | null;
}

interface MetricsResponse {
  timestamp: string;
  window_minutes: number;
  agents: Record<string, AgentStat>;
  system: {
    total_calls: number;
    total_errors: number;
    global_error_rate: number;
    avg_pipeline_duration_ms: number;
  };
  health_status: 'OPTIMAL' | 'ALERT' | 'STRESSED' | 'CRITICAL';
}

const HEALTH_COLOR: Record<string, string> = {
  OPTIMAL: '#00e5a0',
  ALERT: '#f7931a',
  STRESSED: '#ff6b35',
  CRITICAL: '#ff3b30',
};

export default function ObservabilityPage() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionId, setSessionId] = useState('');
  const [replayMode, setReplayMode] = useState<'live' | 'pause'>('live');

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const res = await fetch('/api/observability/metrics');
        if (res.ok) {
          const data = await res.json() as MetricsResponse;
          setMetrics(data);
        }
      } catch (err) {
        console.error('Failed to fetch metrics:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    // fix (2026-07-13) — READ EXHAUSTION: /api/observability/metrics sets
    // `export const revalidate = 30` (30s intent) but no response-level
    // Cache-Control header, so a 5s client poll was still forcing a fresh
    // Turso read on nearly every tick (see HeroTicker.tsx's fix note for
    // the full diagnosis across all six components found this way).
    // Matched to the route's own 30s revalidate intent.
    const interval = setInterval(fetchMetrics, 30_000);
    return () => clearInterval(interval);
  }, []);

  const agentList = metrics
    ? Object.entries(metrics.agents).map(([name, stat]) => ({ name, ...stat }))
    : [];

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

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* Loading state */}
        {loading && (
          <div className="rounded-xl p-8 text-center" style={{ background: G.surface, border: `1px solid ${G.border}` }}>
            <div className="text-gray-400">Loading metrics from audit_log...</div>
          </div>
        )}

        <section className="space-y-4">
          <LiveGovernanceState />
          <TimelineReplayControls mode={replayMode} onModeChange={setReplayMode} />
        </section>

        {/* Key Metrics */}
        {metrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Calls', value: metrics.system.total_calls, color: '#4b8fff' },
              { label: 'Avg Latency', value: `${metrics.system.avg_pipeline_duration_ms}ms`, color: G.gold },
              { label: 'Error Rate', value: `${(metrics.system.global_error_rate * 100).toFixed(1)}%`, color: '#f7931a' },
              { label: 'Health', value: metrics.health_status, color: HEALTH_COLOR[metrics.health_status] ?? G.gold },
            ].map(metric => (
              <div key={metric.label} className="rounded-xl p-4" style={{ background: G.surface, border: `1px solid ${G.border}` }}>
                <div style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.15em', color: '#4a5870', textTransform: 'uppercase', marginBottom: 4 }}>
                  {metric.label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: metric.color, fontFamily: 'monospace' }}>
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
        {agentList.length > 0 && (
          <div className="rounded-xl p-6" style={{ background: G.surface, border: `1px solid ${G.border}` }}>
            <h2 className="text-lg font-bold text-white mb-4">Agent Performance</h2>
            <div className="space-y-3">
              {agentList.map(agent => (
                <div key={agent.name} className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                  <div>
                    <div className="font-mono font-bold text-white">{agent.name}</div>
                    <div className="text-xs text-gray-400">{agent.calls} executions</div>
                  </div>
                  <div className="text-right">
                    <div style={{ color: G.gold }} className="font-mono font-bold">
                      {agent.avg_duration_ms}ms
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
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSessionId(e.target.value)}
            className="w-full px-4 py-2 rounded-lg text-white"
            style={{ background: 'rgba(255, 255, 255, 0.05)', border: `1px solid ${G.border}` }}
          />
          <p className="text-xs text-gray-400 mt-2">Leave empty to see all sessions</p>
        </div>

        {/* Documentation */}
        <div className="rounded-xl p-6" style={{ background: G.surface, border: `1px solid ${G.border}` }}>
          <h2 className="text-lg font-bold text-white mb-4">About Deep Observability</h2>
          <div className="space-y-3 text-sm text-gray-300">
            <p>
              Lex Aureon&apos;s 10-agent pipeline is instrumented with OpenTelemetry for deep
              observability. Every agent&apos;s execution is traced, including:
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
              Traces are exported to OpenTelemetry-compatible backends including Arize Phoenix,
              LangSmith, Datadog, and New Relic.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
