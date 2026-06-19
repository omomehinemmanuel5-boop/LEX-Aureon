'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useLexStream } from '@/lib/use_lex_stream';
import { buildMemoryContext, buildSessionArc, type ChatTurn } from '@/lib/chat_store';
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
import { isRefusal } from '@/lib/refusals';
import type { GovernanceResponse } from '@/types/governance-types';

const MAX_CALLS = 10;

/* ── Health band config ──────────────────────────────────────── */
const HEALTH: Record<string, { color: string; glow: string; label: string }> = {
  OPTIMAL:  { color: '#10b981', glow: '0 0 12px #10b98140', label: 'OPTIMAL'  },
  ALERT:    { color: '#f59e0b', glow: '0 0 12px #f59e0b40', label: 'ALERT'    },
  STRESSED: { color: '#f97316', glow: '0 0 12px #f9731640', label: 'STRESSED' },
  CRITICAL: { color: '#ef4444', glow: '0 0 12px #ef444440', label: 'CRITICAL' },
};

/* ── CRS mini bar (inline in message bubble) ─────────────────── */
function CRSBar({ c, r, s, m }: { c: number; r: number; s: number; m: number }) {
  const total = (c + r + s) || 1;
  return (
    <div className="mt-2 space-y-1">
      {[
        { k: 'C', v: c, color: '#3b82f6' },
        { k: 'R', v: r, color: '#10b981' },
        { k: 'S', v: s, color: '#f59e0b' },
      ].map(({ k, v, color }) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-xs font-mono w-3" style={{ color }}>{k}</span>
          <div className="flex-1 h-1 rounded-full" style={{ background: '#1a2040' }}>
            <div
              className="h-1 rounded-full transition-all duration-500"
              style={{ width: `${(v / total) * 100}%`, background: color }}
            />
          </div>
          <span className="text-xs font-mono w-10 text-right" style={{ color: '#475569' }}>
            {v.toFixed(2)}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-0.5">
        <span className="text-xs font-mono w-3" style={{ color: '#c9a84c' }}>M</span>
        <div className="flex-1 h-1.5 rounded-full" style={{ background: '#1a2040' }}>
          <div
            className="h-1.5 rounded-full transition-all duration-700"
            style={{
              width: `${m * 100}%`,
              background: m < 0.08 ? '#ef4444' : m < 0.15 ? '#f59e0b' : '#10b981',
            }}
          />
        </div>
        <span className="text-xs font-mono w-10 text-right" style={{ color: '#c9a84c' }}>
          {m.toFixed(3)}
        </span>
      </div>
    </div>
  );
}

/* ── Per-message inline tab panel ─────────────────────────────── */
type MsgTab = 'raw' | 'audit' | 'analysis';

function MessageTabPanel({
  turn,
  activeTab,
  onClose,
}: {
  turn: ChatTurn;
  activeTab: MsgTab;
  onClose: () => void;
}) {
  const res = turn.complete as GovernanceResponse | null;
  const hcfg = HEALTH[turn.health_band ?? 'OPTIMAL'] ?? HEALTH.OPTIMAL;

  return (
    <div
      className="mt-2 rounded-lg overflow-hidden text-xs font-mono"
      style={{ background: '#020408', border: '1px solid #1a2040' }}
    >
      {/* Close */}
      <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: '#1a2040' }}>
        <span style={{ color: '#475569' }}>
          {activeTab === 'raw' && '// bare LLM output'}
          {activeTab === 'audit' && '// governance receipt'}
          {activeTab === 'analysis' && '// constitutional analysis'}
        </span>
        <button onClick={onClose} style={{ color: '#475569' }} className="hover:text-white transition-colors">✕</button>
      </div>

      <div className="p-3 space-y-2 max-h-56 overflow-y-auto">
        {activeTab === 'raw' && (
          <div className="whitespace-pre-wrap leading-relaxed" style={{ color: '#64748b' }}>
            {turn.raw_output || '[no bare output — prompt was blocked at pre-eval]'}
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="space-y-2">
            {[
              { k: 'audit_id',    v: turn.audit_id ?? 'N/A',                    c: '#c9a84c' },
              { k: 'health_band', v: turn.health_band ?? 'OPTIMAL',             c: hcfg.color },
              { k: 'M',           v: (turn.M ?? 0).toFixed(4),                  c: hcfg.color },
              { k: 'intervened',  v: turn.intervened ? 'YES' : 'NO',            c: turn.intervened ? '#ef4444' : '#22c55e' },
              { k: 'attack',      v: turn.attack_type ?? 'none',                c: turn.attack_type && turn.attack_type !== 'none' ? '#f97316' : '#475569' },
              { k: 'memory',      v: turn.memory_injected ? 'injected' : 'none', c: turn.memory_injected ? '#a855f7' : '#475569' },
            ].map(({ k, v, c }) => (
              <div key={k} className="flex gap-3">
                <span className="w-24 flex-shrink-0" style={{ color: '#475569' }}>{k}:</span>
                <span style={{ color: c }}>{v}</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'analysis' && (
          <div className="space-y-3">
            {/* CRS full */}
            {turn.C !== undefined && (
              <CRSBar c={turn.C} r={turn.R ?? 0} s={turn.S ?? 0} m={turn.M ?? 0} />
            )}
            {/* Governor */}
            {turn.governor && (
              <div className="space-y-1 pt-2 border-t" style={{ borderColor: '#1a2040' }}>
                <div style={{ color: '#475569' }}>// governor</div>
                <div className="flex gap-3">
                  <span style={{ color: '#475569' }}>decision:</span>
                  <span style={{ color: turn.governor.decision === 'INTERVENE' ? '#ef4444' : '#22c55e' }}>
                    {turn.governor.decision}
                  </span>
                </div>
                <div className="flex gap-3">
                  <span style={{ color: '#475569' }}>δV:</span>
                  <span style={{ color: turn.governor.dV < 0 ? '#10b981' : '#ef4444' }}>
                    {turn.governor.dV > 0 ? '+' : ''}{turn.governor.dV?.toFixed(5)}
                  </span>
                </div>
                <div className="flex gap-3">
                  <span style={{ color: '#475569' }}>Lyapunov:</span>
                  <span style={{ color: turn.governor.lyapunov_stable ? '#10b981' : '#ef4444' }}>
                    {turn.governor.lyapunov_stable ? '✓ stable' : '⚠ breach'}
                  </span>
                </div>
              </div>
            )}
            {/* Law */}
            {turn.law && (
              <div className="pt-2 border-t" style={{ borderColor: '#1a2040' }}>
                <div style={{ color: '#475569' }}>// law invoked</div>
                <div style={{ color: '#c9a84c' }}>[{turn.law.book}] {turn.law.name}</div>
              </div>
            )}
            {/* Simplex */}
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

/* ── Message bubble ──────────────────────────────────────────── */
function MessageBubble({
  turn,
  isLatest,
  streaming,
  partialOutput,
  openTab,
  onOpenTab,
}: {
  turn: ChatTurn;
  isLatest: boolean;
  streaming: boolean;
  partialOutput: string;
  openTab: MsgTab | null;
  onOpenTab: (tab: MsgTab | null) => void;
}) {
  const hcfg = HEALTH[turn.health_band ?? 'OPTIMAL'] ?? HEALTH.OPTIMAL;
  const isUser = turn.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-xs sm:max-w-md px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
          style={{ background: '#0f1929', border: '1px solid #1a2040', color: '#cbd5e1' }}
        >
          {turn.content}
        </div>
      </div>
    );
  }

  // Lex bubble
  const displayText = isLatest && streaming ? partialOutput : (turn.governed_output ?? turn.partial ?? '');
  const isCurrentlyStreaming = isLatest && streaming;

  return (
    <div className="flex justify-start">
      <div className="max-w-sm sm:max-w-lg w-full">
        {/* Bubble */}
        <div
          className="px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed"
          style={{
            background: '#07080f',
            borderLeft: `2px solid ${hcfg.color}`,
            border: `1px solid #1a2040`,
            borderLeftWidth: 2,
            borderLeftColor: hcfg.color,
            boxShadow: isCurrentlyStreaming ? hcfg.glow : 'none',
            transition: 'box-shadow 0.3s',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-mono font-bold" style={{ color: '#c9a84c' }}>⬡ Lex Aureon</span>
            {turn.health_band && (
              <span
                className="text-xs font-mono px-1.5 py-0.5 rounded-full"
                style={{ color: hcfg.color, background: `${hcfg.color}12`, border: `1px solid ${hcfg.color}30`, fontSize: 10 }}
              >
                {hcfg.label}
              </span>
            )}
            {turn.memory_injected && (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded-full" style={{ color: '#a855f7', background: '#a855f712', border: '1px solid #a855f720', fontSize: 10 }}>
                🧠
              </span>
            )}
            {turn.attack_type && turn.attack_type !== 'none' && (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded-full" style={{ color: '#f97316', background: '#f9731612', border: '1px solid #f9731620', fontSize: 10 }}>
                🛡 {turn.attack_type}
              </span>
            )}
            {turn.intervened && (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded-full" style={{ color: '#ef4444', background: '#ef444412', border: '1px solid #ef444420', fontSize: 10 }}>
                ⚡ corrected
              </span>
            )}
            {isCurrentlyStreaming && (
              <span className="ml-auto text-xs font-mono animate-pulse" style={{ color: '#c9a84c' }}>●</span>
            )}
          </div>

          {/* Content */}
          <div style={{ color: turn.intervened ? '#fcd34d' : '#86efac' }} className="whitespace-pre-wrap">
            {displayText || (isCurrentlyStreaming ? '' : (turn.error ?? ''))}
            {isCurrentlyStreaming && (
              <span
                className="inline-block w-2 h-4 align-text-bottom ml-0.5 rounded-sm"
                style={{ background: '#c9a84c', animation: 'term-blink 0.8s step-end infinite' }}
              />
            )}
            {!displayText && !isCurrentlyStreaming && turn.error && (
              <span style={{ color: '#ef4444' }}>{turn.error}</span>
            )}
          </div>

          {/* CRS bar */}
          {!isCurrentlyStreaming && turn.C !== undefined && (
            <CRSBar c={turn.C} r={turn.R ?? 0} s={turn.S ?? 0} m={turn.M ?? 0} />
          )}

          {/* Tab buttons */}
          {!isCurrentlyStreaming && turn.governed_output && (
            <div className="flex items-center gap-1.5 mt-3 pt-2 border-t" style={{ borderColor: '#1a2040' }}>
              {(['raw', 'audit', 'analysis'] as MsgTab[]).map(t => (
                <button
                  key={t}
                  onClick={() => onOpenTab(openTab === t ? null : t)}
                  className="px-2 py-0.5 rounded text-xs font-mono transition-all"
                  style={{
                    color: openTab === t ? '#c9a84c' : '#475569',
                    background: openTab === t ? '#c9a84c15' : 'transparent',
                    border: `1px solid ${openTab === t ? '#c9a84c30' : '#1a2040'}`,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Inline tab panel */}
        {openTab && !isCurrentlyStreaming && turn.governed_output && (
          <MessageTabPanel turn={turn} activeTab={openTab} onClose={() => onOpenTab(null)} />
        )}
      </div>
    </div>
  );
}

/* ── Suggestion chips ────────────────────────────────────────── */
function SuggestionBar({
  turns,
  activeCategory,
  onCategoryChange,
  onSelect,
  disabled,
}: {
  turns: ChatTurn[];
  activeCategory: SuggestionCategory;
  onCategoryChange: (c: SuggestionCategory) => void;
  onSelect: (prompt: string) => void;
  disabled: boolean;
}) {
  const suggestions = useMemo(
    () => activeCategory === 'all'
      ? getDynamicSuggestions(turns, 'all', 3)
      : getPromptsByCategory(activeCategory).slice(0, 4),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [turns.length, activeCategory],
  );

  return (
    <div className="space-y-2">
      {/* Category tabs */}
      <div
        className="flex gap-1 overflow-x-auto pb-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {SUGGESTION_CATEGORIES.map(cat => (
          <button
            key={cat.key}
            onClick={() => onCategoryChange(cat.key)}
            className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-mono transition-all"
            style={{
              color: activeCategory === cat.key ? '#07070d' : '#475569',
              background: activeCategory === cat.key ? '#c9a84c' : '#0a0d18',
              border: `1px solid ${activeCategory === cat.key ? '#c9a84c' : '#1a2040'}`,
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Dynamic chips */}
      <div className="flex gap-1.5 flex-wrap">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => !disabled && onSelect(s.prompt)}
            disabled={disabled}
            title={s.prompt}
            className="px-3 py-1.5 rounded-full text-xs font-mono transition-all disabled:opacity-40 text-left"
            style={{
              color: '#94a3b8',
              background: '#0a0d18',
              border: '1px solid #1a2040',
              maxWidth: '240px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <span
              className="mr-1.5 text-xs"
              style={{
                color: {
                  jailbreak:  '#ef4444',
                  sycophancy: '#10b981',
                  identity:   '#3b82f6',
                  'slow-drip':'#f59e0b',
                  probe:      '#a855f7',
                  attack:     '#f97316',
                  baseline:   '#64748b',
                }[s.category] ?? '#64748b',
              }}
            >●</span>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ── Main Chat Console ───────────────────────────────────────── */
export default function ChatConsole() {
  const [turns, setTurns]                   = useState<ChatTurn[]>([]);
  const [input, setInput]                   = useState('');
  const [apiCalls, setApiCalls]             = useState(0);
  const [showUpgrade, setShowUpgrade]       = useState(false);
  const [showEmail, setShowEmail]           = useState(false);
  const [suggCat, setSuggCat]               = useState<SuggestionCategory>('all');
  const [openTabs, setOpenTabs]             = useState<Record<string, MsgTab | null>>({});
  const [currentLexId, setCurrentLexId]     = useState<string | null>(null);
  const [liveM, setLiveM]                   = useState<number | null>(null);
  const [liveHealth, setLiveHealth]         = useState<string>('OPTIMAL');

  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);
  const toast       = useToast();

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

  // Load api call count
  useEffect(() => {
    const s = localStorage.getItem('lex_api_calls');
    if (s) setApiCalls(parseInt(s, 10));
  }, []);

  useEffect(() => {
    localStorage.setItem('lex_api_calls', apiCalls.toString());
  }, [apiCalls]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, stream.partialOutput]);

  // Track live M during streaming
  useEffect(() => {
    if (!stream.metrics) return;
    setLiveM(stream.metrics.m ?? null);
    setLiveHealth(stream.metrics.health_band ?? stream.metrics.health ?? 'OPTIMAL');
  }, [stream.metrics]);

  // On complete — finalise the streaming Lex turn
  useEffect(() => {
    if (stream.stage !== 'complete' || !stream.complete || !currentLexId) return;
    const res = stream.complete as GovernanceResponse;
    const kx  = res as unknown as Record<string, unknown>;

    const M          = Number(kx.M ?? res.metrics?.m ?? 0);
    const health     = String(kx.health_band ?? 'OPTIMAL');
    const C          = Number((kx.state as Record<string,number>)?.C ?? res.metrics?.c ?? 0);
    const R          = Number((kx.state as Record<string,number>)?.R ?? res.metrics?.r ?? 0);
    const S          = Number((kx.state as Record<string,number>)?.S ?? res.metrics?.s ?? 0);
    const sig        = (kx.semantic_signal as { attack_type?: string }) ?? {};

    setTurns(prev => prev.map(t =>
      t.id === currentLexId
        ? {
            ...t,
            streaming:        false,
            governed_output:  res.governed_output,
            raw_output:       res.raw_output,
            audit_id:         res.audit_id,
            M, health_band: health, C, R, S,
            delta_V:          Number(kx.delta_V ?? 0),
            attack_type:      sig.attack_type ?? 'none',
            intervened:       !!(res.intervention?.triggered || res.intervention?.applied),
            projection_triggered: Boolean(kx.projection_triggered),
            memory_injected:  Boolean(kx.memory_injected),
            law:              stream.law ?? null,
            governor:         stream.governor ?? null,
            complete:         res,
          }
        : t,
    ));

    setLiveM(M);
    setLiveHealth(health);
    setApiCalls(c => c + 1);
    setCurrentLexId(null);
    toast.push('Run complete', 'success');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.stage, stream.complete]);

  // On error
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
      setShowEmail(true);
      return;
    }

    // Build memory context from existing turns
    const memCtx = buildMemoryContext(turns);

    // Add user turn
    const userId: string = `u_${Date.now()}`;
    const lexId:  string = `l_${Date.now()}`;

    setTurns(prev => [
      ...prev,
      { id: userId, role: 'user',  content: p,  timestamp: Date.now() },
      { id: lexId,  role: 'lex',   content: '', timestamp: Date.now(), streaming: true, partial: '' },
    ]);
    setCurrentLexId(lexId);
    setInput('');

    // Run stream — pass memoryContext as second arg if API supports it
    // Falls back gracefully if not — sessionId carries CRS state regardless
    await runStream(p, sessionId);
  }, [input, stream.loading, apiCalls, turns, runStream, sessionId]);

  const hcfg       = HEALTH[liveHealth] ?? HEALTH.OPTIMAL;
  const isStreaming = stream.loading;
  const arc        = useMemo(() => buildSessionArc(turns), [turns]);

  return (
    <div
      className="h-screen flex flex-col"
      style={{ background: '#050810', fontFamily: "'JetBrains Mono','SF Mono','Fira Code',monospace" }}
    >
      {/* ── Sticky Header ─────────────────────────────────────── */}
      <header
        className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b z-40"
        style={{ background: '#070b14', borderColor: '#1a2040' }}
      >
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs font-mono text-slate-600 hover:text-slate-400 transition-colors">←</Link>
          <span className="text-xs font-mono font-bold" style={{ color: '#c9a84c' }}>LEX AUREON</span>
          <span className="text-xs font-mono text-slate-600 hidden sm:block">· Sovereign Console</span>
        </div>

        {/* Live M badge */}
        <div className="flex items-center gap-2">
          {liveM !== null && (
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono"
              style={{
                color: hcfg.color,
                background: `${hcfg.color}12`,
                border: `1px solid ${hcfg.color}30`,
                boxShadow: isStreaming ? hcfg.glow : 'none',
                transition: 'box-shadow 0.3s',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: hcfg.color, animation: isStreaming ? 'term-blink 1s step-end infinite' : 'none' }}
              />
              M={liveM.toFixed(3)} {hcfg.label}
            </div>
          )}
          <span className="text-xs font-mono text-slate-600">{MAX_CALLS - apiCalls} left</span>
          <button
            onClick={() => setShowUpgrade(true)}
            className="text-xs px-2.5 py-1 rounded border font-mono transition-all hover:opacity-80"
            style={{ borderColor: '#c9a84c40', color: '#c9a84c', background: '#c9a84c0a' }}
          >
            upgrade
          </button>
        </div>
      </header>

      {/* ── Chat thread ───────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Empty state */}
        {!turns.length && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-12">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
              style={{ background: '#c9a84c15', border: '1px solid #c9a84c30' }}
            >
              ⬡
            </div>
            <div>
              <p className="text-sm font-mono font-bold" style={{ color: '#c9a84c' }}>Sovereign Console</p>
              <p className="text-xs font-mono text-slate-600 mt-1">Constitutional governance · continuous context · never drifts</p>
            </div>
            <div
              className="text-xs font-mono px-4 py-3 rounded-lg max-w-xs text-left space-y-1"
              style={{ background: '#070b14', border: '1px solid #1a2040', color: '#475569' }}
            >
              <div>• Every turn carries full C·R·S state forward</div>
              <div>• Context is mathematically anchored, not text</div>
              <div>• Try a jailbreak — watch the governor hold</div>
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {turns.map(turn => (
          <MessageBubble
            key={turn.id}
            turn={turn}
            isLatest={turn.id === currentLexId}
            streaming={isStreaming && turn.id === currentLexId}
            partialOutput={stream.partialOutput}
            openTab={openTabs[turn.id] ?? null}
            onOpenTab={tab => setOpenTabs(prev => ({ ...prev, [turn.id]: tab }))}
          />
        ))}

        <div ref={bottomRef} />
      </main>

      {/* ── Bottom input area ─────────────────────────────────── */}
      <footer
        className="flex-shrink-0 border-t px-4 pt-3 pb-safe space-y-3"
        style={{ background: '#070b14', borderColor: '#1a2040', paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      >
        {/* Suggestion bar */}
        <SuggestionBar
          turns={turns}
          activeCategory={suggCat}
          onCategoryChange={setSuggCat}
          onSelect={p => { setInput(p); inputRef.current?.focus(); }}
          disabled={isStreaming}
        />

        {/* Input row */}
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value.slice(0, 2000))}
              onKeyDown={e => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && input.trim() && !isStreaming) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Message Lex Aureon..."
              rows={1}
              className="w-full rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none"
              style={{
                background: '#0a0d18',
                border: '1px solid #1a2040',
                color: '#cbd5e1',
                caretColor: '#c9a84c',
                fontFamily: 'inherit',
                maxHeight: '120px',
                lineHeight: '1.5',
              }}
              onInput={e => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
            />
          </div>

          {isStreaming ? (
            <button
              onClick={cancel}
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all"
              style={{ background: '#1a0505', border: '1px solid #7f1d1d', color: '#f87171' }}
            >
              ■
            </button>
          ) : (
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || apiCalls >= MAX_CALLS}
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 disabled:opacity-30"
              style={{
                background: input.trim() && apiCalls < MAX_CALLS
                  ? 'linear-gradient(135deg, #c9a84c, #e8c96d)'
                  : '#0a0d18',
                border: `1px solid ${input.trim() && apiCalls < MAX_CALLS ? '#c9a84c' : '#1a2040'}`,
                color: input.trim() && apiCalls < MAX_CALLS ? '#07070d' : '#475569',
              }}
            >
              ↑
            </button>
          )}
        </div>

        <div className="flex items-center justify-between text-xs font-mono text-slate-700">
          <span>⌘+Enter to send · {turns.filter(t => t.role === 'lex').length} turns · session {sessionId.slice(-6)}</span>
          {arc.interventionCount > 0 && (
            <span style={{ color: '#f97316' }}>⚡ {arc.interventionCount} intervention{arc.interventionCount > 1 ? 's' : ''}</span>
          )}
        </div>
      </footer>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} callsUsed={apiCalls} />}
      {showEmail && (
        <EmailCapture onComplete={() => {
          setShowEmail(false);
          setTimeout(() => sendMessage(), 100);
        }} />
      )}
    </div>
  );
}
