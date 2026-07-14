'use client';

import { useEffect, useState } from 'react';

interface AuditEvent {
  id: string;
  message: string;
  m_before: number;
  m_after: number;
  health: string;
  age: number;
  intervention: boolean;
  c_after?: number;
  r_after?: number;
  s_after?: number;
  metrics_version?: string;
}

const TYPE_CONFIG = {
  clean:        { dot: 'bg-emerald-400', label: 'PASS',         labelColor: 'text-emerald-400 bg-emerald-900/20' },
  intervention: { dot: 'bg-amber-400',   label: 'GOVERNED',     labelColor: 'text-amber-400 bg-amber-900/20' },
  critical:     { dot: 'bg-red-500 animate-pulse', label: 'CRITICAL', labelColor: 'text-red-400 bg-red-950/40' },
};

function ageSeconds(ts: number): number {
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

function formatAge(s: number) {
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

export default function LiveAuditFeed() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [count, setCount] = useState(0);

  useEffect(() => {
    // fix (2026-07-13) — READ EXHAUSTION: same pattern found across six
    // components (see HeroTicker.tsx's fix note for the full diagnosis).
    // no-store on BOTH calls here bypassed /api/audits/recent's 30s cache
    // and /api/stats's 300s cache, at a 5s poll interval — forcing two fresh
    // Turso reads every tick. Interval matched to the faster of the two
    // real cache windows (30s); polling faster never bought real freshness.
    const load = async () => {
      try {
        const [auditsRes, statsRes] = await Promise.all([
          fetch('/api/audits/recent?limit=8'),
          fetch('/api/stats'),
        ]);
        if (statsRes.ok) {
          const stats = await statsRes.json() as { runs?: number };
          if (typeof stats.runs === 'number') setCount(stats.runs);
        }

        if (!auditsRes.ok) return;
        const data = await auditsRes.json() as { receipts?: Array<{ id: string; timestamp: number; m_before: number; m_after: number; health_band?: string; intervention: boolean; reason?: string; c_after?: number; r_after?: number; s_after?: number; metrics_version?: string }> };

        const mapped = (data.receipts ?? []).map((a) => ({
          id: a.id,
          message: a.reason && a.reason.trim().length ? a.reason : (a.intervention ? 'Governor intervention applied' : 'Constitutional pass'),
          m_before: a.m_before,
          m_after: a.m_after,
          health: a.health_band ?? 'UNKNOWN',
          age: ageSeconds(a.timestamp),
          intervention: a.intervention,
          c_after: a.c_after,
          r_after: a.r_after,
          s_after: a.s_after,
          metrics_version: a.metrics_version,
        }));

        setEvents(mapped);
      } catch {
        // Keep previous state
      }
    };

    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="bg-[#0a0a0f] border border-white/6 rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"/>
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">Live Audit Feed</span>
          <span className="text-xs text-slate-500 dark:text-slate-500 font-mono font-bold">— real governance stream</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 dark:text-slate-500 font-mono font-bold">{count.toLocaleString()} total runs</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-900/20 border border-emerald-800/40 text-emerald-400 font-mono">LIVE</span>
        </div>
      </div>

      <div className="divide-y divide-white/4 max-h-72 overflow-hidden">
        {events.length === 0 && (
          <div className="px-4 py-6 text-xs text-slate-500 font-mono">No audit events yet. Run the console to generate real receipts.</div>
        )}
        {events.map((event, i) => {
          const type = event.intervention ? (event.m_after < 0.12 ? 'critical' : 'intervention') : 'clean';
          const cfg = TYPE_CONFIG[type];
          const improved = event.m_after > event.m_before;
          return (
            <div key={event.id} className={`flex items-start gap-3 px-4 py-3 ${i === 0 ? 'bg-white/[0.02]' : ''}`} style={{ opacity: Math.max(0.3, 1 - i * 0.09) }}>
              <div className="flex-shrink-0 mt-0.5"><span className={`w-2 h-2 rounded-full inline-block ${cfg.dot}`}/></div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-mono font-semibold ${cfg.labelColor}`}>{cfg.label}</span>
                  <span className="text-xs text-slate-400 truncate">{event.message}</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-mono text-slate-600 truncate">{event.id}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono text-red-400">M:{(event.m_before * 100).toFixed(0)}%</span>
                    {improved && <span className="text-xs text-slate-600">→</span>}
                    {improved && <span className="text-xs font-mono text-emerald-400">M:{(event.m_after * 100).toFixed(0)}%</span>}
                  </div>
                  <span className="text-xs font-mono text-amber-400">{event.health}</span>
                  {event.c_after !== undefined && event.r_after !== undefined && event.s_after !== undefined && (
                    <span className="text-xs font-mono text-slate-500">C:{event.c_after.toFixed(2)} R:{event.r_after.toFixed(2)} S:{event.s_after.toFixed(2)}</span>
                  )}
                </div>
              </div>
              <div className="flex-shrink-0 text-xs text-slate-500 dark:text-slate-500 font-mono font-bold whitespace-nowrap">{formatAge(event.age)}</div>
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2.5 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
        <span className="text-xs text-slate-500 dark:text-slate-500 font-mono font-bold">Every event carries a SHA-256 audit receipt{events[0]?.metrics_version ? ` · ${events[0].metrics_version}` : ''}</span>
        <a href="/console" className="text-xs text-blue-400 hover:text-blue-300 transition-colors font-medium">Try it yourself →</a>
      </div>
    </div>
  );
}
