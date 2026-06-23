'use client';

import {
  useState, useEffect, useRef, useCallback, useMemo, memo,
} from 'react';
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
   SOVEREIGN V2 — FRONTIER-GRADE INTERFACE
   
   Features:
   - Real file I/O (read/write repo files)
   - Code execution (Python, Node.js, Bash)
   - Tool call transparency (CRS state, receipts)
   - Constitutional governance on all operations
═══════════════════════════════════════════════════════════════════════ */

const MAX_CALLS = 10;

const HEALTH: Record<string, { color: string; glow: string; label: string; bg: string }> = {
  OPTIMAL:  { color: '#10b981', glow: '0 0 24px #10b98130', label: 'OPTIMAL',  bg: '#10b98112' },
  ALERT:    { color: '#f59e0b', glow: '0 0 24px #f59e0b30', label: 'ALERT',    bg: '#f59e0b12' },
  STRESSED: { color: '#f97316', glow: '0 0 24px #f9731630', label: 'STRESSED', bg: '#f9731612' },
  CRITICAL: { color: '#ef4444', glow: '0 0 24px #ef444430', label: 'CRITICAL', bg: '#ef444412' },
};

type SandboxMode = 'chat' | 'code' | 'research' | 'redteam';
type PanelView   = 'output' | 'terminal' | 'files' | 'history';
type MsgTab      = 'raw' | 'audit' | 'analysis';

interface SandboxFile {
  id: string;
  name: string;
  path: string;
  lang: string;
  content: string;
  createdAt: number;
  modifiedAt: number;
  isRepo: boolean; // true if from real repo, false if in-memory
}

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied' | 'executing' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
  crs?: { C: number; R: number; S: number; M: number; risk_level: string };
  receipt_id?: string;
  reason?: string;
}

interface TerminalLine {
  id: string;
  type: 'input' | 'output' | 'error' | 'success' | 'info';
  text: string;
  timestamp: number;
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
   CODE BLOCK PARSER
═══════════════════════════════════════════════════════════════════════ */
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
   SYNTAX HIGHLIGHT
═══════════════════════════════════════════════════════════════════════ */
function highlight(code: string, lang: string): string {
  if (['text', 'markdown', 'md'].includes(lang)) {
    return code
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  let h = code
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  h = h.replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g,
    '<span style="color:#86efac">$1$2$1</span>');
  h = h.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/g,
    '<span style="color:#475569">$1</span>');
  const kw = /\b(const|let|var|function|return|if|else|for|while|class|import|export|default|from|async|await|type|interface|extends|implements|new|typeof|instanceof|void|null|undefined|true|false|def|fn|pub|use|mod|struct|enum|match|in|is|not|and|or|pass|self|super)\b/g;
  h = h.replace(kw, '<span style="color:#c9a84c">$1</span>');
  h = h.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#a78bfa">$1</span>');
  h = h.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g,
    '<span style="color:#38bdf8">$1</span>');
  return h;
}

/* ═══════════════════════════════════════════════════════════════════════
   CRS BAR
═══════════════════════════════════════════════════════════════════════ */
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
   CODE VIEWER
═══════════════════════════════════════════════════════════════════════ */
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
              → execute
            </button>
          )}
          <button onClick={copy}
            className="text-[10px] font-mono px-2 py-0.5 rounded transition-all active:scale-95"
            style={{ color: copied ? '#10b981' : '#475569', background: copied ? '#10b98110' : 'transparent', border: '1px solid #0f1629' }}>
            {copied ? 'copied' : 'copy'}
          </button>
        </div>
      </div>
      <pre className="p-3 text-[11px] leading-relaxed overflow-x-auto font-mono"
        style={{ color: '#94a3b8', scrollbarWidth: 'none' }}
        dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   MESSAGE CONTENT
═══════════════════════════════════════════════════════════════════════ */
function MessageContent({ text, onExecuteBlock }: { text: string; onExecuteBlock?: (b: CodeBlock) => void }) {
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
        : <CodeViewer key={i} block={p.block!} onSave={onExecuteBlock} />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   TOOL CALL PANEL
═══════════════════════════════════════════════════════════════════════ */
const ToolCallPanel = memo(function ToolCallPanel({ tool }: { tool: ToolCall }) {
  const statusColor = {
    pending: '#f59e0b',
    approved: '#10b981',
    denied: '#ef4444',
    executing: '#3b82f6',
    completed: '#10b981',
    failed: '#ef4444',
  }[tool.status] ?? '#475569';

  return (
    <div className="mt-2 rounded-lg p-2.5" style={{ background: '#07080f', border: `1px solid ${statusColor}30` }}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span style={{ color: statusColor, fontSize: '10px' }}>●</span>
          <span className="text-[10px] font-mono font-bold" style={{ color: '#c9a84c' }}>{tool.name}</span>
          <span className="text-[10px] font-mono" style={{ color: '#334155' }}>{tool.status}</span>
        </div>
        <span className="text-[10px] font-mono" style={{ color: '#1e3a5f' }}>{tool.receipt_id}</span>
      </div>

      {tool.reason && (
        <p className="text-[9px] font-mono mb-1.5" style={{ color: '#475569' }}>
          {tool.reason}
        </p>
      )}

      {tool.crs && (
        <div className="flex gap-2 text-[9px] font-mono mb-1.5">
          <span style={{ color: '#3b82f6' }}>C:{tool.crs.C.toFixed(2)}</span>
          <span style={{ color: '#10b981' }}>R:{tool.crs.R.toFixed(2)}</span>
          <span style={{ color: '#f59e0b' }}>S:{tool.crs.S.toFixed(2)}</span>
          <span style={{ color: '#c9a84c' }}>M:{tool.crs.M.toFixed(2)}</span>
          <span style={{ color: tool.crs.risk_level === 'LOW' ? '#10b981' : tool.crs.risk_level === 'MEDIUM' ? '#f59e0b' : '#ef4444' }}>
            {tool.crs.risk_level}
          </span>
        </div>
      )}

      {tool.result && (
        <div className="text-[9px] font-mono p-1.5 rounded" style={{ background: '#020408', color: '#94a3b8' }}>
          <pre className="whitespace-pre-wrap break-words">{JSON.stringify(tool.result, null, 2).slice(0, 200)}</pre>
        </div>
      )}

      {tool.error && (
        <div className="text-[9px] font-mono p-1.5 rounded" style={{ background: '#1a0505', color: '#f87171' }}>
          {tool.error}
        </div>
      )}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   MESSAGE BUBBLE
═══════════════════════════════════════════════════════════════════════ */
const MessageBubble = memo(function MessageBubble({
  turn, isLatest, streaming, partialOutput, openTab, onOpenTab, onExecuteBlock, sandboxMode,
}: {
  turn: ChatTurn; isLatest: boolean; streaming: boolean; partialOutput: string;
  openTab: MsgTab | null; onOpenTab: (tab: MsgTab | null) => void;
  onExecuteBlock?: (b: CodeBlock) => void; sandboxMode: SandboxMode;
}) {
  const isCurrentlyStreaming = isLatest && streaming;
  const displayText = isCurrentlyStreaming ? partialOutput : turn.governed_output;

  return (
    <div className="space-y-2">
      <div className="flex gap-2 justify-end">
        <div className="max-w-2xl rounded-2xl px-4 py-3" style={{ background: '#07080f', border: '1px solid #0f1629' }}>
          <MessageContent text={displayText} onExecuteBlock={onExecuteBlock} />

          {turn.tool_calls && turn.tool_calls.length > 0 && (
            <div className="mt-2 space-y-1">
              {turn.tool_calls.map(tc => (
                <ToolCallPanel key={tc.id} tool={tc} />
              ))}
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
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════
   TERMINAL OUTPUT
═══════════════════════════════════════════════════════════════════════ */
function TerminalOutput({ lines }: { lines: TerminalLine[] }) {
  const termRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    termRef.current?.scrollTo(0, termRef.current.scrollHeight);
  }, [lines]);

  const typeColor = (type: string) => {
    switch (type) {
      case 'input': return '#c9a84c';
      case 'output': return '#94a3b8';
      case 'error': return '#f87171';
      case 'success': return '#10b981';
      case 'info': return '#38bdf8';
      default: return '#475569';
    }
  };

  return (
    <div ref={termRef} className="flex-1 overflow-y-auto p-3 space-y-0.5 font-mono text-[11px]"
      style={{ scrollbarWidth: 'none', background: '#020408' }}>
      {lines.length === 0 && (
        <p style={{ color: '#1e3a5f' }}>// terminal ready</p>
      )}
      {lines.map(line => (
        <div key={line.id} className="leading-relaxed" style={{ color: typeColor(line.type) }}>
          {line.type === 'input' && <span style={{ color: '#c9a84c' }}>$ </span>}
          {line.type === 'success' && <span style={{ color: '#10b981' }}>✓ </span>}
          {line.type === 'error' && <span style={{ color: '#f87171' }}>✗ </span>}
          {line.type === 'info' && <span style={{ color: '#38bdf8' }}>ℹ </span>}
          {line.text}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   FILE BROWSER
═══════════════════════════════════════════════════════════════════════ */
function FileBrowser({ files, activeFileId, onSelectFile, onRefresh }: {
  files: SandboxFile[];
  activeFileId: string | null;
  onSelectFile: (id: string) => void;
  onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const repoFiles = files.filter(f => f.isRepo);
  const localFiles = files.filter(f => !f.isRepo);

  return (
    <div className="flex-1 overflow-y-auto p-2 space-y-1" style={{ scrollbarWidth: 'none' }}>
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-mono font-bold" style={{ color: '#c9a84c' }}>REPO</span>
        <button onClick={onRefresh} className="text-[10px] font-mono" style={{ color: '#38bdf8' }}>↻</button>
      </div>
      {repoFiles.map(f => (
        <div key={f.id} onClick={() => onSelectFile(f.id)}
          className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer group"
          style={{ background: f.id === activeFileId ? '#0f1629' : 'transparent' }}>
          <span className="text-[10px] font-mono flex-1 truncate" style={{ color: f.id === activeFileId ? '#c9a84c' : '#475569' }}>
            {f.name}
          </span>
          <span className="text-[9px] font-mono" style={{ color: '#1e3a5f' }}>{f.lang}</span>
        </div>
      ))}

      {localFiles.length > 0 && (
        <>
          <div className="text-[10px] font-mono font-bold mt-2" style={{ color: '#38bdf8' }}>LOCAL</div>
          {localFiles.map(f => (
            <div key={f.id} onClick={() => onSelectFile(f.id)}
              className="flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer"
              style={{ background: f.id === activeFileId ? '#0f1629' : 'transparent' }}>
              <span className="text-[10px] font-mono flex-1 truncate" style={{ color: f.id === activeFileId ? '#c9a84c' : '#475569' }}>
                {f.name}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════ */
export default function SovereignChatV2() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sandboxMode, setSandboxMode] = useState<SandboxMode>('chat');
  const [sandboxFiles, setSandboxFiles] = useState<SandboxFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const [openTabs, setOpenTabs] = useState<Record<string, MsgTab | null>>({});
  const [apiCalls, setApiCalls] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [sandboxOpen, setSandboxOpen] = useState(true);
  const [panelView, setPanelView] = useState<PanelView>('terminal');

  const stream = useLexStream();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionId = useMemo(() => `session_${Date.now()}`, []);

  const arc = useMemo(() => buildSessionArc(turns), [turns]);
  const callsLeft = MAX_CALLS - apiCalls;

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, stream.state.partialOutput]);

  // Send message
  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming || apiCalls >= MAX_CALLS) return;

    const userTurn: ChatTurn = {
      id: `turn_${Date.now()}_user`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    };

    setTurns(prev => [...prev, userTurn]);
    setInput('');
    setIsStreaming(true);
    setApiCalls(prev => prev + 1);

    try {
      await stream.run(input, sessionId);
      const lexTurn: ChatTurn = {
        id: `turn_${Date.now()}_lex`,
        role: 'lex',
        content: stream.state.partialOutput,
        governed_output: stream.state.partialOutput,
        raw_output: stream.state.rawOutput,
        timestamp: Date.now(),
        C: stream.state.metrics?.c_measured,
        R: stream.state.metrics?.r_measured,
        S: stream.state.metrics?.s_measured,
        M: stream.state.metrics?.m_measured,
        health_band: stream.state.complete?.health_band,
        complete: stream.state.complete,
      };
      setTurns(prev => [...prev, lexTurn]);
    } catch (e) {
      console.error('Stream error:', e);
      setTerminalLines(prev => [...prev, {
        id: `line_${Date.now()}`,
        type: 'error',
        text: `Error: ${e instanceof Error ? e.message : 'Unknown error'}`,
        timestamp: Date.now(),
      }]);
    } finally {
      setIsStreaming(false);
      stream.reset();
    }
  }, [input, isStreaming, apiCalls, stream, sessionId]);

  const cancel = useCallback(() => {
    stream.cancel();
    setIsStreaming(false);
  }, [stream]);

  const executeCode = useCallback((block: CodeBlock) => {
    if (block.lang !== 'python' && block.lang !== 'bash' && block.lang !== 'javascript') {
      setTerminalLines(prev => [...prev, {
        id: `line_${Date.now()}`,
        type: 'error',
        text: `Unsupported language: ${block.lang}`,
        timestamp: Date.now(),
      }]);
      return;
    }

    setTerminalLines(prev => [...prev, {
      id: `line_${Date.now()}`,
      type: 'input',
      text: `execute ${block.lang} (${(block.code.length / 1024).toFixed(1)}kb)`,
      timestamp: Date.now(),
    }]);

    // TODO: Implement real execution via /api/tools/execute
    setTerminalLines(prev => [...prev, {
      id: `line_${Date.now()}`,
      type: 'info',
      text: 'Code execution coming soon — tool gateway in progress',
      timestamp: Date.now(),
    }]);
  }, []);

  const currentLexId = turns.filter(t => t.role === 'lex').pop()?.id ?? null;

  return (
    <>
      <div className="flex flex-col h-screen" style={{ background: '#06070f' }}>
        {/* Header */}
        <header className="flex-shrink-0 border-b px-4 py-3 space-y-2" style={{ borderColor: '#0d1220', background: '#04060e' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold" style={{ color: '#c9a84c' }}>Lex Aureon Sovereign v2</span>
              <span className="text-xs font-mono" style={{ color: '#1e3a5f' }}>frontier-grade interface</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setSandboxOpen(!sandboxOpen)}
                className="text-[10px] font-mono px-2 py-1 rounded"
                style={{ color: '#38bdf8', background: '#38bdf810', border: '1px solid #38bdf820' }}>
                {sandboxOpen ? '◀ hide' : '▶ show'} sandbox
              </button>
              <span className="text-[10px] font-mono" style={{ color: callsLeft <= 3 ? '#f59e0b' : '#1e3a5f' }}>
                {callsLeft}/{MAX_CALLS}
              </span>
            </div>
          </div>

          {/* Mode bar */}
          <div className="flex items-center gap-0 border-t overflow-x-auto" style={{ borderColor: '#0d1220', scrollbarWidth: 'none' }}>
            {([
              { key: 'chat', label: '⬡ Chat' },
              { key: 'code', label: '</> Code' },
              { key: 'research', label: '∇ Research' },
              { key: 'redteam', label: '🛡 Red Team' },
            ] as { key: SandboxMode; label: string }[]).map(m => (
              <button key={m.key} onClick={() => setSandboxMode(m.key)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono flex-shrink-0 transition-all"
                style={{
                  color: sandboxMode === m.key ? '#c9a84c' : '#334155',
                  borderBottom: sandboxMode === m.key ? '1px solid #c9a84c' : '1px solid transparent',
                }}>
                {m.label}
              </button>
            ))}
          </div>
        </header>

        {/* Main body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Chat thread */}
          <div className="flex flex-col flex-1 overflow-hidden min-w-0">
            <main className="flex-1 overflow-y-auto py-4 space-y-4 px-4" style={{ scrollbarWidth: 'none' }}>
              {!turns.length && (
                <div className="flex flex-col items-center justify-center h-full gap-5 text-center">
                  <div className="text-4xl">⬡</div>
                  <div>
                    <h2 className="text-lg font-bold" style={{ color: '#c9a84c' }}>Sovereign Console</h2>
                    <p className="text-sm" style={{ color: '#475569' }}>Constitutional AI with real file I/O and code execution</p>
                  </div>
                </div>
              )}
              {turns.map(turn => (
                turn.role === 'user' ? (
                  <div key={turn.id} className="flex gap-2 justify-start">
                    <div className="max-w-2xl rounded-2xl px-4 py-3" style={{ background: '#0f1629', border: '1px solid #1e3a5f' }}>
                      <p className="whitespace-pre-wrap leading-relaxed" style={{ color: '#94a3b8' }}>{turn.content}</p>
                    </div>
                  </div>
                ) : (
                  <MessageBubble key={turn.id} turn={turn}
                    isLatest={turn.id === currentLexId}
                    streaming={isStreaming && turn.id === currentLexId}
                    partialOutput={stream.state.partialOutput}
                    openTab={openTabs[turn.id] ?? null}
                    onOpenTab={tab => setOpenTabs(prev => ({ ...prev, [turn.id]: tab }))}
                    onExecuteBlock={executeCode}
                    sandboxMode={sandboxMode}
                  />
                )
              ))}
              <div ref={bottomRef} className="h-2" />
            </main>

            {/* Footer */}
            <footer className="flex-shrink-0 px-4 pt-2 pb-4 space-y-2" style={{ borderTop: '1px solid #0d1220' }}>
              <div className="flex items-end gap-2">
                <div className="flex-1 relative rounded-2xl transition-all duration-200"
                  style={{
                    background: '#07080f',
                    border: `1px solid ${inputFocused ? '#c9a84c30' : '#0f1629'}`,
                  }}>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => setInput(e.target.value.slice(0, 4000))}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => setInputFocused(false)}
                    onKeyDown={e => {
                      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && input.trim() && !isStreaming) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder="Message Lex Aureon…"
                    rows={1}
                    disabled={isStreaming}
                    className="w-full bg-transparent px-4 py-3 text-sm resize-none focus:outline-none leading-relaxed disabled:opacity-40"
                    style={{ color: '#94a3b8', caretColor: '#c9a84c' }}
                  />
                </div>

                {isStreaming ? (
                  <button onClick={cancel}
                    className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all"
                    style={{ background: '#1a0505', border: '1px solid #7f1d1d', color: '#f87171' }}>
                    ⏹
                  </button>
                ) : (
                  <button onClick={() => sendMessage()} disabled={!input.trim() || apiCalls >= MAX_CALLS}
                    className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-20"
                    style={{
                      background: input.trim() && apiCalls < MAX_CALLS ? 'linear-gradient(135deg, #c9a84c 0%, #e8c96d 100%)' : '#07080f',
                      border: `1px solid ${input.trim() && apiCalls < MAX_CALLS ? '#c9a84c' : '#0f1629'}`,
                      color: input.trim() && apiCalls < MAX_CALLS ? '#07070d' : '#334155',
                    }}>
                    ↑
                  </button>
                )}
              </div>
            </footer>
          </div>

          {/* Sandbox panel */}
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
                <span className="text-[10px] font-mono font-bold" style={{ color: '#38bdf8' }}>SOVEREIGN SANDBOX</span>
                <button onClick={() => setSandboxOpen(false)}
                  className="w-5 h-5 rounded flex items-center justify-center text-[10px]"
                  style={{ color: '#334155', background: '#0f1629' }}>✕</button>
              </div>

              {/* Panel tabs */}
              <div className="flex items-center border-b flex-shrink-0" style={{ borderColor: '#0d1220', background: '#04060e' }}>
                {(['terminal', 'files'] as PanelView[]).map(v => (
                  <button key={v} onClick={() => setPanelView(v)}
                    className="px-3 py-2 text-[10px] font-mono tracking-widest uppercase transition-all"
                    style={{
                      color: panelView === v ? '#c9a84c' : '#334155',
                      borderBottom: panelView === v ? '1px solid #c9a84c' : '1px solid transparent',
                    }}>{v}</button>
                ))}
              </div>

              {/* Panel content */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {panelView === 'terminal' && <TerminalOutput lines={terminalLines} />}
                {panelView === 'files' && (
                  <FileBrowser
                    files={sandboxFiles}
                    activeFileId={activeFileId}
                    onSelectFile={setActiveFileId}
                    onRefresh={() => {
                      setTerminalLines(prev => [...prev, {
                        id: `line_${Date.now()}`,
                        type: 'info',
                        text: 'Refreshing file list...',
                        timestamp: Date.now(),
                      }]);
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} callsUsed={apiCalls} />}
      {showEmail && <EmailCapture onComplete={() => { setShowEmail(false); setTimeout(() => sendMessage(), 100); }} />}
    </>
  );
}
