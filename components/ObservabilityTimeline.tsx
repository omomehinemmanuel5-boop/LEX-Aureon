'use client';

    import { useCallback, useEffect, useRef, useState } from 'react';
    import TimelineReplayControls from './TimelineReplayControls';

    type TimelineEvent = { id: string; turn: number; m_before: number; m_after: number; governor_mode: string; intervention: boolean; created_at: string };

    type Props = { sessionId: string; mode: 'idle' | 'auto'; onModeChange: (mode: 'idle' | 'auto') => void };

    export default function ObservabilityTimeline({ sessionId, mode, onModeChange }: Props) {
    const [events, setEvents] = useState<TimelineEvent[]>([]);
    const [cursor, setCursor] = useState(-1);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const replayTimer = useRef<ReturnType<typeof setInterval> | null>(null);

    const load = useCallback(async () => {
      if (!sessionId.trim()) { setEvents([]); setCursor(-1); return; }
      setLoading(true); setError(false);
      try {
        const response = await fetch('/api/observability/timeline?session_id=' + encodeURIComponent(sessionId.trim()));
        if (!response.ok) throw new Error('timeline request failed');
        const data = await response.json() as { events?: TimelineEvent[] };
        setEvents(data.events ?? []); setCursor(data.events?.length ? 0 : -1);
      } catch { setError(true); setEvents([]); setCursor(-1); }
      finally { setLoading(false); }
    }, [sessionId]);

    useEffect(() => { load(); return () => { if (replayTimer.current) clearInterval(replayTimer.current); }; }, [load]);
    useEffect(() => {
      if (mode !== 'auto' || events.length < 2) return;
      replayTimer.current = setInterval(() => setCursor(current => current >= events.length - 1 ? 0 : current + 1), 800);
      return () => { if (replayTimer.current) { clearInterval(replayTimer.current); replayTimer.current = null; } };
    }, [mode, events.length]);

    const current = cursor >= 0 ? events[cursor] : null;
    const disabledReason = !sessionId.trim() ? 'Enter a session ID to load persisted turns' : loading ? 'Loading timeline data' : error ? 'Timeline data is unavailable' : 'No persisted turns for this session';
    // fix (2026-08-22): Replay now genuinely differs from the Auto-play
    // toggle -- resets to the first turn, then starts auto-play. Previously
    // (mode: 'live'|'pause') onReplay just called onModeChange('pause'),
    // identical to clicking the toggle itself, with no reset.
    return <section className="space-y-3">
      <TimelineReplayControls mode={mode} onModeChange={onModeChange} canStep={events.length > 0 && !loading} canReplay={events.length > 1 && !loading} onStep={() => setCursor(i => i >= events.length - 1 ? 0 : i + 1)} onReplay={() => { setCursor(0); onModeChange('auto'); }} disabledReason={disabledReason} />
      <div className="rounded-xl border p-4 bg-background/60 text-sm">
        {loading && <span className="opacity-70">Loading persisted timeline…</span>}
        {!loading && error && <span className="text-amber-500">Timeline data is temporarily unavailable.</span>}
        {!loading && !error && !sessionId.trim() && <span className="opacity-70">Enter a session ID above to load real governance turns.</span>}
        {!loading && !error && sessionId.trim() && !events.length && <span className="opacity-70">No persisted turns found for this session.</span>}
        {current && <span>Turn {current.turn}: M {current.m_before.toFixed(3)} → {current.m_after.toFixed(3)} · {current.governor_mode}{current.intervention ? ' · intervention' : ''}</span>}
      </div>
    </section>;
    }
    