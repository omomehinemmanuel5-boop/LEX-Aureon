'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useLexStream } from '@/lib/use_lex_stream';
import { buildSessionArc, type ChatTurn } from '@/lib/chat_store';
import {
  getDynamicSuggestions,
  getPromptsByCategory,
  SUGGESTION_CATEGORIES,
  type SuggestionCategory,
} from '@/lib/suggestion_engine';
import DynamicSimplex from '@/components/DynamicSimplex';
import UpgradeModal from '@/components/UpgradeModal';
import EmailCapture from '@/components/EmailCapture';
import { useToast } from '@/components/Toast';
import type { GovernanceResponse } from '@/types/governance-types';

const MAX_CALLS = 10;

const HEALTH: Record<string, { color: string; glow: string; label: string; bg: string }> = {
  OPTIMAL:  { color: '#10b981', glow: '0 0 20px #10b98128', label: 'OPTIMAL',  bg: '#10b98110' },
  ALERT:    { color: '#f59e0b', glow: '0 0 20px #f59e0b28', label: 'ALERT',    bg: '#f59e0b10' },
  STRESSED: { color: '#f97316', glow: '0 0 20px #f9731628', label: 'STRESSED', bg: '#f9731610' },
  CRITICAL: { color: '#ef4444', glow: '0 0 20px #ef444428', label: 'CRITICAL', bg: '#ef444410' },
};

/* ─── CRS minibar ─────────────────────────────────────────────────────── */
function CRSBar({ c, r, s, m }: { c: number; r: number; s: number; m: number }) {
  const total = (c + r + s) || 1;
  const mColor = m < 0.08 ? '#ef4444' : m < 0.15 ? '#f59e0b' : '#10b981';
  return (
    <div className="mt-3 space-y-1.5">
      {[
        { k: 'C', v: c, color: '#3b82f6' },
        { k: 'R', v: r, color: '#10b981' },
        { k: 'S', v: s, color: '#f59e0b' },
      ].map(({ k, v, color }) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-[10px] font-mono w-3 font-bold" style={{ color }}>{k}</span>
          <div className="flex-1 h-[3px] rounded-full" style={{ background: '#0f1629' }}>
            <div className="h-[3px] rounded-full transition-all duration-700 ease-out"
              style={{ width: `${(v / total) * 100}%`, background: color, boxShadow: `0 0 6px ${color}60` }} />
          </div>
          <span className="text-[10px] font-mono w-8 text-right tabular-nums" style={{ color: '#334155' }}>{v.toFixed(2)}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <span className="text-[10px] font-mono w-3 font-bold" style={{ color: '#c9a84c' }}>M</span>
        <div className="flex-1 h-[4px] rounded-full" style={{ background: '#0f1629' }}>
          <div className="h-[4px] rounded-full transition-all duration-700"
            style={{ width: `${m * 100}%`, background: mColor, boxShadow: `0 0 8px ${mColor}80` }} />
        </div>
        <span className="text-[10px] font-mono w-8 text-right tabular-nums font-bold" style={{ color: '#c9a84c' }}>{m.toFixed(3)}</span>
      </div>
    </div>
  );
}

/* ─── Message tab panel ───────────────────────────────────────────────── */
type MsgTab = 'raw' | 'audit' | 'analysis';

function MessageTabPanel({ turn, activeTab, onClose }: {
  turn: ChatTurn; activeTab: MsgTab; onClose: () => void;
}) {
  const res  = turn.complete as GovernanceResponse | null;
  const hcfg = HEALTH[turn.health_band ?? 'OPTIMAL'] ?? HEALTH.OPTIMAL;
  return (
    <div className="mt-2 rounded-xl overflow-hidden text-xs font-mono"
      style={{ background: '#020408', border: '1px solid #0f1629' }}>
      <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: '1px solid #0f1629' }}>
        <span style={{ color: '#1e3a5f', letterSpacing: '0.05em' }}>
          {activeTab === 'raw'      && '// bare output'}
          {activeTab === 'audit'    && '// governance receipt'}
          {activeTab === 'analysis' && '// constitutional state'}
        </span>
        <button onClick={onClose}
          className="w-5 h-5 rounded flex items-center justify-center transition-colors"
          style={{ color: '#334155', background: '#0f1629' }}>✕</button>
      </div>
      <div className="p-3 space-y-2 max-h-52 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {activeTab === 'raw' && (
          <p className="whitespace-pre-wrap leading-relaxed" style={{ color: '#334155' }}>
            {turn.raw_output || '// blocked at pre-eval — no bare output'}
          </p>
        )}
        {activeTab === 'audit' && (
          <div className="space-y-2">
            {[
              { k: 'audit_id',   v: turn.audit_id ?? 'N/A',                     c: '#c9a84c' },
              { k: 'health',     v: turn.health_band ?? 'OPTIMAL',              c: hcfg.color },
              { k: 'M',          v: (turn.M ?? 0).toFixed(4),                   c: hcfg.color },
              { k: 'intervened', v: turn.intervened ? 'YES' : 'NO',             c: turn.intervened ? '#ef4444' : '#22c55e' },
              { k: 'attack',     v: turn.attack_type ?? 'none',                 c: (turn.attack_type && turn.attack_type !== 'none') ? '#f97316' : '#334155' },
              { k: 'severity',   v: turn.attack_severity !== undefined ? turn.attack_severity.toFixed(2) : 'n/a', c: (turn.attack_severity ?? 0) >= 0.7 ? '#ef4444' : '#334155' },
              { k: 'memory',     v: turn.memory_injected ? 'injected' : 'none', c: turn.memory_injected ? '#a855f7' : '#334155' },
            ].map(({ k, v, c }) => (
              <div key={k} className="flex gap-3">
                <span className="w-20 flex-shrink-0" style={{ color: '#1e3a5f' }}>{k}:</span>
                <span style={{ color: c }}>{v}</span>
              </div>
            ))}
          </div>
        )}
        {activeTab === 'analysis' && (
          <div className="space-y-3">
            {turn.C !== undefined && <CRSBar c={turn.C} r={turn.R ?? 0} s={turn.S ?? 0} m={turn.M ?? 0} />}
            {turn.governor && (
              <div className="space-y-1.5 pt-2" style={{ borderTop: '1px solid #0f1629' }}>
                <div style={{ color: '#1e3a5f' }}>// governor</div>
                {[
                  { k: 'decision', v: turn.governor.decision, c: turn.governor.decision === 'INTERVENE' ? '#ef4444' : '#22c55e' },
                  { k: 'δV',       v: `${turn.governor.dV > 0 ? '+' : ''}${turn.governor.dV?.toFixed(5)}`, c: turn.governor.dV < 0 ? '#10b981' : '#ef4444' },
                  { k: 'stable',   v: turn.governor.lyapunov_stable ? '✓ yes' : '⚠ breach', c: turn.governor.lyapunov_stable ? '#10b981' : '#ef4444' },
                ].map(({ k, v, c }) => (
                  <div key={k} className="flex gap-3">
                    <span className="w-20" style={{ color: '#1e3a5f' }}>{k}:</span>
                    <span style={{ color: c }}>{v}</span>
                  </div>
                ))}
              </div>
            )}
            {turn.law && (
              <div className="pt-2" style={{ borderTop: '1px solid #0f1629' }}>
                <div style={{ color: '#1e3a5f' }}>// law invoked</div>
                <div className="mt-1" style={{ color: '#c9a84c' }}>[{turn.law.book}] {turn.law.name}</div>
              </div>
            )}
            {turn.C !== undefined && res && (
              <div className="pt-2">
                <DynamicSimplex
                  liveC={turn.C} liveR={turn.R ?? 0} liveS={turn.S ?? 0} liveM={turn.M ?? 0}
                  intervention={turn.intervened ?? false}
                  healthBand={turn.health_band ?? 'OPTIMAL'}
                  animating={false}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Message bubble ──────────────────────────────────────────────────── */
function MessageBubble({ turn, isLatest, streaming, partialOutput, openTab, onOpenTab }: {
  turn: ChatTurn; isLatest: boolean; streaming: boolean;
  partialOutput: string; openTab: MsgTab | null; onOpenTab: (tab: MsgTab | null) => void;
}) {
  const hcfg   = HEALTH[turn.health_band ?? 'OPTIMAL'] ?? HEALTH.OPTIMAL;
  const isUser = turn.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end px-3">
        <div className="max-w-[80vw] sm:max-w-md px-4 py-3 rounded-2xl rounded-tr-md text-sm leading-relaxed"
          style={{
            background: 'linear-gradient(135deg, #0d1b35 0%, #0a1528 100%)',
            border: '1px solid #1a2d52',
            color: '#94a3b8',
          }}>
          {turn.content}
        </div>
      </div>
    );
  }

  const isCurrentlyStreaming = isLatest && streaming;
  const displayText = isCurrentlyStreaming ? partialOutput : (turn.governed_output ?? turn.partial ?? '');

  return (
    <div className="flex justify-start px-3">
      <div className="w-full max-w-[88vw] sm:max-w-xl">
        {/* Avatar row */}
        <div className="flex items-center gap-2 mb-1.5 ml-1">
          <div className="w-5 h-5 rounded-md flex items-center justify-center text-[10px]"
            style={{ background: '#c9a84c18', border: '1px solid #c9a84c30', color: '#c9a84c' }}>⬡</div>
          <span className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: '#c9a84c' }}>Lex Aureon</span>

          <div className="flex items-center gap-1 overflow-hidden">
            {turn.health_band && turn.health_band !== 'OPTIMAL' && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ color: hcfg.color, background: hcfg.bg, border: `1px solid ${hcfg.color}25` }}>
                {hcfg.label}
              </span>
            )}
            {turn.intervened && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ color: '#ef4444', background: '#ef444410', border: '1px solid #ef444425' }}>
                ⚡ corrected
              </span>
            )}
            {turn.memory_injected && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ color: '#a855f7', background: '#a855f710', border: '1px solid #a855f725' }}>
                🧠 mem
              </span>
            )}
            {turn.attack_type && turn.attack_type !== 'none' && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full flex-shrink-0"
                style={{ color: '#f97316', background: '#f9731610', border: '1px solid #f9731625' }}>
                🛡 {turn.attack_type}
              </span>
            )}
            {isCurrentlyStreaming && (
              <span className="text-[9px] font-mono animate-pulse ml-1 flex-shrink-0" style={{ color: '#c9a84c' }}>●</span>
            )}
          </div>
        </div>

        {/* Bubble */}
        <div className="px-4 py-3.5 rounded-2xl rounded-tl-md text-sm leading-relaxed"
          style={{
            background: '#07080f',
            border: `1px solid ${isCurrentlyStreaming ? hcfg.color + '50' : '#0f1629'}`,
            borderLeftWidth: 2,
            borderLeftColor: hcfg.color,
            boxShadow: isCurrentlyStreaming ? hcfg.glow : 'none',
            transition: 'border-color 0.4s, box-shadow 0.4s',
          }}>

          <div style={{ color: turn.intervened ? '#fcd34d' : '#86efac', lineHeight: 1.7 }}
            className="whitespace-pre-wrap">
            {displayText}
            {isCurrentlyStreaming && (
              <span className="inline-block w-[2px] h-[14px] align-text-bottom ml-0.5 rounded-[1px]"
                style={{ background: '#c9a84c', animation: 'term-blink 0.8s step-end infinite' }} />
            )}
            {!displayText && !isCurrentlyStreaming && turn.error && (
              <span style={{ color: '#ef4444' }}>{turn.error}</span>
            )}
          </div>

          {!isCurrentlyStreaming && turn.C !== undefined && (
            <CRSBar c={turn.C} r={turn.R ?? 0} s={turn.S ?? 0} m={turn.M ?? 0} />
          )}

          {!isCurrentlyStreaming && turn.governed_output && (
            <div className="flex items-center gap-1 mt-3 pt-2.5" style={{ borderTop: '1px solid #0f1629' }}>
              {(['raw', 'audit', 'analysis'] as MsgTab[]).map(t => (
                <button key={t} onClick={() => onOpenTab(openTab === t ? null : t)}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all active:scale-95"
                  style={{
                    color: openTab === t ? '#c9a84c' : '#334155',
                    background: openTab === t ? '#c9a84c12' : 'transparent',
                    border: `1px solid ${openTab === t ? '#c9a84c30' : '#0f1629'}`,
                  }}>{t}</button>
              ))}
            </div>
          )}
        </div>

        {openTab && !isCurrentlyStreaming && turn.governed_output && (
          <MessageTabPanel turn={turn} activeTab={openTab} onClose={() => onOpenTab(null)} />
        )}
      </div>
    </div>
  );
}

/* ─── Suggestion bar ──────────────────────────────────────────────────── */
function SuggestionBar({ turns, activeCategory, onCategoryChange, onSelect, disabled }: {
  turns: ChatTurn[]; activeCategory: SuggestionCategory;
  onCategoryChange: (c: SuggestionCategory) => void;
  onSelect: (prompt: string) => void; disabled: boolean;
}) {
  const suggestions = useMemo(
    () => activeCategory === 'all'
      ? getDynamicSuggestions(turns, 'all', 3)
      : getPromptsByCategory(activeCategory).slice(0, 4),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [turns.length, activeCategory],
  );

  const dotColor: Record<string, string> = {
    jailbreak: '#ef4444', sycophancy: '#10b981', identity: '#3b82f6',
    'slow-drip': '#f59e0b', probe: '#a855f7', attack: '#f97316', baseline: '#475569',
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {SUGGESTION_CATEGORIES.map(cat => (
          <button key={cat.key} onClick={() => onCategoryChange(cat.key)}
            className="flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-mono tracking-wide transition-all active:scale-95"
            style={{
              color: activeCategory === cat.key ? '#07070d' : '#334155',
              background: activeCategory === cat.key ? '#c9a84c' : '#07080f',
              border: `1px solid ${activeCategory === cat.key ? '#c9a84c' : '#0f1629'}`,
            }}>{cat.label}</button>
        ))}
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {suggestions.map((s, i) => (
          <button key={i} onClick={() => !disabled && onSelect(s.prompt)} disabled={disabled}
            title={s.prompt}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono
              transition-all disabled:opacity-30 active:scale-95"
            style={{
              color: '#475569', background: '#07080f',
              border: '1px solid #0f1629',
              maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
            <span style={{ color: dotColor[s.category] ?? '#475569', fontSize: 8 }}>●</span>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Empty state ─────────────────────────────────────────────────────── */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-6 py-16">
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl"
          style={{
            background: 'linear-gradient(135deg, #c9a84c18 0%, #c9a84c08 100%)',
            border: '1px solid #c9a84c25',
            boxShadow: '0 0 40px #c9a84c0a',
          }}>⬡</div>
        <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full"
          style={{ background: '#10b981', boxShadow: '0 0 8px #10b981', animation: 'term-blink 2s ease-in-out infinite' }} />
      </div>

      <div className="space-y-1">
        <p className="text-base font-mono font-bold tracking-widest uppercase" style={{ color: '#c9a84c' }}>
          Sovereign Console
        </p>
        <p className="text-xs font-mono" style={{ color: '#1e3a5f' }}>
          Constitutional governance · continuous context · never drifts
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 w-full max-w-xs text-left">
        {[
          { icon: '⬡', label: 'C·R·S state', desc: 'carries forward every turn' },
          { icon: '⚓', label: 'Lyapunov anchored', desc: 'mathematically stable' },
          { icon: '🛡', label: 'Governor active', desc: 'try a jailbreak — watch it hold' },
        ].map(({ icon, label, desc }) => (
          <div key={label} className="flex items-start gap-3 px-3 py-2.5 rounded-xl"
            style={{ background: '#07080f', border: '1px solid #0f1629' }}>
            <span className="text-base mt-0.5">{icon}</span>
            <div>
              <p className="text-[11px] font-mono font-bold" style={{ color: '#475569' }}>{label}</p>
              <p className="text-[10px] font-mono" style={{ color: '#1e3a5f' }}>{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────────── */
export default function ChatConsole() {
  const [turns, setTurns]               = useState<ChatTurn[]>([]);
  const [input, setInput]               = useState('');
  const [apiCalls, setApiCalls]         = useState(0);
  const [showUpgrade, setShowUpgrade]   = useState(false);
  const [showEmail, setShowEmail]       = useState(false);
  const [suggCat, setSuggCat]           = useState<SuggestionCategory>('all');
  const [openTabs, setOpenTabs]         = useState<Record<string, MsgTab | null>>({});
  const [currentLexId, setCurrentLexId] = useState<string | null>(null);
  const [liveM, setLiveM]               = useState<number | null>(null);
  const [liveHealth, setLiveHealth]     = useState<string>('OPTIMAL');
  const [inputFocused, setInputFocused] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const toast     = useToast();
  const { state: stream, run: runStream, cancel } = useLexStream();

  const [sessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'chat_console';
    const k = 'lex_chat_session_id';
    const s = localStorage.getItem(k);
    if (s) return s;
    const id = `chat_${crypto.randomUUID()}`;
    localStorage.setItem(k, id);
    return id;
  });

  useEffect(() => {
    const s = localStorage.getItem('lex_api_calls');
    if (s) setApiCalls(parseInt(s, 10));
  }, []);

  useEffect(() => {
    localStorage.setItem('lex_api_calls', apiCalls.toString());
  }, [apiCalls]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, stream.partialOutput]);

  useEffect(() => {
    if (!stream.metrics) return;
    setLiveM(stream.metrics.m ?? null);
    setLiveHealth(stream.metrics.health_band ?? stream.metrics.health ?? 'OPTIMAL');
  }, [stream.metrics]);

  useEffect(() => {
    if (stream.stage !== 'complete' || !stream.complete || !currentLexId) return;
    const res = stream.complete as GovernanceResponse;
    const kx  = res as unknown as Record<string, unknown>;
    const M   = Number(kx.M ?? res.metrics?.m ?? 0);
    const health = String(kx.health_band ?? 'OPTIMAL');
    const C   = Number((kx.state as Record<string, number>)?.C ?? res.metrics?.c ?? 0);
    const R   = Number((kx.state as Record<string, number>)?.R ?? res.metrics?.r ?? 0);
    const S   = Number((kx.state as Record<string, number>)?.S ?? res.metrics?.s ?? 0);
    const sig = (kx.semantic_signal as { attack_type?: string; severity?: number }) ?? {};

    setTurns(prev => prev.map(t =>
      t.id === currentLexId ? {
        ...t, streaming: false,
        governed_output: res.governed_output, raw_output: res.raw_output, audit_id: res.audit_id,
        M, health_band: health, C, R, S,
        delta_V: Number(kx.delta_V ?? 0),
        attack_type: sig.attack_type ?? 'none',
        attack_severity: typeof sig.severity === 'number' ? sig.severity : undefined,
        intervened: !!(res.intervention?.triggered || res.intervention?.applied),
        projection_triggered: Boolean(kx.projection_triggered),
        memory_injected: Boolean(kx.memory_injected),
        law: stream.law ?? null,
        governor: stream.governor ?? null,
        complete: res,
      } : t,
    ));
    setLiveM(M);
    setLiveHealth(health);
    setApiCalls(c => c + 1);
    setCurrentLexId(null);
    toast.push('Run complete', 'success');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.stage, stream.complete]);

  useEffect(() => {
    if (!stream.error || !currentLexId) return;
    setTurns(prev => prev.map(t =>
      t.id === currentLexId ? { ...t, streaming: false, error: stream.error ?? 'Error' } : t,
    ));
    setCurrentLexId(null);
    toast.push(stream.error, 'error');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.error]);

  const sendMessage = useCallback(async (promptOverride?: string) => {
    const p = (promptOverride ?? input).trim();
    if (!p || stream.loading) return;
    if (apiCalls >= MAX_CALLS) { setShowUpgrade(true); return; }
    if (typeof window !== 'undefined' && !localStorage.getItem('lex_email_captured') && apiCalls === 0) {
      setShowEmail(true); return;
    }

    const userId = `u_${Date.now()}`;
    const lexId  = `l_${Date.now()}`;

    setTurns(prev => [
      ...prev,
      { id: userId, role: 'user', content: p, timestamp: Date.now() },
      { id: lexId,  role: 'lex',  content: '', timestamp: Date.now(), streaming: true, partial: '' },
    ]);
    setCurrentLexId(lexId);
    setInput('');

    if (inputRef.current) inputRef.current.style.height = 'auto';

    await runStream(p, sessionId);
  }, [input, stream.loading, apiCalls, runStream, sessionId]);

  const hcfg      = HEALTH[liveHealth] ?? HEALTH.OPTIMAL;
  const isStreaming = stream.loading;
  const arc        = useMemo(() => buildSessionArc(turns), [turns]);
  const callsLeft  = MAX_CALLS - apiCalls;

  return (
    <>
      <style>{`
        @keyframes term-blink { 0%,100%{opacity:1} 50%{opacity:0} }
        ::-webkit-scrollbar { display: none; }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>

      <div className="h-[100dvh] flex flex-col overflow-hidden"
        style={{
          background: '#04060e',
          fontFamily: "'JetBrains Mono','SF Mono','Fira Code',ui-monospace,monospace",
        }}>

        {/* ── Header ──────────────────────────────────────────────── */}
        <header className="flex-shrink-0 flex items-center justify-between h-12 px-4 z-40"
          style={{ background: '#06070f', borderBottom: '1px solid #0d1220' }}>

          <div className="flex items-center gap-3">
            <Link href="/"
              className="flex items-center justify-center w-7 h-7 rounded-lg transition-all active:scale-90"
              style={{ color: '#334155', background: '#0a0d18', border: '1px solid #0f1629' }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M7 2L3 5L7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold tracking-[0.15em] uppercase" style={{ color: '#c9a84c' }}>
                Lex Aureon
              </span>
              <span className="hidden sm:block text-[10px] font-mono" style={{ color: '#1e3a5f' }}>
                · Sovereign Console
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {liveM !== null && (
              <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-mono"
                style={{
                  color: hcfg.color, background: hcfg.bg,
                  border: `1px solid ${hcfg.color}20`,
                  boxShadow: isStreaming ? hcfg.glow : 'none',
                  transition: 'all 0.4s',
                }}>
                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: hcfg.color, animation: isStreaming ? 'term-blink 1s step-end infinite' : 'none' }} />
                M={liveM.toFixed(3)}
              </div>
            )}
            <span className="text-[10px] font-mono" style={{ color: callsLeft <= 3 ? '#f59e0b' : '#1e3a5f' }}>
              {callsLeft}/{MAX_CALLS}
            </span>
            <button onClick={() => setShowUpgrade(true)}
              className="text-[10px] px-2.5 py-1 rounded-lg font-mono transition-all active:scale-95"
              style={{ color: '#c9a84c', background: '#c9a84c0a', border: '1px solid #c9a84c25' }}>
              pro
            </button>
          </div>
        </header>

        {/* ── Thread ──────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto py-4 space-y-4" style={{ scrollbarWidth: 'none' }}>
          {!turns.length
            ? <EmptyState />
            : turns.map(turn => (
              <MessageBubble key={turn.id} turn={turn}
                isLatest={turn.id === currentLexId}
                streaming={isStreaming && turn.id === currentLexId}
                partialOutput={stream.partialOutput}
                openTab={openTabs[turn.id] ?? null}
                onOpenTab={tab => setOpenTabs(prev => ({ ...prev, [turn.id]: tab }))} />
            ))
          }
          <div ref={bottomRef} className="h-2" />
        </main>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <footer className="flex-shrink-0 px-3 pt-2 space-y-2"
          style={{
            background: '#06070f',
            borderTop: '1px solid #0d1220',
            paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          }}>

          {!isStreaming && (
            <SuggestionBar
              turns={turns} activeCategory={suggCat}
              onCategoryChange={setSuggCat}
              onSelect={p => { setInput(p); inputRef.current?.focus(); }}
              disabled={isStreaming}
            />
          )}

          <div className="flex items-end gap-2">
            <div className="flex-1 relative rounded-2xl transition-all duration-300"
              style={{
                background: '#07080f',
                border: `1px solid ${inputFocused ? '#c9a84c30' : '#0f1629'}`,
                boxShadow: inputFocused ? '0 0 0 3px #c9a84c08' : 'none',
              }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value.slice(0, 2000))}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && input.trim() && !isStreaming) {
                    e.preventDefault(); sendMessage();
                  }
                }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                }}
                placeholder="Message Lex Aureon…"
                rows={1}
                disabled={isStreaming}
                className="w-full bg-transparent px-4 py-3 text-sm resize-none focus:outline-none leading-relaxed disabled:opacity-50"
                style={{ color: '#94a3b8', caretColor: '#c9a84c', fontFamily: 'inherit', maxHeight: '120px' }}
              />
            </div>

            {isStreaming ? (
              <button onClick={cancel}
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90"
                style={{ background: '#1a0505', border: '1px solid #7f1d1d', color: '#f87171' }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <rect width="10" height="10" rx="1.5"/>
                </svg>
              </button>
            ) : (
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || apiCalls >= MAX_CALLS}
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-25"
                style={{
                  background: input.trim() && apiCalls < MAX_CALLS
                    ? 'linear-gradient(135deg, #c9a84c 0%, #e8c96d 100%)'
                    : '#07080f',
                  border: `1px solid ${input.trim() && apiCalls < MAX_CALLS ? '#c9a84c' : '#0f1629'}`,
                  color: input.trim() && apiCalls < MAX_CALLS ? '#07070d' : '#334155',
                  boxShadow: input.trim() ? '0 0 16px #c9a84c30' : 'none',
                }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 12V2M3 6L7 2L11 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>

          {arc.interventionCount > 0 && (
            <p className="text-[10px] font-mono text-center pb-1" style={{ color: '#7c2d12' }}>
              ⚡ {arc.interventionCount} constitutional correction{arc.interventionCount > 1 ? 's' : ''} this session
            </p>
          )}
        </footer>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} callsUsed={apiCalls} />}
      {showEmail   && <EmailCapture onComplete={() => { setShowEmail(false); setTimeout(() => sendMessage(), 100); }} />}
    </>
  );
}
