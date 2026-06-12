'use client';

import { useEffect, useState, useCallback } from 'react';

interface Receipt {
  id: string;
  session_id: string;
  turn: number;
  pre_eval_label: string;
  m_before: number;
  m_after: number;
  governor_mode: string;
  intervention: boolean;
  slow_drip: boolean;
  governor_effort: number;
  sigma_viol: number;
  timestamp: number;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function SkeletonCard() {
  return (
    <div className="px-4 py-3 animate-pulse">
      <div className="flex items-center gap-2 mb-2">
        <div className="h-4 w-12 rounded bg-slate-800" />
        <div className="h-4 w-24 rounded bg-slate-800" />
      </div>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="h-2 w-10 rounded bg-slate-800" />
        <div className="flex-1 h-1.5 rounded-full bg-slate-800" />
      </div>
      <div className="h-3 w-32 rounded bg-slate-800" />
    </div>
  );
}

export default function GovernanceFeed() {
  const [events, setEvents] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newestId, setNewestId] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch('/api/audits/recent?limit=8', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as { receipts?: Receipt[] };
      const receipts = data.receipts ?? [];
      if (receipts.length > 0) {
        setNewestId(prev => {
          const freshId = receipts[0]?.id ?? null;
          return prev !== freshId ? freshId : prev;
        });
        setEvents(receipts);
      }
    } catch {
      // silently fail — keep existing events
    } finally {
      setLoading(false);
      if (manual) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 dark:bg-[#0a0a0f] overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
          <span className="text-xs font-semibold text-slate-500">Live Governance Feed</span>
        </div>
        <div className="divide-y divide-white/5">
          {[0, 1, 2].map(i => <SkeletonCard key={i} />)}
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 dark:bg-[#0a0a0f] p-10 flex flex-col items-center gap-4">
        <div className="flex items-center gap-1.5">
          {[0, 300, 600].map((delay, i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full bg-slate-700 animate-pulse"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
        <div className="text-center">
          <p className="text-sm text-slate-400 font-mono mb-1">No governance events yet</p>
          <p className="text-xs text-slate-600 font-mono">
            Run a prompt in the Console to generate your first receipt
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/console"
            className="text-xs font-bold px-4 py-2 rounded-lg transition-all hover:opacity-80 font-mono"
            style={{ background: '#c9a84c', color: '#07070d' }}
          >
            ⚡ Open Console →
          </a>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="text-xs px-3 py-2 rounded-lg border font-mono transition-all hover:opacity-80 disabled:opacity-40"
            style={{ borderColor: 'rgba(255,255,255,0.1)', color: '#64748b' }}
          >
            {refreshing ? '↻ ...' : '↻ Refresh'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 dark:bg-[#0a0a0f] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">Live Governance Feed</span>
          <span className="text-xs text-slate-500 dark:text-slate-600 font-mono">— real events</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="text-xs px-2 py-0.5 rounded font-mono border border-black/10 dark:border-white/10 transition-all hover:opacity-80 disabled:opacity-40"
            style={{ color: '#64748b' }}
            title="Refresh feed"
          >
            {refreshing ? '↻ ...' : '↻'}
          </button>
          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 dark:bg-emerald-900/20 border border-emerald-500/20 dark:border-emerald-800/40 text-emerald-600 dark:text-emerald-400 font-mono">
            LIVE
          </span>
        </div>
      </div>

      {/* Events */}
      <div className="divide-y divide-black/5 dark:divide-white/5 max-h-80 overflow-hidden">
        {events.map((event, i) => {
          const preEval = event.pre_eval_label || (event.intervention || event.m_before < 0.1 ? 'HIGH' : 'CLEAR');
          const M = event.m_after;
          const mColor = M > 0.15 ? '#22c55e' : M > 0.05 ? '#f59e0b' : '#ef4444';
          const mPct = Math.min(100, Math.round(M * 100));
          const isNewest = i === 0 && event.id === newestId;

          return (
            <a
              key={event.id}
              href={`/audit/${event.id}`}
              className="block px-4 py-3 transition-all duration-500 hover:bg-black/5 dark:hover:bg-white/[0.02] cursor-pointer"
              style={{
                opacity: Math.max(0.3, 1 - i * 0.09),
                background: isNewest ? 'rgba(0,0,0,0.03)' : undefined,
                textDecoration: 'none',
              }}
            >
              {/* Badges row */}
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${
                    preEval === 'HIGH'
                      ? 'text-red-600 dark:text-red-400 bg-red-500/10 dark:bg-red-900/20 border border-red-500/20 dark:border-red-800/40'
                      : 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-900/20 border border-emerald-500/20 dark:border-emerald-800/40'
                  }`}
                >
                  {preEval}
                </span>
                {event.intervention && (
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono text-amber-600 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-900/20 border border-amber-500/20 dark:border-amber-800/40">
                    INTERVENED
                  </span>
                )}
                {event.slow_drip && (
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono text-orange-600 dark:text-orange-400 bg-orange-500/10 dark:bg-orange-900/20 border border-orange-500/20 dark:border-orange-800/40">
                    ⚠ SLOW-DRIP
                  </span>
                )}
              </div>

              {/* M score bar */}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-xs font-mono flex-shrink-0" style={{ color: mColor, width: 42 }}>
                  M={mPct}%
                </span>
                <div className="flex-1 h-1.5 bg-black/10 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${mPct}%`, background: mColor }}
                  />
                </div>
              </div>

              {/* Receipt ID + timestamp */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono truncate" style={{ color: '#c9a84c', maxWidth: 130 }}>
                  {event.id.length > 14 ? `${event.id.slice(0, 14)}…` : event.id}
                </span>
                <span className="text-[10px] font-mono text-slate-500 dark:text-slate-700">{timeAgo(event.timestamp)}</span>
              </div>
            </a>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-black/5 dark:border-white/5 flex items-center justify-between">
        <span className="text-[10px] text-slate-500 dark:text-slate-700 font-mono">SHA-256 audit receipts · every run</span>
        <a href="/console" className="text-xs text-blue-600 dark:text-blue-400 hover:opacity-80 transition-colors font-medium">
          Try it →
        </a>
      </div>
    </div>
  );
}
