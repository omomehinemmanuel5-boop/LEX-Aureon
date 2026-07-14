'use client';

import { useEffect, useRef, useState } from 'react';

interface TrajectoryPoint {
  timestamp: number;
  C: number;
  R: number;
  S: number;
  M: number;
  health_band: string;
  intervention: boolean;
  reason?: string;
}

interface LyapunovVisualizerProps {
  sessionId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
  height?: number;
}

const G = { gold: '#c9a84c', navy: '#07070d', surface: '#0f1017', border: '#1a2030' };

/**
 * Real-Time Lyapunov Visualizer
 * 
 * Shows the (C, R, S) state trajectory in a 2D ternary plot.
 * The trajectory is rendered as a path with color-coded health bands.
 *
 * fix (2026-07-13) — READ EXHAUSTION: default refreshInterval was 3000ms.
 * Unlike the other pollers fixed alongside this one (see HeroTicker.tsx's
 * fix note), /api/lex/trajectory carries NO server-side Cache-Control at
 * all, so every tick here was already a guaranteed fresh Turso read -- the
 * interval itself was the entire problem, not a cache bypass. Raised the
 * default to 30s, matching the interval used elsewhere for routes with a
 * real cache once caching was actually in play.
 */
export default function LyapunovVisualizer({
  sessionId,
  autoRefresh = true,
  refreshInterval = 30_000,
  height = 400,
}: LyapunovVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<TrajectoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ min_M: 1, max_M: 0, avg_M: 0.333, interventions: 0 });

  // Fetch trajectory data
  const fetchTrajectory = async () => {
    try {
      const params = new URLSearchParams();
      if (sessionId) params.append('session_id', sessionId);
      params.append('limit', '200');

      const res = await fetch(`/api/lex/trajectory?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      setPoints(data.points || []);

      // Calculate statistics
      if (data.points.length > 0) {
        const Ms = data.points.map((p: TrajectoryPoint) => p.M);
        const interventions = data.points.filter((p: TrajectoryPoint) => p.intervention).length;
        setStats({
          min_M: Math.min(...Ms),
          max_M: Math.max(...Ms),
          avg_M: Ms.reduce((a: number, b: number) => a + b, 0) / Ms.length,
          interventions,
        });
      }

      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch trajectory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrajectory();
    if (!autoRefresh) return;

    const interval = setInterval(fetchTrajectory, refreshInterval);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, autoRefresh, refreshInterval]);

  // Draw the ternary plot
  useEffect(() => {
    if (!canvasRef.current || points.length === 0) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const padding = 40;

    // Clear canvas
    ctx.fillStyle = G.surface;
    ctx.fillRect(0, 0, w, h);

    // Draw border
    ctx.strokeStyle = G.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, w, h);

    // Ternary plot vertices (equilateral triangle)
    const top = { x: w / 2, y: padding };
    const left = { x: padding, y: h - padding };
    const right = { x: w - padding, y: h - padding };

    // Helper: Convert CRS to canvas coordinates
    const toCanvas = (c: number, r: number, s: number) => {
      const x = top.x * c + left.x * r + right.x * s;
      const y = top.y * c + left.y * r + right.y * s;
      return { x, y };
    };

    // Draw ternary grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 0.5;
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';

    for (let i = 0; i <= 10; i++) {
      const t = i / 10;

      // C lines
      const c1 = toCanvas(t, 0, 1 - t);
      const c2 = toCanvas(t, 1 - t, 0);
      ctx.beginPath();
      ctx.moveTo(c1.x, c1.y);
      ctx.lineTo(c2.x, c2.y);
      ctx.stroke();

      // R lines
      const r1 = toCanvas(0, t, 1 - t);
      const r2 = toCanvas(1 - t, t, 0);
      ctx.beginPath();
      ctx.moveTo(r1.x, r1.y);
      ctx.lineTo(r2.x, r2.y);
      ctx.stroke();

      // S lines
      const s1 = toCanvas(1 - t, 0, t);
      const s2 = toCanvas(0, 1 - t, t);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
    }

    // Draw triangle outline
    ctx.strokeStyle = G.gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.closePath();
    ctx.stroke();

    // Draw labels
    ctx.fillStyle = G.gold;
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('C', top.x, top.y - 15);
    ctx.textAlign = 'left';
    ctx.fillText('R', left.x - 15, left.y + 5);
    ctx.textAlign = 'right';
    ctx.fillText('S', right.x + 15, right.y + 5);

    // Draw trajectory path
    if (points.length > 1) {
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        const c1 = toCanvas(p1.C, p1.R, p1.S);
        const c2 = toCanvas(p2.C, p2.R, p2.S);

        // Color based on health band
        let color = '#34d399'; // OPTIMAL
        if (p2.health_band === 'ALERT') color = '#fbbf24';
        else if (p2.health_band === 'STRESSED') color = '#f97316';
        else if (p2.health_band === 'CRITICAL') color = '#ef4444';

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // Draw current point (latest)
    if (points.length > 0) {
      const latest = points[points.length - 1];
      const pos = toCanvas(latest.C, latest.R, latest.S);

      // Glow effect
      const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 15);
      gradient.addColorStop(0, 'rgba(201, 168, 76, 0.3)');
      gradient.addColorStop(1, 'rgba(201, 168, 76, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 15, 0, Math.PI * 2);
      ctx.fill();

      // Point
      ctx.fillStyle = G.gold;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = G.gold;
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`M=${latest.M.toFixed(3)}`, pos.x, pos.y - 20);
    }
  }, [points]);

  if (loading) {
    return (
      <div
        className="rounded-xl border flex items-center justify-center"
        style={{
          background: G.surface,
          borderColor: G.border,
          height,
        }}
      >
        <div className="text-center">
          <div className="text-2xl mb-2">⬡</div>
          <span className="text-xs font-mono" style={{ color: G.gold }}>
            Loading trajectory...
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-xl border flex items-center justify-center"
        style={{
          background: G.surface,
          borderColor: G.border,
          height,
        }}
      >
        <div className="text-center">
          <div className="text-xl mb-2">⚠️</div>
          <span className="text-xs font-mono text-red-400">{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: G.border, background: G.surface }}>
      <div className="p-4 border-b" style={{ borderColor: G.border }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-white">Lyapunov Trajectory</h3>
            <p className="text-xs text-gray-400 mt-1">Real-time (C, R, S) state evolution</p>
          </div>
          <button
            onClick={fetchTrajectory}
            className="text-xs px-2 py-1 rounded"
            style={{
              background: 'rgba(201, 168, 76, 0.1)',
              color: G.gold,
              border: `1px solid rgba(201, 168, 76, 0.3)`,
            }}
          >
            ↺
          </button>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: 'Min M', value: stats.min_M.toFixed(3), color: '#ef4444' },
            { label: 'Avg M', value: stats.avg_M.toFixed(3), color: G.gold },
            { label: 'Max M', value: stats.max_M.toFixed(3), color: '#34d399' },
            { label: 'Interventions', value: stats.interventions, color: '#f97316' },
          ].map(stat => (
            <div key={stat.label} className="text-center">
              <div className="text-xs text-gray-400">{stat.label}</div>
              <div className="text-sm font-mono font-bold" style={{ color: stat.color }}>
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={600}
        height={height - 100}
        className="w-full"
        style={{ display: 'block' }}
      />

      {/* Legend */}
      <div className="p-3 border-t grid grid-cols-4 gap-2 text-xs" style={{ borderColor: G.border }}>
        {[
          { label: 'OPTIMAL', color: '#34d399' },
          { label: 'ALERT', color: '#fbbf24' },
          { label: 'STRESSED', color: '#f97316' },
          { label: 'CRITICAL', color: '#ef4444' },
        ].map(item => (
          <div key={item.label} className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: item.color }} />
            <span className="text-gray-400">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
