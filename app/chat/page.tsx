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

/* ═══════════════════════════════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════════════════════════════ */
const MAX_CALLS = 10;

const HEALTH: Record<string, { color: string; glow: string; label: string; bg: string }> = {
  OPTIMAL:  { color: '#10b981', glow: '0 0 24px #10b98130', label: 'OPTIMAL',  bg: '#10b98112' },
  ALERT:    { color: '#f59e0b', glow: '0 0 24px #f59e0b30', label: 'ALERT',    bg: '#f59e0b12' },
  STRESSED: { color: '#f97316', glow: '0 0 24px #f9731630', label: 'STRESSED', bg: '#f9731612' },
  CRITICAL: { color: '#ef4444', glow: '0 0 24px #ef444430', label: 'CRITICAL', bg: '#ef444412' },
};

/* Sandbox mode types */
type SandboxMode = 'chat' | 'code' | 'research' | 'redteam';
type PanelView   = 'output' | 'terminal' | 'files' | 'history';
type MsgTab      = 'raw' | 'audit' | 'analysis';

/* ═══════════════════════════════════════════════════════════════════════
   SANDBOX FILE SYSTEM (in-memory)
══════════════════════════════════════════════════════════════════════ */
interface SandboxFile {
  id: string;
  name: string;
  lang: string;
  content: string;
  createdAt: number;
  modifiedAt: number;
}

function detectLang(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', sh: 'bash', json: 'json',
    md: 'markdown', css: 'css', html: 'html', sql: 'sql', yaml: 'yaml', toml: 'toml',
  };
  return map[ext] ?? 'text';
}

/* ═══════════════════════════════════════════════════════════════════════
   CODE BLOCK PARSER — extract ```lang ... ``` from Lex output
══════════════════════════════════════════════════════════════════════ */
interface CodeBlock { lang: string; code: string; filename?: string }

function parseCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const re = /```(\w+)?(?:\s+\/\/\s*(.+?))?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    blocks.push({ lang: m[1] ?? 'text', filename: m[2]?.trim(), code: m[3] });
  }
  return blocks;
}

/* ═══════════════════════════════════════════════════════════════════════
   SYNTAX HIGHLIGHT (lightweight, no deps)
══════════════════════════════════════════════════════════════════════ */
function highlight(code: string, lang: string): string {
  if (['text', 'markdown', 'md'].includes(lang)) {
    return code
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  let h = code
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Strings
  h = h.replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g,
    '<span style="color:#86efac">$1$2$1</span>');
  // Comments
  h = h.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/g,
    '<span style="color:#475569">$1</span>');
  // Keywords
  const kw = /\b(const|let|var|function|return|if|else|for|while|class|import|export|default|from|async|await|type|interface|extends|implements|new|typeof|instanceof|void|null|undefined|true|false|def|fn|pub|use|mod|struct|enum|match|in|is|not|and|or|pass|self|super)\b/g;
  h = h.replace(kw, '<span style="color:#c9a84c">$1</span>');
  // Numbers
  h = h.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#a78bfa">$1</span>');
  // Function calls
  h = h.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g,
    '<span style="color:#38bdf8">$1</span>');
  return h;
}

/* ═══════════════════════════════════════════════════════════════════════
   CRS BAR
══════════════════════════════════════════════════════════════════════ */
function CRSBar({ c, r, s, m }: { c: number; r: number; s: number; m: number }) {
  const total  = (c + r + s) || 1;
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
          <div className="flex-1 h-[3px] rounded-full" style={{ background: '#0d1220' }}>
            <div className="h-[3px] rounded-full transition-all duration-700"
              style={{ width: `${(v / total) * 100}%`, background: color, boxShadow: `0 0 6px ${color}60` }} />
          </div>
          <span className="text-[10px] font-mono w-8 text-right tabular-nums" style={{ color: '#334155' }}>{v.toFixed(2)}</span>
        </div>
      ))}
      <div className="flex items-center gap-2 pt-0.5">
        <span className="text-[10px] font-mono w-3 font-bold" style={{ color: '#c9a84c' }}>M</span>
        <div className="flex-1 h-[4px] rounded-full" style={{ background: '#0d1220' }}>
          <div className="h-[4px] rounded-full transition-all duration-700"
            style={{ width: `${m * 100}%`, background: mColor, boxShadow: `0 0 8px ${mColor}70` }} />
        </div>
        <span className="text-[10px] font-mono w-8 text-right tabular-nums font-bold" style={{ color: '#c9a84c' }}>{m.toFixed(3)}</span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   CODE VIEWER — inline inside message, with copy + save to sandbox
══════════════════════════════════════════════════════════════════════ */
const CodeViewer = memo(function CodeViewer({ block, onSave }: {
  block: CodeBlock; onSave?: (b: CodeBlock) => void;
}) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => highlight(block.code, block.lang), [block.code, block.lang]);

  function copy() {
    navigator.clipboard.writeText(block.code).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ background: '#020408', border: '1px solid #0f1629' }}>
      {/* toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5" style={{ borderBottom: '1px solid #0f1629', background: '#03050c' }}>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono" style={{ color: '#334155' }}>{block.lang}</span>
          {block.filename && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ color: '#c9a84c', background: '#c9a84c10' }}>{block.filename}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {onSave && (
            <button onClick={() => onSave(block)}
              className="text-[10px] font-mono px-2 py-0.5 rounded transition-all active:scale-95"
              style={{ color: '#10b981', background: '#10b98110', border: '1px solid #10b98125' }}>
              + sandbox
            </button>
          )}
          <button onClick={copy}
            className="text-[10px] font-mono px-2 py-0.5 rounded transition-all active:scale-95"
            style={{ color: copied ? '#10b981' : '#475569', background: copied ? '#10b98110' : 'transparent', border: '1px solid #0f1629' }}>
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
      </div>
      {/* code */}
      <pre className="p-3 text-[11px] leading-relaxed overflow-x-auto font-mono"
        style={{ color: '#94a3b8', scrollbarWidth: 'none' }}
        dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   MESSAGE CONTENT — renders text + code blocks
══════════════════════════════════════════════════════════════════════ */
function MessageContent({ text, onSaveBlock }: { text: string; onSaveBlock?: (b: CodeBlock) => void }) {
  // Split on code fences
  const parts = useMemo(() => {
    const segments: Array<{ type: 'text' | 'code'; content: string; block?: CodeBlock }> = [];
    const re = /```(\w+)?(?:\s+\/\/\s*(.+?))?\n([\s\S]*?)```/g;
    let last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) segments.push({ type: 'text', content: text.slice(last, m.index) });
      segments.push({ type: 'code', content: m[3], block: { lang: m[1] ?? 'text', filename: m[2]?.trim(), code: m[3] } });
      last = m.index + m[0].length;
    }
    if (last < text.length) segments.push({ type: 'text', content: text.slice(last) });
    return segments;
  }, [text]);

  return (
    <div>
      {parts.map((p, i) => p.type === 'text'
        ? <p key={i} className="whitespace-pre-wrap leading-relaxed" style={{ color: '#86efac' }}>{p.content}</p>
        : <CodeViewer key={i} block={p.block!} onSave={onSaveBlock} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   GOVERNANCE PANEL (tab content)
══════════════════════════════════════════════════════════════════════ */
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
          {activeTab === 'raw'      ? '// bare output'
          : activeTab === 'audit'   ? '// governance receipt'
          :                           '// constitutional state'}
        </span>
        <button onClick={onClose} className="w-5 h-5 rounded flex items-center justify-center"
          style={{ color: '#334155', background: '#0f1629' }}>✕</button>
      </div>
      <div className="p-3 space-y-2 max-h-56 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
        {activeTab === 'raw' && (
          <p className="whitespace-pre-wrap leading-relaxed" style={{ color: '#334155' }}>
            {turn.raw_output || '// blocked at pre-eval — no bare output'}
          </p>
        )}
        {activeTab === 'audit' && [
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

/* ═══════════════════════════════════════════════════════════════════════
   MESSAGE BUBBLE
══════════════════════════════════════════════════════════════════════ */
const MessageBubble = memo(function MessageBubble({ turn, isLatest, streaming, partialOutput, openTab, onOpenTab, onSaveBlock, sandboxMode }: {
  turn: ChatTurn; isLatest: boolean; streaming: boolean;
  partialOutput: string; openTab: MsgTab | null;
  onOpenTab: (tab: MsgTab | null) => void;
  onSaveBlock: (b: CodeBlock) => void;
  sandboxMode: SandboxMode;
}) {
  const hcfg   = HEALTH[turn.health_band ?? 'OPTIMAL'] ?? HEALTH.OPTIMAL;
  const isUser  = turn.role === 'user';
  const isCurrentlyStreaming = isLatest && streaming;
  const displayText = isCurrentlyStreaming ? partialOutput : (turn.governed_output ?? turn.partial ?? '');

  if (isUser) {
    return (
      <div className="flex justify-end px-3">
        <div className="max-w-[82vw] sm:max-w-lg px-4 py-3 rounded-2xl rounded-tr-md text-sm leading-relaxed"
          style={{
            background: 'linear-gradient(135deg, #0d1b35 0%, #0a1528 100%)',
            border: '1px solid #1a2d52', color: '#94a3b8',
          }}>
          {turn.content}
        </div>
      </div>
    );
  }

  const hasCode = !isCurrentlyStreaming && displayText && parseCodeBlocks(displayText).length > 0;

  return (
    <div className="flex justify-start px-3">
      <div className="w-full max-w-[90vw] sm:max-w-2xl">
        {/* Avatar row */}
        <div className="flex items-center gap-2 mb-1.5 ml-1 flex-wrap">
          <div className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] flex-shrink-0"
            style={{ background: '#c9a84c18', border: '1px solid #c9a84c30', color: '#c9a84c' }}>⬡</div>
          <span className="text-[11px] font-mono font-bold tracking-widest uppercase" style={{ color: '#c9a84c' }}>Lex Aureon</span>
          {sandboxMode !== 'chat' && (
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
              style={{ color: '#334155', background: '#0f1629', border: '1px solid #1a2040' }}>
              {sandboxMode}
            </span>
          )}
          <div className="flex items-center gap-1 flex-wrap">
            {turn.health_band && turn.health_band !== 'OPTIMAL' && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ color: hcfg.color, background: hcfg.bg, border: `1px solid ${hcfg.color}25` }}>
                {hcfg.label}
              </span>
            )}
            {turn.intervened && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ color: '#ef4444', background: '#ef444410', border: '1px solid #ef444425' }}>⚡ corrected</span>
            )}
            {turn.memory_injected && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ color: '#a855f7', background: '#a855f710', border: '1px solid #a855f725' }}>🧠 mem</span>
            )}
            {turn.attack_type && turn.attack_type !== 'none' && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ color: '#f97316', background: '#f9731610', border: '1px solid #f9731625' }}>
                🛡 {turn.attack_type}
              </span>
            )}
            {hasCode && (
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                style={{ color: '#38bdf8', background: '#38bdf810', border: '1px solid #38bdf825' }}>
                {'</>'}  code
              </span>
            )}
            {isCurrentlyStreaming && (
              <span className="text-[9px] font-mono animate-pulse" style={{ color: '#c9a84c' }}>●</span>
            )}
          </div>
        </div>

        {/* Bubble */}
        <div className="px-4 py-3.5 rounded-2xl rounded-tl-md"
          style={{
            background: '#07080f',
            border: `1px solid ${isCurrentlyStreaming ? hcfg.color + '50' : '#0f1629'}`,
            borderLeftWidth: 2,
            borderLeftColor: hcfg.color,
            boxShadow: isCurrentlyStreaming ? hcfg.glow : 'none',
            transition: 'border-color 0.4s, box-shadow 0.4s',
          }}>

          {isCurrentlyStreaming ? (
            /* Streaming: plain text, no code splitting yet */
            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: '#86efac', lineHeight: 1.7 }}>
              {partialOutput}
              <span className="inline-block w-[2px] h-[14px] align-text-bottom ml-0.5 rounded-[1px]"
                style={{ background: '#c9a84c', animation: 'term-blink 0.8s step-end infinite' }} />
            </div>
          ) : (
            /* Complete: rich content with code blocks */
            <div className="text-sm" style={{ lineHeight: 1.7 }}>
              {displayText
                ? <MessageContent text={displayText} onSaveBlock={onSaveBlock} />
                : turn.error
                  ? <span style={{ color: '#ef4444' }}>{turn.error}</span>
                  : null}
            </div>
          )}

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
});

/* ═══════════════════════════════════════════════════════════════════════
   SANDBOX PANEL — code editor + file tree + terminal log
══════════════════════════════════════════════════════════════════════ */
function SandboxPanel({ files, activeFileId, terminalLog, onSelectFile, onUpdateFile, onNewFile, onDeleteFile }: {
  files: SandboxFile[];
  activeFileId: string | null;
  terminalLog: string[];
  onSelectFile: (id: string) => void;
  onUpdateFile: (id: string, content: string) => void;
  onNewFile: () => void;
  onDeleteFile: (id: string) => void;
}) {
  const [panel, setPanel]       = useState<PanelView>('output');
  const [newFileName, setNewFileName] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);
  const activeFile = files.find(f => f.id === activeFileId);
  const termRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (panel === 'terminal') termRef.current?.scrollTo(0, termRef.current.scrollHeight);
  }, [terminalLog, panel]);

  function submitNewFile() {
    const name = newFileName.trim();
    if (!name) return;
    onNewFile();
    setNewFileName('');
    setShowNewFile(false);
  }

  return (
    <div className="flex flex-col h-full" style={{ background: '#03040a' }}>
      {/* Panel tabs */}
      <div className="flex items-center border-b flex-shrink-0" style={{ borderColor: '#0d1220', background: '#04060e' }}>
        {(['output', 'terminal', 'files', 'history'] as PanelView[]).map(v => (
          <button key={v} onClick={() => setPanel(v)}
            className="px-3 py-2 text-[10px] font-mono tracking-widest uppercase transition-all"
            style={{
              color: panel === v ? '#c9a84c' : '#334155',
              borderBottom: panel === v ? '1px solid #c9a84c' : '1px solid transparent',
            }}>{v}</button>
        ))}
        <div className="flex-1" />
        {panel === 'files' && (
          <button onClick={() => setShowNewFile(s => !s)}
            className="px-3 py-2 text-[10px] font-mono transition-all"
            style={{ color: '#10b981' }}>+ file</button>
        )}
      </div>

      {/* Panel: output / code editor */}
      {panel === 'output' && (
        <div className="flex flex-1 overflow-hidden">
          {/* File sidebar */}
          {files.length > 0 && (
            <div className="w-32 flex-shrink-0 overflow-y-auto border-r" style={{ borderColor: '#0d1220', scrollbarWidth: 'none' }}>
              {files.map(f => (
                <div key={f.id}
                  onClick={() => onSelectFile(f.id)}
                  className="flex items-center gap-1.5 px-2 py-2 cursor-pointer group"
                  style={{
                    background: f.id === activeFileId ? '#0f1629' : 'transparent',
                    borderLeft: `2px solid ${f.id === activeFileId ? '#c9a84c' : 'transparent'}`,
                  }}>
                  <span className="text-[10px] font-mono truncate flex-1" style={{ color: f.id === activeFileId ? '#c9a84c' : '#475569' }}>
                    {f.name}
                  </span>
                  <button onClick={e => { e.stopPropagation(); onDeleteFile(f.id); }}
                    className="opacity-0 group-hover:opacity-100 text-[10px] transition-opacity"
                    style={{ color: '#ef4444' }}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Code editor */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeFile ? (
              <>
                <div className="px-3 py-1.5 flex items-center gap-2 border-b flex-shrink-0"
                  style={{ borderColor: '#0d1220', background: '#04060e' }}>
                  <span className="text-[10px] font-mono" style={{ color: '#334155' }}>{activeFile.name}</span>
                  <span className="text-[10px] font-mono" style={{ color: '#1e3a5f' }}>{activeFile.lang}</span>
                </div>
                <textarea
                  value={activeFile.content}
                  onChange={e => onUpdateFile(activeFile.id, e.target.value)}
                  className="flex-1 w-full resize-none focus:outline-none p-3 text-[12px] font-mono leading-relaxed"
                  style={{
                    background: '#020408', color: '#94a3b8',
                    caretColor: '#c9a84c', scrollbarWidth: 'none',
                    tabSize: 2,
                  }}
                  spellCheck={false}
                />
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
                <span className="text-3xl">{'</>'}</span>
                <p className="text-[11px] font-mono" style={{ color: '#1e3a5f' }}>
                  No files yet. Ask Lex to write code<br />and save it to sandbox.
                </p>
                <button onClick={() => { onNewFile(); setPanel('output'); }}
                  className="text-[10px] font-mono px-3 py-1.5 rounded-lg transition-all active:scale-95"
                  style={{ color: '#10b981', background: '#10b98110', border: '1px solid #10b98125' }}>
                  + new file
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Panel: terminal */}
      {panel === 'terminal' && (
        <div ref={termRef} className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono text-[11px]"
          style={{ scrollbarWidth: 'none' }}>
          {terminalLog.length === 0 && (
            <p style={{ color: '#1e3a5f' }}>// terminal output will appear here</p>
          )}
          {terminalLog.map((line, i) => (
            <div key={i} className="leading-relaxed"
              style={{ color: line.startsWith('>>') ? '#c9a84c' : line.startsWith('✓') ? '#10b981' : line.startsWith('✗') ? '#ef4444' : '#475569' }}>
              {line}
            </div>
          ))}
          <div className="flex items-center gap-1 mt-2">
            <span style={{ color: '#c9a84c' }}>lex@sovereign:~$</span>
            <span className="inline-block w-[6px] h-[12px] ml-0.5"
              style={{ background: '#c9a84c', animation: 'term-blink 1s step-end infinite' }} />
          </div>
        </div>
      )}

      {/* Panel: files */}
      {panel === 'files' && (
        <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ scrollbarWidth: 'none' }}>
          {showNewFile && (
            <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: '#07080f', border: '1px solid #0f1629' }}>
              <input
                autoFocus
                value={newFileName}
                onChange={e => setNewFileName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitNewFile()}
                placeholder="filename.ts"
                className="flex-1 bg-transparent text-[11px] font-mono focus:outline-none"
                style={{ color: '#c9a84c', caretColor: '#c9a84c' }}
              />
              <button onClick={submitNewFile}
                className="text-[10px] font-mono px-2 py-0.5 rounded"
                style={{ color: '#10b981', background: '#10b98110' }}>create</button>
            </div>
          )}
          {files.length === 0 && !showNewFile && (
            <p className="text-[11px] font-mono text-center py-6" style={{ color: '#1e3a5f' }}>no files in sandbox</p>
          )}
          {files.map(f => (
            <div key={f.id} onClick={() => { onSelectFile(f.id); setPanel('output'); }}
              className="flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer group"
              style={{ background: f.id === activeFileId ? '#0f1629' : 'transparent', border: '1px solid transparent' }}>
              <span className="text-[10px] font-mono flex-1 truncate" style={{ color: f.id === activeFileId ? '#c9a84c' : '#475569' }}>
                {f.name}
              </span>
              <span className="text-[9px] font-mono" style={{ color: '#1e3a5f' }}>{f.lang}</span>
              <button onClick={e => { e.stopPropagation(); onDeleteFile(f.id); }}
                className="opacity-0 group-hover:opacity-100 text-[10px] transition-opacity"
                style={{ color: '#ef4444' }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Panel: history (file change log) */}
      {panel === 'history' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ scrollbarWidth: 'none' }}>
          {files.length === 0 && (
            <p className="text-[11px] font-mono" style={{ color: '#1e3a5f' }}>no history yet</p>
          )}
          {[...files].reverse().map(f => (
            <div key={f.id} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono" style={{ color: '#c9a84c' }}>{f.name}</span>
                <span className="text-[9px] font-mono" style={{ color: '#1e3a5f' }}>
                  {new Date(f.modifiedAt).toLocaleTimeString()}
                </span>
              </div>
              <p className="text-[10px] font-mono" style={{ color: '#334155' }}>
                {f.content.split('\n').length} lines · {f.content.length} chars
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SUGGESTION BAR
══════════════════════════════════════════════════════════════════════ */
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
            className="flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-mono transition-all active:scale-95"
            style={{
              color: activeCategory === cat.key ? '#07070d' : '#334155',
              background: activeCategory === cat.key ? '#c9a84c' : '#07080f',
              border: `1px solid ${activeCategory === cat.key ? '#c9a84c' : '#0f1629'}`,
            }}>{cat.label}</button>
        ))}
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {suggestions.map((s, i) => (
          <button key={i} disabled={disabled} onClick={() => !disabled && onSelect(s.prompt)} title={s.prompt}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all disabled:opacity-30 active:scale-95"
            style={{ color: '#475569', background: '#07080f', border: '1px solid #0f1629', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ color: dotColor[s.category] ?? '#475569', fontSize: 8 }}>●</span>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   EMPTY STATE
══════════════════════════════════════════════════════════════════════ */
function EmptyState({ mode }: { mode: SandboxMode }) {
  const tips: Record<SandboxMode, { icon: string; title: string; lines: string[] }> = {
    chat: {
      icon: '⬡', title: 'Sovereign Console',
      lines: ['C·R·S state carries forward every turn', 'Lyapunov-anchored — mathematically stable', 'Try a jailbreak — watch the governor hold'],
    },
    code: {
      icon: '</>', title: 'Code Sandbox',
      lines: ['Ask Lex to write any code', 'Code blocks save to the sandbox editor', 'Edit, iterate, build — all in one place'],
    },
    research: {
      icon: '∇', title: 'Research Mode',
      lines: ['Deep constitutional analysis mode', 'Formal proofs and mathematical reasoning', 'Cite and cross-reference prior turns'],
    },
    redteam: {
      icon: '🛡', title: 'Red Team Arena',
      lines: ['Adversarial prompts, zero holds barred', 'Governor holds every intervention live', 'Watch M collapse and recover in real-time'],
    },
  };
  const t = tips[mode];
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-6 py-16">
      <div className="relative">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
          style={{ background: '#c9a84c14', border: '1px solid #c9a84c22', boxShadow: '0 0 40px #c9a84c08' }}>
          {t.icon}
        </div>
        <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full"
          style={{ background: '#10b981', boxShadow: '0 0 6px #10b981', animation: 'term-blink 2s ease-in-out infinite' }} />
      </div>
      <div>
        <p className="text-sm font-mono font-bold tracking-widest uppercase" style={{ color: '#c9a84c' }}>{t.title}</p>
        <p className="text-[11px] font-mono mt-1" style={{ color: '#1e3a5f' }}>Constitutional governance · persistent context</p>
      </div>
      <div className="space-y-1.5 w-full max-w-xs text-left">
        {t.lines.map((l, i) => (
          <div key={i} className="flex items-start gap-2.5 px-3 py-2 rounded-xl"
            style={{ background: '#07080f', border: '1px solid #0f1629' }}>
            <span className="text-[10px] mt-0.5 flex-shrink-0" style={{ color: '#c9a84c' }}>—</span>
            <p className="text-[11px] font-mono" style={{ color: '#334155' }}>{l}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════════════ */
export default function ChatConsole() {
  /* ── Core state ──────────────────────────────────── */
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

  /* ── Sandbox state ───────────────────────────────── */
  const [sandboxMode, setSandboxMode]       = useState<SandboxMode>('chat');
  const [sandboxOpen, setSandboxOpen]       = useState(false);
  const [sandboxFiles, setSandboxFiles]     = useState<SandboxFile[]>([]);
  const [activeFileId, setActiveFileId]     = useState<string | null>(null);
  const [terminalLog, setTerminalLog]       = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(true);

  /* ── Refs ────────────────────────────────────────── */
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

  /* ── Persistence ─────────────────────────────────── */
  useEffect(() => {
    const s = localStorage.getItem('lex_api_calls');
    if (s) setApiCalls(parseInt(s, 10));
    // Restore sandbox files
    try {
      const f = localStorage.getItem('lex_sandbox_files');
      if (f) setSandboxFiles(JSON.parse(f));
    } catch { /* ok */ }
  }, []);

  useEffect(() => {
    localStorage.setItem('lex_api_calls', apiCalls.toString());
  }, [apiCalls]);

  useEffect(() => {
    localStorage.setItem('lex_sandbox_files', JSON.stringify(sandboxFiles));
  }, [sandboxFiles]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, stream.partialOutput]);

  useEffect(() => {
    if (!stream.metrics) return;
    setLiveM(stream.metrics.m ?? null);
    setLiveHealth(stream.metrics.health_band ?? stream.metrics.health ?? 'OPTIMAL');
  }, [stream.metrics]);

  /* ── Complete handler ────────────────────────────── */
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

    // Auto-detect code in response and log to terminal
    if (res.governed_output) {
      const blocks = parseCodeBlocks(res.governed_output);
      if (blocks.length > 0) {
        setTerminalLog(prev => [
          ...prev,
          `>> Lex generated ${blocks.length} code block(s)`,
          ...blocks.map(b => `  ✓ ${b.lang}${b.filename ? ` · ${b.filename}` : ''} (${b.code.split('\n').length} lines)`),
        ]);
        // Auto-open sandbox if code mode
        if (sandboxMode === 'code') setSandboxOpen(true);
      }
    }

    toast.push('Run complete', 'success');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.stage, stream.complete]);

  /* ── Error handler ───────────────────────────────── */
  useEffect(() => {
    if (!stream.error || !currentLexId) return;
    setTurns(prev => prev.map(t =>
      t.id === currentLexId ? { ...t, streaming: false, error: stream.error ?? 'Error' } : t,
    ));
    setCurrentLexId(null);
    setTerminalLog(prev => [...prev, `✗ Error: ${stream.error}`]);
    toast.push(stream.error, 'error');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.error]);

  /* ── Send message ────────────────────────────────── */
  const sendMessage = useCallback(async (promptOverride?: string) => {
    const rawPrompt = promptOverride ?? input;
    // Prepend mode context if not chat
    const modePrefix: Record<SandboxMode, string> = {
      chat: '',
      code: '[CODE MODE] Write clean, well-commented, production-ready code. Use code blocks with language tags. ',
      research: '[RESEARCH MODE] Provide rigorous, structured analysis with citations to the constitutional framework where relevant. ',
      redteam: '[RED TEAM MODE] You are being adversarially tested. The governor is watching. ',
    };
    const p = (modePrefix[sandboxMode] + rawPrompt).trim();
    if (!rawPrompt.trim() || stream.loading) return;
    if (apiCalls >= MAX_CALLS) { setShowUpgrade(true); return; }
    if (typeof window !== 'undefined' && !localStorage.getItem('lex_email_captured') && apiCalls === 0) {
      setShowEmail(true); return;
    }

    const userId = `u_${Date.now()}`;
    const lexId  = `l_${Date.now()}`;

    setTurns(prev => [
      ...prev,
      { id: userId, role: 'user', content: rawPrompt.trim(), timestamp: Date.now() },
      { id: lexId,  role: 'lex',  content: '', timestamp: Date.now(), streaming: true, partial: '' },
    ]);
    setCurrentLexId(lexId);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setTerminalLog(prev => [...prev, `>> ${rawPrompt.trim().slice(0, 80)}${rawPrompt.length > 80 ? '…' : ''}`]);

    await runStream(p, sessionId);
  }, [input, stream.loading, apiCalls, runStream, sessionId, sandboxMode]);

  /* ── Sandbox file ops ────────────────────────────── */
  const saveBlockToSandbox = useCallback((block: CodeBlock) => {
    const name = block.filename ?? `snippet_${Date.now()}.${block.lang === 'typescript' ? 'ts' : block.lang === 'python' ? 'py' : block.lang}`;
    const newFile: SandboxFile = {
      id: `f_${Date.now()}`,
      name,
      lang: block.lang,
      content: block.code,
      createdAt: Date.now(),
      modifiedAt: Date.now(),
    };
    setSandboxFiles(prev => [...prev, newFile]);
    setActiveFileId(newFile.id);
    setSandboxOpen(true);
    setTerminalLog(prev => [...prev, `✓ Saved ${name} to sandbox`]);
    toast.push(`Saved ${name}`, 'success');
  }, [toast]);

  const createNewFile = useCallback(() => {
    const name = `untitled_${sandboxFiles.length + 1}.ts`;
    const newFile: SandboxFile = {
      id: `f_${Date.now()}`, name,
      lang: 'typescript', content: '// New file\n',
      createdAt: Date.now(), modifiedAt: Date.now(),
    };
    setSandboxFiles(prev => [...prev, newFile]);
    setActiveFileId(newFile.id);
    setTerminalLog(prev => [...prev, `✓ Created ${name}`]);
  }, [sandboxFiles.length]);

  const updateFile = useCallback((id: string, content: string) => {
    setSandboxFiles(prev => prev.map(f => f.id === id ? { ...f, content, modifiedAt: Date.now() } : f));
  }, []);

  const deleteFile = useCallback((id: string) => {
    setSandboxFiles(prev => {
      const updated = prev.filter(f => f.id !== id);
      setActiveFileId(updated[updated.length - 1]?.id ?? null);
      return updated;
    });
  }, []);

  /* ── Derived ─────────────────────────────────────── */
  const hcfg       = HEALTH[liveHealth] ?? HEALTH.OPTIMAL;
  const isStreaming = stream.loading;
  const arc         = useMemo(() => buildSessionArc(turns), [turns]);
  const callsLeft   = MAX_CALLS - apiCalls;

  /* ═══════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════ */
  return (
    <>
      <style>{`
        @keyframes term-blink { 0%,100%{opacity:1} 50%{opacity:0} }
        ::-webkit-scrollbar { display: none; }
        * { -webkit-tap-highlight-color: transparent; }
        textarea { font-size: 16px !important; }
      `}</style>

      <div className="h-[100dvh] flex flex-col overflow-hidden"
        style={{ background: '#04060e', fontFamily: "'JetBrains Mono','SF Mono','Fira Code',ui-monospace,monospace" }}>

        {/* ══════════════════════════════════════════
            HEADER
        ══════════════════════════════════════════ */}
        <header className="flex-shrink-0 z-40"
          style={{ background: '#06070f', borderBottom: '1px solid #0d1220' }}>

          {/* Top row */}
          <div className="flex items-center justify-between h-11 px-3">
            <div className="flex items-center gap-2.5">
              <Link href="/"
                className="flex items-center justify-center w-7 h-7 rounded-lg transition-all active:scale-90 flex-shrink-0"
                style={{ color: '#334155', background: '#0a0d18', border: '1px solid #0f1629' }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M7 2L3 5L7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
              <span className="text-[11px] font-mono font-bold tracking-[0.15em] uppercase" style={{ color: '#c9a84c' }}>
                Lex Aureon
              </span>
              {/* Live M badge */}
              {liveM !== null && (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-mono"
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
            </div>

            <div className="flex items-center gap-1.5">
              {/* Sandbox toggle */}
              <button onClick={() => setSandboxOpen(s => !s)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono transition-all active:scale-95"
                style={{
                  color: sandboxOpen ? '#38bdf8' : '#334155',
                  background: sandboxOpen ? '#38bdf810' : '#07080f',
                  border: `1px solid ${sandboxOpen ? '#38bdf825' : '#0f1629'}`,
                }}>
                <span>{'</>'}</span>
                <span className="hidden sm:block">sandbox</span>
                {sandboxFiles.length > 0 && (
                  <span className="w-4 h-4 rounded-full text-[9px] flex items-center justify-center"
                    style={{ background: '#38bdf820', color: '#38bdf8' }}>{sandboxFiles.length}</span>
                )}
              </button>
              <span className="text-[10px] font-mono" style={{ color: callsLeft <= 3 ? '#f59e0b' : '#1e3a5f' }}>
                {callsLeft}/{MAX_CALLS}
              </span>
              <button onClick={() => setShowUpgrade(true)}
                className="text-[10px] px-2 py-1 rounded-lg font-mono transition-all active:scale-95"
                style={{ color: '#c9a84c', background: '#c9a84c0a', border: '1px solid #c9a84c20' }}>pro</button>
            </div>
          </div>

          {/* Mode bar */}
          <div className="flex items-center gap-0 border-t overflow-x-auto" style={{ borderColor: '#0d1220', scrollbarWidth: 'none' }}>
            {([
              { key: 'chat',     label: '⬡ Chat',      desc: 'sovereign' },
              { key: 'code',     label: '</> Code',    desc: 'sandbox'   },
              { key: 'research', label: '∇ Research',  desc: 'analysis'  },
              { key: 'redteam',  label: '🛡 Red Team', desc: 'adversarial' },
            ] as { key: SandboxMode; label: string; desc: string }[]).map(m => (
              <button key={m.key} onClick={() => setSandboxMode(m.key)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono flex-shrink-0 transition-all"
                style={{
                  color: sandboxMode === m.key ? '#c9a84c' : '#334155',
                  borderBottom: sandboxMode === m.key ? '1px solid #c9a84c' : '1px solid transparent',
                  background: sandboxMode === m.key ? '#c9a84c08' : 'transparent',
                }}>
                {m.label}
              </button>
            ))}
          </div>
        </header>

        {/* ══════════════════════════════════════════
            MAIN BODY — chat + optional sandbox panel
        ══════════════════════════════════════════ */}
        <div className="flex flex-1 overflow-hidden">

          {/* Chat thread */}
          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            <main className="flex-1 overflow-y-auto py-4 space-y-4" style={{ scrollbarWidth: 'none' }}>
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
              <div ref={bottomRef} className="h-2" />
            </main>

            {/* ── Footer ──────────────────────────────── */}
            <footer className="flex-shrink-0 px-3 pt-2 space-y-2"
              style={{
                background: '#06070f',
                borderTop: '1px solid #0d1220',
                paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
              }}>

              {/* Suggestion bar — hidden while streaming or if dismissed */}
              {!isStreaming && showSuggestions && (
                <SuggestionBar
                  turns={turns} activeCategory={suggCat}
                  onCategoryChange={setSuggCat}
                  onSelect={p => { setInput(p); inputRef.current?.focus(); }}
                  disabled={isStreaming}
                />
              )}

              {/* Input row */}
              <div className="flex items-end gap-2">
                {/* Mode indicator pill */}
                <div className="flex-shrink-0 self-center px-2 py-1 rounded-lg text-[10px] font-mono hidden sm:block"
                  style={{ color: '#334155', background: '#07080f', border: '1px solid #0f1629' }}>
                  {sandboxMode}
                </div>

                <div className="flex-1 relative rounded-2xl transition-all duration-200"
                  style={{
                    background: '#07080f',
                    border: `1px solid ${inputFocused ? '#c9a84c30' : '#0f1629'}`,
                    boxShadow: inputFocused ? '0 0 0 3px #c9a84c08' : 'none',
                  }}>
                  <textarea
                    ref={inputRef}
                    value={input}
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
                      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
                    }}
                    placeholder={sandboxMode === 'code'
                      ? 'Ask Lex to write code…'
                      : sandboxMode === 'research'
                        ? 'Pose a research question…'
                        : sandboxMode === 'redteam'
                          ? 'Launch an adversarial prompt…'
                          : 'Message Lex Aureon…'}
                    rows={1}
                    disabled={isStreaming}
                    className="w-full bg-transparent px-4 py-3 text-sm resize-none focus:outline-none leading-relaxed disabled:opacity-40"
                    style={{ color: '#94a3b8', caretColor: '#c9a84c', fontFamily: 'inherit', maxHeight: '160px' }}
                  />
                </div>

                {/* Suggestions toggle */}
                <button onClick={() => setShowSuggestions(s => !s)}
                  className="flex-shrink-0 w-8 h-8 self-end mb-1 rounded-lg flex items-center justify-center transition-all active:scale-90"
                  style={{
                    color: showSuggestions ? '#c9a84c' : '#334155',
                    background: '#07080f',
                    border: `1px solid ${showSuggestions ? '#c9a84c20' : '#0f1629'}`,
                  }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M1 3h10M1 6h7M1 9h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>

                {/* Send / Cancel */}
                {isStreaming ? (
                  <button onClick={cancel}
                    className="flex-shrink-0 w-10 h-10 self-end mb-0.5 rounded-full flex items-center justify-center transition-all active:scale-90"
                    style={{ background: '#1a0505', border: '1px solid #7f1d1d', color: '#f87171' }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                      <rect width="10" height="10" rx="1.5"/>
                    </svg>
                  </button>
                ) : (
                  <button onClick={() => sendMessage()} disabled={!input.trim() || apiCalls >= MAX_CALLS}
                    className="flex-shrink-0 w-10 h-10 self-end mb-0.5 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-20"
                    style={{
                      background: input.trim() && apiCalls < MAX_CALLS
                        ? 'linear-gradient(135deg, #c9a84c 0%, #e8c96d 100%)'
                        : '#07080f',
                      border: `1px solid ${input.trim() && apiCalls < MAX_CALLS ? '#c9a84c' : '#0f1629'}`,
                      color: input.trim() && apiCalls < MAX_CALLS ? '#07070d' : '#334155',
                      boxShadow: input.trim() ? '0 0 16px #c9a84c28' : 'none',
                    }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M7 12V2M3 6L7 2L11 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                )}
              </div>

              {/* Session signals */}
              {arc.interventionCount > 0 && (
                <p className="text-[10px] font-mono text-center pb-1" style={{ color: '#7c2d12' }}>
                  ⚡ {arc.interventionCount} constitutional correction{arc.interventionCount > 1 ? 's' : ''} this session
                </p>
              )}
            </footer>
          </div>

          {/* ══════════════════════════════════════════
              SANDBOX PANEL (slide in from right on desktop, bottom sheet on mobile)
          ══════════════════════════════════════════ */}
          {sandboxOpen && (
            <div className="flex-shrink-0 border-l overflow-hidden flex flex-col"
              style={{
                width: 'clamp(280px, 40vw, 520px)',
                borderColor: '#0d1220',
                background: '#03040a',
              }}>
              {/* Sandbox header */}
              <div className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0"
                style={{ borderColor: '#0d1220', background: '#04060e' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono font-bold" style={{ color: '#38bdf8' }}>SANDBOX</span>
                  <span className="text-[10px] font-mono" style={{ color: '#1e3a5f' }}>
                    {sandboxFiles.length} file{sandboxFiles.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button onClick={() => setSandboxOpen(false)}
                  className="w-5 h-5 rounded flex items-center justify-center text-[10px]"
                  style={{ color: '#334155', background: '#0f1629' }}>✕</button>
              </div>
              <div className="flex-1 overflow-hidden">
                <SandboxPanel
                  files={sandboxFiles}
                  activeFileId={activeFileId}
                  terminalLog={terminalLog}
                  onSelectFile={setActiveFileId}
                  onUpdateFile={updateFile}
                  onNewFile={createNewFile}
                  onDeleteFile={deleteFile}
                />
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
