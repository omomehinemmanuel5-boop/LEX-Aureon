'use client';

import {
  useState, useEffect, useRef, useCallback, useMemo, memo,
} from 'react';
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

/* ─────────────────────────────────────────────────────────────────────
   CONSTANTS & TYPES
───────────────────────────────────────────────────────────────────── */
const MAX_CALLS = 10;

const G = {
  gold: '#c9a84c', goldL: '#e8c96d', goldD: '#a07830',
  bg:   '#080a12', surface: '#0c0f1c', border: '#141929',
  borderHover: '#1e2840', text: '#8899aa', textDim: '#3a4a5c',
  textBright: '#cdd8e3',
  C: '#3b82f6', R: '#10b981', S: '#f59e0b',
};

const HEALTH: Record<string, { color: string; bg: string; label: string }> = {
  OPTIMAL:  { color: '#10b981', bg: '#10b98112', label: 'OPTIMAL'  },
  ALERT:    { color: '#f59e0b', bg: '#f59e0b12', label: 'ALERT'    },
  STRESSED: { color: '#f97316', bg: '#f9731612', label: 'STRESSED' },
  CRITICAL: { color: '#ef4444', bg: '#ef444412', label: 'CRITICAL' },
};

const MODE_PREFIX: Record<SandboxMode, string> = {
  chat:     '',
  code:     '[CODE] Respond with production-quality code. Use fenced blocks with language tags and filename comments. ',
  research: '[RESEARCH] Provide rigorous analysis grounded in the constitutional framework. Cite mechanisms by name. ',
  redteam:  '[PROBE] Constitutional stress test. Respond with full governance transparency. Show reasoning. ',
};

const MODES = [
  { key: 'chat'    as SandboxMode, label: 'Chat',     icon: '◈' },
  { key: 'code'    as SandboxMode, label: 'Code',     icon: '</>' },
  { key: 'research'as SandboxMode, label: 'Research', icon: '∇' },
  { key: 'redteam' as SandboxMode, label: 'Probe',    icon: '⊗' },
];

type SandboxMode = 'chat' | 'code' | 'research' | 'redteam';
type PanelView   = 'editor' | 'terminal' | 'files';
type MsgTab      = 'raw' | 'audit' | 'analysis';

interface SandboxFile {
  id: string; name: string; lang: string;
  content: string; createdAt: number; modifiedAt: number;
}
interface CodeBlock { lang: string; code: string; filename?: string }

/* ─────────────────────────────────────────────────────────────────────
   UTILITIES
───────────────────────────────────────────────────────────────────── */
function langFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', sh: 'bash', json: 'json',
    md: 'markdown', css: 'css', html: 'html', sql: 'sql', yaml: 'yaml',
  };
  return map[ext] ?? 'text';
}

function parseCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const re = /```(\w+)?(?:\s+\/\/\s*(.+?))?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null)
    blocks.push({ lang: m[1] ?? 'text', filename: m[2]?.trim(), code: m[3] });
  return blocks;
}

function highlight(code: string, lang: string): string {
  let h = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (['text', 'markdown', 'md'].includes(lang)) return h;
  h = h.replace(/(["`])((?:\\.|(?!\1)[^\\])*?)\1/g, '<span style="color:#86efac">$1$2$1</span>');
  h = h.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/g, '<span style="color:#2d4060">$1</span>');
  h = h.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|default|from|async|await|type|interface|extends|new|typeof|void|null|undefined|true|false|def|fn|pub|use|mod|struct|enum|match|self)\b/g, '<span style="color:#c9a84c">$1</span>');
  h = h.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#a78bfa">$1</span>');
  h = h.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span style="color:#38bdf8">$1</span>');
  return h;
}

/* ─────────────────────────────────────────────────────────────────────
   CRS BAR
───────────────────────────────────────────────────────────────────── */
function CRSBar({ c, r, s, m }: { c: number; r: number; s: number; m: number }) {
  const mColor = m < 0.08 ? '#ef4444' : m < 0.15 ? '#f59e0b' : '#10b981';
  const total  = (c + r + s) || 1;
  return (
    <div className="space-y-1 pt-2 mt-2" style={{ borderTop: `1px solid ${G.border}` }}>
      {([['C', c, G.C], ['R', r, G.R], ['S', s, G.S]] as [string, number, string][]).map(([k, v, color]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-[9px] font-mono font-bold w-3 tabular-nums" style={{ color }}>{k}</span>
          <div className="flex-1 h-[2px] rounded-full" style={{ background: G.border }}>
            <div className="h-[2px] rounded-full transition-all duration-700"
              style={{ width: `${(v / total) * 100}%`, background: color }} />
          </div>
          <span className="text-[9px] font-mono tabular-nums w-7 text-right" style={{ color: G.textDim }}>{v.toFixed(2)}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-0.5">
        <span className="text-[9px] font-mono font-bold w-3" style={{ color: G.gold }}>M</span>
        <div className="flex-1 h-[3px] rounded-full" style={{ background: G.border }}>
          <div className="h-[3px] rounded-full transition-all duration-700"
            style={{ width: `${Math.min(m, 1) * 100}%`, background: mColor }} />
        </div>
        <span className="text-[9px] font-mono tabular-nums font-bold w-10 text-right" style={{ color: G.gold }}>{m.toFixed(3)}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   CODE VIEWER
───────────────────────────────────────────────────────────────────── */
const CodeViewer = memo(function CodeViewer({ block, onSave }: {
  block: CodeBlock; onSave?: (b: CodeBlock) => void;
}) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => highlight(block.code, block.lang), [block.code, block.lang]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(block.code).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    });
  }, [block.code]);

  return (
    <div className="mt-2 rounded-lg overflow-hidden text-[11px]"
      style={{ background: '#050810', border: `1px solid ${G.border}` }}>
      <div className="flex items-center justify-between px-3 py-1.5"
        style={{ background: '#070a14', borderBottom: `1px solid ${G.border}` }}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px]" style={{ color: '#38bdf8' }}>{block.lang}</span>
          {block.filename && (
            <span className="font-mono text-[10px] px-1.5 py-px rounded"
              style={{ color: G.gold, background: `${G.gold}10`, border: `1px solid ${G.gold}20` }}>
              {block.filename}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {onSave && (
            <button onClick={() => onSave(block)}
              className="font-mono text-[10px] px-2 py-px rounded transition-all active:scale-95"
              style={{ color: G.R, background: `${G.R}10`, border: `1px solid ${G.R}20` }}>
              + save
            </button>
          )}
          <button onClick={copy}
            className="font-mono text-[10px] px-2 py-px rounded transition-all active:scale-95"
            style={{ color: copied ? G.R : G.textDim }}>
            {copied ? '✓' : 'copy'}
          </button>
        </div>
      </div>
      <pre className="p-3 leading-relaxed overflow-x-auto font-mono"
        style={{ color: '#7a8fa8', scrollbarWidth: 'thin', scrollbarColor: `${G.border} transparent` }}
        dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});

/* ─────────────────────────────────────────────────────────────────────
   MESSAGE CONTENT
───────────────────────────────────────────────────────────────────── */
function MessageContent({ text, onSaveBlock }: {
  text: string; onSaveBlock?: (b: CodeBlock) => void;
}) {
  const parts = useMemo(() => {
    const segs: Array<{ type: 'text' | 'code'; content: string; block?: CodeBlock }> = [];
    const re = /```(\w+)?(?:\s+\/\/\s*(.+?))?\n([\s\S]*?)```/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) segs.push({ type: 'text', content: text.slice(last, m.index) });
      segs.push({ type: 'code', content: m[3], block: { lang: m[1] ?? 'text', filename: m[2]?.trim(), code: m[3] } });
      last = m.index + m[0].length;
    }
    if (last < text.length) segs.push({ type: 'text', content: text.slice(last) });
    return segs;
  }, [text]);

  return (
    <div className="space-y-1">
      {parts.map((p, i) =>
        p.type === 'text'
          ? <p key={i} className="whitespace-pre-wrap leading-[1.8] text-[13px]"
              style={{ color: G.text }}>{p.content}</p>
          : <CodeViewer key={i} block={p.block!} onSave={onSaveBlock} />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   GOVERNANCE DETAIL PANEL
───────────────────────────────────────────────────────────────────── */
function GovernancePanel({ turn, tab, onClose }: {
  turn: ChatTurn; tab: MsgTab; onClose: () => void;
}) {
  const hcfg = HEALTH[turn.health_band ?? 'OPTIMAL'] ?? HEALTH.OPTIMAL;
  const res  = turn.complete as GovernanceResponse | null;

  return (
    <div className="mt-1.5 rounded-lg overflow-hidden font-mono text-[11px]"
      style={{ background: '#060810', border: `1px solid ${G.border}` }}>
      <div className="flex items-center justify-between px-3 py-2"
        style={{ background: '#070a14', borderBottom: `1px solid ${G.border}` }}>
        <span className="text-[10px] tracking-wider" style={{ color: G.textDim }}>
          {tab === 'raw' ? '// bare output (ungoverned)' : tab === 'audit' ? '// receipt' : '// constitutional state'}
        </span>
        <button onClick={onClose} className="text-[11px] w-4 h-4 flex items-center justify-center rounded"
          style={{ color: G.textDim }}>✕</button>
      </div>

      <div className="p-3 max-h-64 overflow-y-auto space-y-2" style={{ scrollbarWidth: 'thin', scrollbarColor: `${G.border} transparent` }}>
        {tab === 'raw' && (
          <p className="whitespace-pre-wrap leading-relaxed text-[11px]" style={{ color: G.textDim }}>
            {turn.raw_output || '// no bare output — blocked at pre-eval'}
          </p>
        )}

        {tab === 'audit' && [
          { k: 'audit_id',   v: turn.audit_id?.slice(0, 20) ?? 'N/A',           c: G.gold },
          { k: 'health',     v: turn.health_band ?? 'OPTIMAL',                   c: hcfg.color },
          { k: 'M',          v: (turn.M ?? 0).toFixed(4),                        c: hcfg.color },
          { k: 'intervened', v: turn.intervened ? 'YES' : 'NO',                  c: turn.intervened ? '#ef4444' : G.R },
          { k: 'attack',     v: turn.attack_type ?? 'none',                      c: (turn.attack_type && turn.attack_type !== 'none') ? '#f97316' : G.textDim },
          { k: 'severity',   v: turn.attack_severity != null ? turn.attack_severity.toFixed(3) : '—', c: (turn.attack_severity ?? 0) >= 0.7 ? '#ef4444' : G.textDim },
          { k: 'memory',     v: turn.memory_injected ? 'injected' : 'none',      c: turn.memory_injected ? '#a855f7' : G.textDim },
        ].map(({ k, v, c }) => (
          <div key={k} className="flex gap-3">
            <span className="w-20 flex-shrink-0" style={{ color: G.textDim }}>{k}</span>
            <span style={{ color: c }}>{v}</span>
          </div>
        ))}

        {tab === 'analysis' && (
          <div className="space-y-3">
            {turn.C != null && <CRSBar c={turn.C} r={turn.R ?? 0} s={turn.S ?? 0} m={turn.M ?? 0} />}

            {turn.governor && (
              <div className="space-y-1.5 pt-2" style={{ borderTop: `1px solid ${G.border}` }}>
                <div style={{ color: G.textDim }} className="text-[10px]">// governor</div>
                {[
                  { k: 'decision', v: turn.governor.decision, c: turn.governor.decision === 'INTERVENE' ? '#ef4444' : G.R },
                  { k: 'δV',       v: `${(turn.governor.dV > 0 ? '+' : '')}${turn.governor.dV?.toFixed(5)}`, c: turn.governor.dV < 0 ? G.R : '#ef4444' },
                  { k: 'stable',   v: turn.governor.lyapunov_stable ? '✓ yes' : '⚠ breach', c: turn.governor.lyapunov_stable ? G.R : '#ef4444' },
                ].map(({ k, v, c }) => (
                  <div key={k} className="flex gap-3">
                    <span className="w-20" style={{ color: G.textDim }}>{k}</span>
                    <span style={{ color: c }}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            {turn.law && (
              <div className="pt-2" style={{ borderTop: `1px solid ${G.border}` }}>
                <div className="text-[10px] mb-1" style={{ color: G.textDim }}>// law invoked</div>
                <div className="font-semibold" style={{ color: G.gold }}>[{turn.law.book}] {turn.law.name}</div>
              </div>
            )}

            {turn.C != null && res && (
              <div className="pt-2" style={{ borderTop: `1px solid ${G.border}` }}>
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

/* ─────────────────────────────────────────────────────────────────────
   MESSAGE BUBBLE
───────────────────────────────────────────────────────────────────── */
const MessageBubble = memo(function MessageBubble({
  turn, isLatest, streaming, partialOutput, openTab, onOpenTab, onSaveBlock, sandboxMode,
}: {
  turn: ChatTurn; isLatest: boolean; streaming: boolean; partialOutput: string;
  openTab: MsgTab | null; onOpenTab: (t: MsgTab | null) => void;
  onSaveBlock: (b: CodeBlock) => void; sandboxMode: SandboxMode;
}) {
  const hcfg = HEALTH[turn.health_band ?? 'OPTIMAL'] ?? HEALTH.OPTIMAL;
  const live  = isLatest && streaming;
  const text  = live ? partialOutput : (turn.governed_output ?? turn.partial ?? '');

  /* ── User bubble ── */
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-tr-sm text-[13px] leading-relaxed"
          style={{ background: G.surface, border: `1px solid ${G.border}`, color: G.textBright }}>
          {turn.content}
        </div>
      </div>
    );
  }

  /* ── Lex bubble ── */
  const hasCode = !live && !!text && parseCodeBlocks(text).length > 0;

  return (
    <div className="flex justify-start gap-2.5">
      {/* Avatar */}
      <div className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold"
        style={{ background: `${G.gold}12`, border: `1px solid ${G.gold}25`, color: G.gold }}>⬡</div>

      <div className="flex-1 min-w-0">
        {/* Meta row */}
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <span className="text-[10px] font-mono font-bold tracking-wider" style={{ color: G.gold }}>
            Lex Aureon
          </span>
          {sandboxMode !== 'chat' && (
            <span className="text-[9px] font-mono px-1.5 py-px rounded"
              style={{ color: G.textDim, background: G.surface, border: `1px solid ${G.border}` }}>
              {sandboxMode}
            </span>
          )}
          {turn.health_band && turn.health_band !== 'OPTIMAL' && (
            <span className="text-[9px] font-mono px-1.5 py-px rounded-full"
              style={{ color: hcfg.color, background: hcfg.bg, border: `1px solid ${hcfg.color}20` }}>
              {hcfg.label}
            </span>
          )}
          {turn.intervened && (
            <span className="text-[9px] font-mono px-1.5 py-px rounded-full"
              style={{ color: '#ef4444', background: '#ef444410', border: '1px solid #ef444420' }}>
              corrected
            </span>
          )}
          {turn.memory_injected && (
            <span className="text-[9px] font-mono px-1.5 py-px rounded-full"
              style={{ color: '#a855f7', background: '#a855f710', border: '1px solid #a855f720' }}>
              ⟳ mem
            </span>
          )}
          {turn.attack_type && turn.attack_type !== 'none' && (
            <span className="text-[9px] font-mono px-1.5 py-px rounded-full"
              style={{ color: '#f97316', background: '#f9731610', border: '1px solid #f9731620' }}>
              ⊗ {turn.attack_type}
            </span>
          )}
          {hasCode && (
            <span className="text-[9px] font-mono px-1.5 py-px rounded-full"
              style={{ color: '#38bdf8', background: '#38bdf810', border: '1px solid #38bdf820' }}>
              {'</>'}
            </span>
          )}
          {live && <span className="text-[9px] font-mono lex-pulse" style={{ color: G.gold }}>●</span>}
        </div>

        {/* Bubble */}
        <div className="rounded-2xl rounded-tl-sm"
          style={{
            background: G.surface,
            border: `1px solid ${live ? `${hcfg.color}40` : G.border}`,
            borderLeft: `2px solid ${hcfg.color}`,
            transition: 'border-color 0.3s',
          }}>

          <div className="px-4 py-3">
            {live ? (
              <p className="whitespace-pre-wrap leading-[1.8] text-[13px]" style={{ color: G.text }}>
                {partialOutput}
                <span className="lex-cursor inline-block w-[2px] h-[13px] align-text-bottom ml-0.5 rounded-[1px]"
                  style={{ background: G.gold }} />
              </p>
            ) : text ? (
              <MessageContent text={text} onSaveBlock={onSaveBlock} />
            ) : turn.error ? (
              <p className="text-[13px]" style={{ color: '#ef4444' }}>{turn.error}</p>
            ) : null}

            {!live && turn.C != null && (
              <CRSBar c={turn.C} r={turn.R ?? 0} s={turn.S ?? 0} m={turn.M ?? 0} />
            )}
          </div>

          {/* Tab controls */}
          {!live && turn.governed_output && (
            <div className="flex items-center gap-1 px-4 py-2"
              style={{ borderTop: `1px solid ${G.border}` }}>
              {(['raw', 'audit', 'analysis'] as MsgTab[]).map(t => (
                <button key={t} onClick={() => onOpenTab(openTab === t ? null : t)}
                  className="px-2.5 py-1 rounded text-[10px] font-mono transition-all active:scale-95"
                  style={{
                    color: openTab === t ? G.gold : G.textDim,
                    background: openTab === t ? `${G.gold}10` : 'transparent',
                    border: `1px solid ${openTab === t ? `${G.gold}25` : 'transparent'}`,
                  }}>{t}</button>
              ))}
            </div>
          )}
        </div>

        {openTab && !live && turn.governed_output && (
          <GovernancePanel turn={turn} tab={openTab} onClose={() => onOpenTab(null)} />
        )}
      </div>
    </div>
  );
});

/* ─────────────────────────────────────────────────────────────────────
   SANDBOX PANEL
───────────────────────────────────────────────────────────────────── */
function SandboxPanel({ files, activeFileId, terminalLog, onSelectFile, onUpdateFile, onNewFile, onDeleteFile }: {
  files: SandboxFile[]; activeFileId: string | null; terminalLog: string[];
  onSelectFile: (id: string) => void; onUpdateFile: (id: string, c: string) => void;
  onNewFile: (name: string) => void; onDeleteFile: (id: string) => void;
}) {
  const [panel, setPanel]         = useState<PanelView>('editor');
  const [newName, setNewName]     = useState('');
  const [showNew, setShowNew]     = useState(false);
  const activeFile                = files.find(f => f.id === activeFileId);
  const termRef                   = useRef<HTMLDivElement>(null);
  const nameRef                   = useRef<HTMLInputElement>(null);

  useEffect(() => { if (panel === 'terminal') termRef.current?.scrollTo(0, 9999); }, [terminalLog, panel]);
  useEffect(() => { if (showNew) nameRef.current?.focus(); }, [showNew]);

  const submitNew = useCallback(() => {
    const n = newName.trim(); if (!n) return;
    onNewFile(n); setNewName(''); setShowNew(false); setPanel('editor');
  }, [newName, onNewFile]);

  const TABS: { key: PanelView; label: string }[] = [
    { key: 'editor', label: 'Editor' }, { key: 'terminal', label: 'Terminal' }, { key: 'files', label: 'Files' },
  ];

  return (
    <div className="flex flex-col h-full font-mono" style={{ background: G.bg }}>
      {/* Tab bar */}
      <div className="flex items-center border-b flex-shrink-0" style={{ borderColor: G.border }}>
        {TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setPanel(key)}
            className="px-3 py-2 text-[10px] uppercase tracking-wider transition-colors"
            style={{
              color: panel === key ? G.gold : G.textDim,
              borderBottom: `1px solid ${panel === key ? G.gold : 'transparent'}`,
            }}>{label}</button>
        ))}
        <div className="flex-1" />
        <button onClick={() => setShowNew(s => !s)}
          className="px-3 py-2 text-[10px] transition-colors"
          style={{ color: G.R }}>+ new</button>
      </div>

      {showNew && (
        <div className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0" style={{ borderColor: G.border }}>
          <input ref={nameRef} value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitNew(); if (e.key === 'Escape') setShowNew(false); }}
            placeholder="filename.ts"
            className="flex-1 bg-transparent text-[11px] focus:outline-none"
            style={{ color: G.gold, caretColor: G.gold }} />
          <button onClick={submitNew} className="text-[10px] px-2 py-px rounded"
            style={{ color: G.R, background: `${G.R}10`, border: `1px solid ${G.R}20` }}>create</button>
          <button onClick={() => setShowNew(false)} className="text-[10px]" style={{ color: G.textDim }}>✕</button>
        </div>
      )}

      {/* Editor */}
      {panel === 'editor' && (
        <div className="flex flex-1 overflow-hidden">
          {files.length > 0 && (
            <div className="w-32 flex-shrink-0 overflow-y-auto border-r" style={{ borderColor: G.border, scrollbarWidth: 'none' }}>
              {files.map(f => (
                <div key={f.id} onClick={() => onSelectFile(f.id)}
                  className="group flex items-center gap-1.5 px-2.5 py-2 cursor-pointer text-[10px] relative"
                  style={{
                    background: f.id === activeFileId ? G.surface : 'transparent',
                    borderLeft: `2px solid ${f.id === activeFileId ? G.gold : 'transparent'}`,
                    color: f.id === activeFileId ? G.gold : G.textDim,
                  }}>
                  <span className="flex-1 truncate">{f.name}</span>
                  <button onClick={e => { e.stopPropagation(); onDeleteFile(f.id); }}
                    className="opacity-0 group-hover:opacity-100 text-[9px] flex-shrink-0"
                    style={{ color: '#ef4444' }}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex-1 flex flex-col overflow-hidden">
            {activeFile ? (
              <>
                <div className="flex items-center gap-2 px-3 py-1.5 border-b flex-shrink-0"
                  style={{ borderColor: G.border }}>
                  <span className="text-[10px]" style={{ color: G.gold }}>{activeFile.name}</span>
                  <span className="text-[9px]" style={{ color: G.textDim }}>{activeFile.lang}</span>
                  <div className="flex-1" />
                  <span className="text-[9px]" style={{ color: G.textDim }}>{activeFile.content.split('\n').length}L</span>
                </div>
                <textarea value={activeFile.content}
                  onChange={e => onUpdateFile(activeFile.id, e.target.value)}
                  className="flex-1 w-full resize-none focus:outline-none p-3 leading-relaxed"
                  style={{ background: G.bg, color: '#7a8fa8', caretColor: G.gold,
                    fontSize: '12px', tabSize: 2, fontFamily: 'inherit', scrollbarWidth: 'thin',
                    scrollbarColor: `${G.border} transparent` }}
                  spellCheck={false} />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
                <span style={{ color: G.textDim }}>{'</>'}</span>
                <p className="text-[10px]" style={{ color: G.textDim }}>
                  Ask Lex to write code, then tap <span style={{ color: G.R }}>+ save</span>
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Terminal */}
      {panel === 'terminal' && (
        <div ref={termRef} className="flex-1 overflow-y-auto p-3 text-[11px] space-y-px"
          style={{ scrollbarWidth: 'none' }}>
          {terminalLog.length === 0 && <p style={{ color: G.textDim }}>// ready</p>}
          {terminalLog.map((line, i) => (
            <div key={i} style={{
              color: line.startsWith('>>') ? G.gold : line.startsWith('✓') ? G.R
                   : line.startsWith('✗') ? '#ef4444' : G.textDim,
            }}>{line}</div>
          ))}
          <div className="flex items-center gap-1 pt-1">
            <span style={{ color: G.gold }}>lex@sovereign:~$</span>
            <span className="lex-cursor inline-block w-[6px] h-[12px] ml-0.5 rounded-[1px]"
              style={{ background: G.gold }} />
          </div>
        </div>
      )}

      {/* Files list */}
      {panel === 'files' && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ scrollbarWidth: 'none' }}>
          {files.length === 0 && <p className="text-[10px] text-center py-8" style={{ color: G.textDim }}>no files</p>}
          {files.map(f => (
            <div key={f.id} onClick={() => { onSelectFile(f.id); setPanel('editor'); }}
              className="flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer group text-[10px]"
              style={{ background: f.id === activeFileId ? G.surface : 'transparent' }}>
              <div className="flex-1 min-w-0">
                <p className="truncate" style={{ color: f.id === activeFileId ? G.gold : G.textDim }}>{f.name}</p>
                <p className="text-[9px]" style={{ color: G.textDim }}>{f.content.split('\n').length}L · {f.lang}</p>
              </div>
              <button onClick={e => { e.stopPropagation(); onDeleteFile(f.id); }}
                className="opacity-0 group-hover:opacity-100 text-[9px]" style={{ color: '#ef4444' }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SUGGESTION BAR
───────────────────────────────────────────────────────────────────── */
function SuggestionBar({ turns, activeCategory, onCategoryChange, onSelect, disabled }: {
  turns: ChatTurn[]; activeCategory: SuggestionCategory;
  onCategoryChange: (c: SuggestionCategory) => void;
  onSelect: (p: string) => void; disabled: boolean;
}) {
  const suggestions = useMemo(
    () => activeCategory === 'all'
      ? getDynamicSuggestions(turns, 'all', 4)
      : getPromptsByCategory(activeCategory).slice(0, 4),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [turns.length, activeCategory],
  );

  const dotColor: Record<string, string> = {
    jailbreak: '#ef4444', sycophancy: G.R, identity: G.C,
    'slow-drip': G.S, probe: '#a855f7', attack: '#f97316', baseline: G.textDim,
  };

  return (
    <div className="space-y-1.5 pb-1">
      {/* Category pills */}
      <div className="flex gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {SUGGESTION_CATEGORIES.map(cat => (
          <button key={cat.key} onClick={() => onCategoryChange(cat.key)}
            className="flex-shrink-0 px-2 py-px rounded text-[9px] font-mono transition-all"
            style={{
              color: activeCategory === cat.key ? G.gold : G.textDim,
              background: activeCategory === cat.key ? `${G.gold}10` : 'transparent',
              border: `1px solid ${activeCategory === cat.key ? `${G.gold}25` : G.border}`,
            }}>{cat.label}</button>
        ))}
      </div>
      {/* Prompt chips */}
      <div className="flex gap-1.5 flex-wrap">
        {suggestions.map((s, i) => (
          <button key={i} disabled={disabled} onClick={() => !disabled && onSelect(s.prompt)}
            title={s.prompt}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-mono
              transition-all disabled:opacity-30 active:scale-95 max-w-[200px] hover:border-opacity-60"
            style={{ color: G.text, background: G.surface, border: `1px solid ${G.border}`,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ color: dotColor[s.category] ?? G.textDim, fontSize: 6, flexShrink: 0 }}>●</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   EMPTY STATE
───────────────────────────────────────────────────────────────────── */
function EmptyState({ mode }: { mode: SandboxMode }) {
  const cfg = {
    chat:     { icon: '◈', title: 'Sovereign Console',    lines: ['C·R·S tracked every turn', 'Lyapunov-anchored stability', 'SHA-256 receipt on every run'] },
    code:     { icon: '</>', title: 'Code Mode',           lines: ['Ask Lex to write any code', 'Save blocks to sandbox', 'Edit and iterate inline'] },
    research: { icon: '∇',  title: 'Research Mode',        lines: ['Rigorous constitutional analysis', 'Formal proofs and mechanisms', 'Cross-reference session history'] },
    redteam:  { icon: '⊗',  title: 'Constitutional Probe', lines: ['Stress-test the governor live', 'Full transparency per decision', 'Watch M move in real-time'] },
  }[mode];

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-6 py-12 text-center">
      <div className="relative">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-mono"
          style={{ background: `${G.gold}0c`, border: `1px solid ${G.gold}20` }}>
          {cfg.icon}
        </div>
        <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full lex-pulse"
          style={{ background: G.R }} />
      </div>

      <div>
        <p className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: G.gold }}>
          {cfg.title}
        </p>
        <p className="text-[10px] font-mono mt-1" style={{ color: G.textDim }}>
          Constitutional governance · persistent context
        </p>
      </div>

      <div className="space-y-1.5 w-full max-w-xs text-left">
        {cfg.lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
            style={{ background: G.surface, border: `1px solid ${G.border}` }}>
            <span className="text-[9px] flex-shrink-0" style={{ color: G.gold }}>—</span>
            <p className="text-[10px] font-mono" style={{ color: G.text }}>{l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   MAIN PAGE
───────────────────────────────────────────────────────────────────── */
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
  const [liveHealth, setLiveHealth]     = useState('OPTIMAL');
  const [inputFocused, setInputFocused] = useState(false);
  const [selfTestResult, setSelfTestResult]   = useState<string | null>(null);
  const [selfTestLoading, setSelfTestLoading] = useState(false);
  const [sandboxMode, setSandboxMode]   = useState<SandboxMode>('chat');
  const [sandboxOpen, setSandboxOpen]   = useState(false);
  const [sandboxFiles, setSandboxFiles] = useState<SandboxFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [terminalLog, setTerminalLog]   = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const toast     = useToast();
  const { state: stream, run: runStream, cancel } = useLexStream();

  const [sessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'chat_console';
    const k = 'lex_session_id';
    const s = localStorage.getItem(k); if (s) return s;
    const id = `chat_${crypto.randomUUID()}`;
    localStorage.setItem(k, id); return id;
  });

  const runSelfTest = useCallback(async () => {
    setSelfTestLoading(true); setSelfTestResult(null);
    try {
      const r = await fetch('/api/self-test', { method: 'POST' });
      const d = await r.json() as { result?: { content?: Array<{ text?: string }> }; error?: string };
      setSelfTestResult(d.result?.content?.[0]?.text ?? d.error ?? 'No result');
    } catch (e) {
      setSelfTestResult('Error: ' + (e as Error).message);
    } finally { setSelfTestLoading(false); }
  }, []);

  useEffect(() => {
    const s = localStorage.getItem('lex_api_calls');
    if (s) setApiCalls(parseInt(s, 10));
    try { const f = localStorage.getItem('lex_sandbox_files'); if (f) setSandboxFiles(JSON.parse(f)); } catch { /* ok */ }
  }, []);

  useEffect(() => { localStorage.setItem('lex_api_calls', String(apiCalls)); }, [apiCalls]);
  useEffect(() => { localStorage.setItem('lex_sandbox_files', JSON.stringify(sandboxFiles)); }, [sandboxFiles]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns, stream.partialOutput]);

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
    const stateRec = kx.state as Record<string, number> | undefined;
    const C = Number(stateRec?.C ?? res.metrics?.c ?? 0);
    const R = Number(stateRec?.R ?? res.metrics?.r ?? 0);
    const S = Number(stateRec?.S ?? res.metrics?.s ?? 0);
    const sig = (kx.semantic_signal as { attack_type?: string; severity?: number }) ?? {};

    setTurns(prev => prev.map(t => t.id !== currentLexId ? t : {
      ...t, streaming: false,
      governed_output: res.governed_output, raw_output: res.raw_output, audit_id: res.audit_id,
      M, health_band: health, C, R, S,
      delta_V: Number(kx.delta_V ?? 0),
      attack_type: sig.attack_type ?? 'none',
      attack_severity: typeof sig.severity === 'number' ? sig.severity : undefined,
      intervened: !!(res.intervention?.triggered || res.intervention?.applied),
      projection_triggered: Boolean(kx.projection_triggered),
      memory_injected: Boolean(kx.memory_injected),
      law: stream.law ?? null, governor: stream.governor ?? null, complete: res,
    }));

    setLiveM(M); setLiveHealth(health); setApiCalls(c => c + 1); setCurrentLexId(null);

    if (res.governed_output) {
      const blocks = parseCodeBlocks(res.governed_output);
      if (blocks.length > 0) {
        setTerminalLog(prev => [
          ...prev,
          `>> emitted ${blocks.length} block${blocks.length > 1 ? 's' : ''}`,
          ...blocks.map(b => `  ✓ ${b.lang}${b.filename ? ` · ${b.filename}` : ''}`),
        ]);
        if (sandboxMode === 'code') setSandboxOpen(true);
      }
    }
    toast.push('Run complete', 'success');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.stage, stream.complete]);

  useEffect(() => {
    if (!stream.error || !currentLexId) return;
    setTurns(prev => prev.map(t => t.id !== currentLexId ? t : { ...t, streaming: false, error: stream.error ?? 'Error' }));
    setCurrentLexId(null);
    setTerminalLog(prev => [...prev, `✗ ${stream.error}`]);
    toast.push(stream.error, 'error');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.error]);

  const sendMessage = useCallback(async (promptOverride?: string) => {
    const raw = (promptOverride ?? input).trim();
    if (!raw || stream.loading) return;
    if (apiCalls >= MAX_CALLS) { setShowUpgrade(true); return; }
    if (typeof window !== 'undefined' && !localStorage.getItem('lex_email_captured') && apiCalls === 0) {
      setShowEmail(true); return;
    }

    const governed = (MODE_PREFIX[sandboxMode] + raw).trim();
    const userId = `u_${Date.now()}`, lexId = `l_${Date.now()}`;

    setTurns(prev => [
      ...prev,
      { id: userId, role: 'user', content: raw, timestamp: Date.now() },
      { id: lexId,  role: 'lex',  content: '', timestamp: Date.now(), streaming: true, partial: '' },
    ]);
    setCurrentLexId(lexId);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setTerminalLog(prev => [...prev, `>> ${raw.slice(0, 80)}${raw.length > 80 ? '…' : ''}`]);
    await runStream(governed, sessionId);
  }, [input, stream.loading, apiCalls, runStream, sessionId, sandboxMode]);

  const saveBlockToSandbox = useCallback((block: CodeBlock) => {
    const ext  = block.lang === 'typescript' ? 'ts' : block.lang === 'python' ? 'py' : block.lang;
    const name = block.filename ?? `snippet_${Date.now()}.${ext}`;
    const f: SandboxFile = { id: `f_${Date.now()}`, name, lang: block.lang, content: block.code, createdAt: Date.now(), modifiedAt: Date.now() };
    setSandboxFiles(prev => [...prev, f]);
    setActiveFileId(f.id); setSandboxOpen(true);
    setTerminalLog(prev => [...prev, `✓ saved ${name}`]);
    toast.push(`Saved ${name}`, 'success');
  }, [toast]);

  const createNewFile = useCallback((name: string) => {
    const n = name.trim() || `untitled_${Date.now()}.ts`;
    const f: SandboxFile = { id: `f_${Date.now()}`, name: n, lang: langFromName(n), content: `// ${n}\n`, createdAt: Date.now(), modifiedAt: Date.now() };
    setSandboxFiles(prev => [...prev, f]); setActiveFileId(f.id);
  }, []);

  const updateFile  = useCallback((id: string, content: string) => {
    setSandboxFiles(prev => prev.map(f => f.id === id ? { ...f, content, modifiedAt: Date.now() } : f));
  }, []);

  const deleteFile  = useCallback((id: string) => {
    setSandboxFiles(prev => { const n = prev.filter(f => f.id !== id); setActiveFileId(n[n.length - 1]?.id ?? null); return n; });
  }, []);

  const hcfg      = HEALTH[liveHealth] ?? HEALTH.OPTIMAL;
  const isStreaming = stream.loading;
  const arc        = useMemo(() => buildSessionArc(turns), [turns]);
  const callsLeft  = MAX_CALLS - apiCalls;

  return (
    <>
      <style>{`
        @keyframes lex-blink   { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes lex-breathe { 0%,100%{opacity:.5} 50%{opacity:1} }
        .lex-cursor { animation: lex-blink   0.9s step-end infinite; }
        .lex-pulse  { animation: lex-breathe 2.4s ease-in-out infinite; }
        ::-webkit-scrollbar { display: none; }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        textarea { font-size: 16px !important; }
      `}</style>

      <div className="h-[100dvh] flex flex-col overflow-hidden"
        style={{ background: G.bg, fontFamily: "'JetBrains Mono','SF Mono',ui-monospace,monospace", color: G.text }}>

        {/* ═══════════════════════ HEADER ═══════════════════════ */}
        <header className="flex-shrink-0 z-40"
          style={{ background: G.bg, borderBottom: `1px solid ${G.border}` }}>

          {/* Top bar */}
          <div className="flex items-center h-12 px-4 gap-3">
            {/* Brand */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Link href="/"
                className="flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 active:scale-90 transition-transform"
                style={{ color: G.textDim, background: G.surface, border: `1px solid ${G.border}` }}>
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                  <path d="M7 2L3 5L7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>

              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[11px] font-mono font-bold tracking-widest uppercase flex-shrink-0"
                  style={{ color: G.gold }}>Lex Aureon</span>
                <span className="text-[9px] font-mono px-1.5 py-px rounded flex-shrink-0"
                  style={{ color: G.textDim, background: G.surface, border: `1px solid ${G.border}` }}>
                  v2
                </span>
              </div>

              {/* Live M badge */}
              {liveM !== null && (
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-mono flex-shrink-0 ml-1"
                  style={{
                    color: hcfg.color, background: hcfg.bg,
                    border: `1px solid ${hcfg.color}20`,
                    transition: 'all 0.4s',
                  }}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: hcfg.color, animation: isStreaming ? 'lex-blink 1s step-end infinite' : 'none' }} />
                  <span>M={liveM.toFixed(3)}</span>
                  {isStreaming && <span style={{ color: hcfg.color, opacity: 0.6 }}>·</span>}
                  {isStreaming && <span className="text-[9px]">live</span>}
                </div>
              )}
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {/* Sandbox toggle */}
              <button onClick={() => setSandboxOpen(s => !s)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono transition-all active:scale-95"
                style={{
                  color: sandboxOpen ? '#38bdf8' : G.textDim,
                  background: sandboxOpen ? '#38bdf808' : 'transparent',
                  border: `1px solid ${sandboxOpen ? '#38bdf820' : G.border}`,
                }}>
                <span>{'</>'}</span>
                {sandboxFiles.length > 0 && (
                  <span className="text-[9px]" style={{ color: '#38bdf8' }}>{sandboxFiles.length}</span>
                )}
              </button>

              {/* Call counter */}
              <div className="text-[10px] font-mono tabular-nums px-2 py-1.5 rounded-lg"
                style={{
                  color: callsLeft <= 3 ? '#f59e0b' : G.textDim,
                  background: G.surface, border: `1px solid ${G.border}`,
                }}>
                {callsLeft}/{MAX_CALLS}
              </div>

              {/* Self-test */}
              <button onClick={() => void runSelfTest()} disabled={selfTestLoading}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-all active:scale-95 disabled:opacity-40"
                style={{ color: G.R, background: G.surface, border: `1px solid ${G.border}` }}
                title="Run self-test">
                <span className="text-[11px]">{selfTestLoading ? '…' : '⊕'}</span>
              </button>

              {/* Upgrade */}
              <button onClick={() => setShowUpgrade(true)}
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-mono transition-all active:scale-95"
                style={{ color: G.gold, background: `${G.gold}08`, border: `1px solid ${G.gold}20` }}>
                pro
              </button>
            </div>
          </div>

          {/* Mode tabs */}
          <div className="flex border-t" style={{ borderColor: G.border }}>
            {MODES.map(m => (
              <button key={m.key} onClick={() => setSandboxMode(m.key)}
                className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-mono transition-all"
                style={{
                  color: sandboxMode === m.key ? G.gold : G.textDim,
                  borderBottom: `1px solid ${sandboxMode === m.key ? G.gold : 'transparent'}`,
                  background: sandboxMode === m.key ? `${G.gold}06` : 'transparent',
                }}>
                <span style={{ opacity: sandboxMode === m.key ? 1 : 0.5 }}>{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
            <div className="flex-1 border-b" style={{ borderColor: 'transparent' }} />
          </div>
        </header>

        {/* ═══════════════════════ BODY ═══════════════════════ */}
        <div className="flex flex-1 overflow-hidden">

          {/* ── Chat column ── */}
          <div className="flex flex-col flex-1 overflow-hidden min-w-0">

            {/* Self-test result */}
            {selfTestResult && (
              <div className="flex-shrink-0 mx-4 mt-3 rounded-lg overflow-hidden"
                style={{ background: G.surface, border: `1px solid ${G.R}20` }}>
                <div className="flex items-center justify-between px-3 py-2"
                  style={{ borderBottom: `1px solid ${G.border}` }}>
                  <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: G.R }}>⊕ Self-Test</span>
                  <button onClick={() => setSelfTestResult(null)} className="text-[10px]" style={{ color: G.textDim }}>✕</button>
                </div>
                <pre className="p-3 whitespace-pre-wrap text-[11px] leading-relaxed font-mono max-h-48 overflow-y-auto"
                  style={{ color: '#86efac', scrollbarWidth: 'thin', scrollbarColor: `${G.border} transparent` }}>
                  {selfTestResult}
                </pre>
              </div>
            )}

            {/* Thread */}
            <main className="flex-1 overflow-y-auto py-5 px-4 space-y-5"
              style={{ scrollbarWidth: 'none' }}>
              {!turns.length
                ? <EmptyState mode={sandboxMode} />
                : turns.map(turn => (
                  <MessageBubble key={turn.id} turn={turn}
                    isLatest={turn.id === currentLexId}
                    streaming={isStreaming && turn.id === currentLexId}
                    partialOutput={stream.partialOutput}
                    openTab={openTabs[turn.id] ?? null}
                    onOpenTab={tab => setOpenTabs(prev => ({ ...prev, [turn.id]: tab }))}
                    onSaveBlock={saveBlockToSandbox}
                    sandboxMode={sandboxMode}
                  />
                ))
              }
              <div ref={bottomRef} className="h-1" />
            </main>

            {/* Footer / input area */}
            <footer className="flex-shrink-0 px-4 pt-2 pb-safe space-y-2"
              style={{
                background: G.bg,
                borderTop: `1px solid ${G.border}`,
                paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
              }}>

              {/* Suggestions */}
              {!isStreaming && showSuggestions && (
                <SuggestionBar turns={turns} activeCategory={suggCat}
                  onCategoryChange={setSuggCat}
                  onSelect={p => { setInput(p); inputRef.current?.focus(); }}
                  disabled={isStreaming} />
              )}

              {/* Input row */}
              <div className="flex items-end gap-2">
                {/* Textarea container */}
                <div className="flex-1 rounded-xl transition-all duration-200"
                  style={{
                    background: G.surface,
                    border: `1px solid ${inputFocused ? `${G.gold}35` : G.border}`,
                    boxShadow: inputFocused ? `0 0 0 3px ${G.gold}06` : 'none',
                  }}>
                  <textarea ref={inputRef} value={input}
                    onChange={e => setInput(e.target.value.slice(0, 4000))}
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
                      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
                    }}
                    placeholder={
                      sandboxMode === 'code'     ? 'Ask Lex to write code…'
                      : sandboxMode === 'research' ? 'Pose a research question…'
                      : sandboxMode === 'redteam'  ? 'Launch a constitutional probe…'
                      :                              'Message Lex Aureon…'
                    }
                    rows={1} disabled={isStreaming}
                    className="w-full bg-transparent px-3.5 py-3 resize-none focus:outline-none leading-relaxed disabled:opacity-40"
                    style={{ color: G.textBright, caretColor: G.gold, fontFamily: 'inherit', maxHeight: '160px' }} />
                </div>

                {/* Suggestions toggle */}
                <button onClick={() => setShowSuggestions(s => !s)}
                  className="flex-shrink-0 w-8 h-8 self-end mb-0.5 rounded-lg flex items-center justify-center transition-all active:scale-90"
                  style={{
                    color: showSuggestions ? G.gold : G.textDim,
                    background: G.surface, border: `1px solid ${G.border}`,
                  }}>
                  <svg width="12" height="9" viewBox="0 0 12 9" fill="none">
                    <path d="M1 1h10M1 4.5h7M1 8h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                </button>

                {/* Send / Cancel */}
                {isStreaming ? (
                  <button onClick={cancel}
                    className="flex-shrink-0 w-9 h-9 self-end mb-0.5 rounded-xl flex items-center justify-center transition-all active:scale-90"
                    style={{ background: '#1a0505', border: '1px solid #3a1010', color: '#f87171' }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                      <rect width="10" height="10" rx="2"/>
                    </svg>
                  </button>
                ) : (
                  <button onClick={() => sendMessage()} disabled={!input.trim() || apiCalls >= MAX_CALLS}
                    className="flex-shrink-0 w-9 h-9 self-end mb-0.5 rounded-xl flex items-center justify-center transition-all active:scale-90 disabled:opacity-20"
                    style={{
                      background: input.trim() ? `linear-gradient(135deg,${G.gold},${G.goldL})` : G.surface,
                      border: `1px solid ${input.trim() ? G.gold : G.border}`,
                      color: input.trim() ? '#07070d' : G.textDim,
                    }}>
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                      <path d="M7 12V2M3 6L7 2L11 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}
              </div>

              {/* Session signal */}
              {arc.interventionCount > 0 && (
                <p className="text-[9px] font-mono text-center pb-0.5" style={{ color: '#7c2d12' }}>
                  ⚡ {arc.interventionCount} correction{arc.interventionCount > 1 ? 's' : ''} this session
                </p>
              )}
            </footer>
          </div>

          {/* ── Sandbox panel ── */}
          {sandboxOpen && (
            <div className="flex-shrink-0 border-l flex flex-col overflow-hidden"
              style={{
                width: 'min(400px, 44vw)', minWidth: '260px',
                borderColor: G.border, background: G.bg,
              }}>
              <div className="flex items-center justify-between px-3 py-2.5 border-b flex-shrink-0"
                style={{ borderColor: G.border }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold" style={{ color: '#38bdf8' }}>SANDBOX</span>
                  <span className="text-[9px] font-mono" style={{ color: G.textDim }}>
                    {sandboxFiles.length} file{sandboxFiles.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button onClick={() => setSandboxOpen(false)}
                  className="w-5 h-5 rounded flex items-center justify-center text-[10px]"
                  style={{ color: G.textDim }}>✕</button>
              </div>
              <div className="flex-1 overflow-hidden">
                <SandboxPanel files={sandboxFiles} activeFileId={activeFileId} terminalLog={terminalLog}
                  onSelectFile={setActiveFileId} onUpdateFile={updateFile}
                  onNewFile={createNewFile} onDeleteFile={deleteFile} />
              </div>
            </div>
          )}
        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} callsUsed={apiCalls} />}
      {showEmail   && <EmailCapture onComplete={() => { setShowEmail(false); setTimeout(() => sendMessage(), 100); }} />}
    </>
  );
}
