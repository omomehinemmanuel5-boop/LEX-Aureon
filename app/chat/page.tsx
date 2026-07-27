'use client';

import {
  useState, useEffect, useRef, useCallback, useMemo, memo,
} from 'react';
import Link from 'next/link';
import { useLexStream } from '@/lib/use_lex_stream';
import { flushPendingLead } from '@/lib/lead_retry';
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
   TYPE — "sovereign workspace" pass (2026-07-11)

   Uses the platform serif stack for build determinism; Caslon remains the
   design reference because it is the typeface of American founding documents —
   chosen because this product's own framing is explicitly "constitutional," not
   as a generic serif pick. Used sparingly: wordmark, mode titles, section
   eyebrows only. Everything else keeps the existing monospace stack —
   already the correct choice for reading numeric constitutional state at
   a glance, not something to replace.
───────────────────────────────────────────────────────────────────── */
const caslon = { className: 'font-serif' };

/* ─────────────────────────────────────────────────────────────────────
   DESIGN TOKENS
───────────────────────────────────────────────────────────────────── */
const G = {
  gold: '#c9a24a', goldL: '#e3c179',
  bg:      '#07080d',
  surface: '#0d0f18',
  surfaceHi: '#12141f',
  border:  '#1b1e2b',
  borderHi:'#262a3a',
  text:    '#8b8d97',
  // was #454858 — measured 2.21:1 on --bg #07080d, a hard AA failure applied
  // to almost every 9-11px label on the page. On a phone those labels were
  // effectively invisible. #7c8194 measures 5.17:1 and keeps the hierarchy
  // (textOn > prose > text > textSub) intact.
  textSub: '#7c8194',
  textOn:  '#e6e4dc',
  // Reading colour for message prose. #8b8d97 clears AA at 6.06:1 but at 16px
  // on near-black it still reads as disabled text, which is a large part of
  // why the conversation looked like log output rather than a reply. 14.3:1.
  prose:   '#d7dae3',
  C: '#4f8ff0', R: '#34b876', S: '#e0a039',
};

const HEALTH: Record<string, { color: string; bg: string; label: string }> = {
  OPTIMAL:  { color: '#34b876', bg: '#34b87615', label: 'OPTIMAL'  },
  ALERT:    { color: '#e0a039', bg: '#e0a03915', label: 'ALERT'    },
  STRESSED: { color: '#e0761f', bg: '#e0761f15', label: 'STRESSED' },
  CRITICAL: { color: '#ef4444', bg: '#ef444415', label: 'CRITICAL' },
};

const MODE_PREFIX: Record<SandboxMode, string> = {
  chat:     '',
  code:     '[CODE] Respond with production-quality code. Use fenced blocks with language tags and filename comments. ',
  research: '[RESEARCH] Provide rigorous analysis grounded in the constitutional framework. Cite mechanisms by name. ',
  redteam:  '[PROBE] Constitutional stress test. Full governance transparency. Show all reasoning. ',
};

const MODES: { key: SandboxMode; label: string; icon: string; desc: string }[] = [
  { key: 'chat',     label: 'Chat',     icon: '◈',   desc: 'General constitutional dialogue' },
  { key: 'code',     label: 'Code',     icon: '</>',  desc: 'Code generation with sandbox' },
  { key: 'research', label: 'Research', icon: '∇',   desc: 'Rigorous analysis mode' },
  { key: 'redteam',  label: 'Probe',    icon: '⊗',   desc: 'Governance stress testing' },
];

type SandboxMode = 'chat' | 'code' | 'research' | 'redteam';
// 'state' added 2026-07-26: the C/R/S before->after panel is now a disclosure
// like the others rather than always-on. See MessageBubble for the rationale.
type MsgTab      = 'state' | 'raw' | 'audit' | 'analysis';
type SheetView   = 'sandbox' | 'mode' | 'suggestions' | 'tools';

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
  return ({ ts:'typescript', tsx:'typescript', js:'javascript', jsx:'javascript',
    py:'python', rs:'rust', go:'go', sh:'bash', json:'json',
    md:'markdown', css:'css', html:'html', sql:'sql', yaml:'yaml' } as Record<string,string>)[ext] ?? 'text';
}

function parseCodeBlocks(text: string): CodeBlock[] {
  const out: CodeBlock[] = [];
  const re = /```(\w+)?(?:\s+\/\/\s*(.+?))?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null)
    out.push({ lang: m[1] ?? 'text', filename: m[2]?.trim(), code: m[3] });
  return out;
}

function syntaxHL(code: string, lang: string): string {
  let h = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (['text','markdown','md'].includes(lang)) return h;
  h = h.replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g, '<span style="color:#86efac">$1$2$1</span>');
  h = h.replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/g, '<span style="color:#2a3d58">$1</span>');
  h = h.replace(/\b(const|let|var|function|return|if|else|for|while|class|import|export|default|from|async|await|type|interface|extends|new|typeof|void|null|undefined|true|false|def|fn|pub|use|mod|struct|enum|match|self)\b/g,
    '<span style="color:#c9a24a">$1</span>');
  h = h.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#a78bfa">$1</span>');
  h = h.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span style="color:#38bdf8">$1</span>');
  return h;
}

/* ─────────────────────────────────────────────────────────────────────
   KEYBOARD-AWARE VIEWPORT (2026-07-25)

   The reported bug — "typing zooms out and I hardly see the text at the
   top" — was NOT text-field auto-zoom on the composer (that was already
   16px). It was the shell outliving its own height contract:

     h-[100dvh] does not shrink when the virtual keyboard opens. Per the CSS
     viewport spec, dvh/svh/lvh track dynamic UA chrome (the collapsing
     address bar), not interactive widgets. So the shell stayed full-screen,
     the keyboard covered the composer, and the browser scrolled the VISUAL
     viewport to bring the caret into view — dragging the sticky header out
     of sight. overflow:hidden + overscroll-behavior-y:contain then made it
     unrecoverable by scrolling.

   interactive-widget=resizes-content (app/layout.tsx) fixes this on Android
   by shrinking the layout viewport. iOS Safari ignores it and keeps
   resizes-visual semantics, so iOS needs the visual viewport measured
   directly — which is what this hook does. window.visualViewport DOES
   account for the keyboard on iOS.

   Writes two custom properties on <html>:
     --lex-vvh   visible height  -> shell height
     --lex-vvtop visual offset   -> diagnostic / future compensation

   Falls back to 100dvh when visualViewport is unavailable (SSR, older
   browsers), so this is strictly additive — nothing regresses if the API
   is missing.
───────────────────────────────────────────────────────────────────── */
function useKeyboardAwareViewport(): void {
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!vv) return;
    const root = document.documentElement;

    const apply = () => {
      // 1. PINCH-ZOOM GUARD. vv.height is reported in visual-viewport CSS px,
      //    i.e. already divided by vv.scale. The previous version fed that
      //    straight into the shell height, so the instant anything zoomed —
      //    a deliberate pinch, or iOS auto-zoom on any control — the shell
      //    height collapsed, the whole layout reflowed smaller, and the
      //    reflow re-fired resize. THAT is the "it zooms out when I type"
      //    report: not text-field auto-zoom (fonts were already 16px), a
      //    scale -> relayout -> resize feedback loop. While the user is
      //    zoomed we contribute nothing and let the browser pan normally.
      if (vv.scale > 1.01) { root.style.setProperty('--lex-kb', '0px'); return; }

      // 2. MEASURE THE KEYBOARD, NOT THE VIEWPORT. Publishing an inset keeps
      //    100dvh authoritative for the shell, so ordinary address-bar
      //    collapse no longer rewrites shell height mid-scroll. The old hook
      //    overwrote height on every visualViewport SCROLL event, which fires
      //    continuously while the address bar animates — a full relayout per
      //    frame, and the second half of the visible jank.
      const kb = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      // Sub-80px deltas are UA chrome, not a keyboard.
      root.style.setProperty('--lex-kb', kb < 80 ? '0px' : `${kb}px`);
    };

    apply();
    // resize only. scroll was the pathological listener — see (2).
    vv.addEventListener('resize', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      root.style.removeProperty('--lex-kb');
    };
  }, []);
}

/* Route-scoped document scroll lock.

   body is `min-h-screen flex flex-col` (app/layout.tsx) while this shell is
   viewport-height — two competing height contexts. Once the keyboard shrank
   the visible area the document itself became scrollable, and that document
   scroll is the mechanism that actually carried the header away. Locked
   while this route is mounted, restored exactly as found on unmount so no
   other route inherits it. */
function useDocumentScrollLock(): void {
  useEffect(() => {
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    return () => {
      body.style.overflow = prevOverflow;
      body.style.overscrollBehavior = prevOverscroll;
    };
  }, []);
}

/* ─────────────────────────────────────────────────────────────────────
   THE SEAL — signature element (2026-07-11, revised same day)

   M = min(C,R,S) is the actual thesis of the product — the stability
   margin the whole framework exists to protect. Rendered as a hexagonal
   seal whose glow color comes directly from live constitutional state.
   fix (2026-07-11, second pass): removed the continuous 6s rotation from
   the first version — on review it read as a loading-spinner affordance
   rather than a serious instrument, undercutting the "professional"
   brief. Pulse (opacity breathing, tied to whether a turn is in flight)
   replaces it — calmer, still alive, doesn't imply "processing" when idle.
───────────────────────────────────────────────────────────────────── */
function Seal({ m, health, active }: { m: number | null; health: string; active: boolean }) {
  const hcfg = HEALTH[health] ?? HEALTH.OPTIMAL;
  const color = m === null ? G.textSub : hcfg.color;
  return (
    <div className="relative flex-shrink-0 w-9 h-9 flex items-center justify-center">
      <svg width="36" height="36" viewBox="0 0 36 36">
        <polygon
          points="18,3 31,10.5 31,25.5 18,33 5,25.5 5,10.5"
          fill="none" stroke={color} strokeWidth="1.3"
          style={{ opacity: m === null ? 0.35 : 0.9, transition: 'stroke 0.5s, opacity 0.5s' }}
        />
      </svg>
      <span
        className={m !== null && active ? 'lex-pulse' : ''}
        style={{ position: 'absolute', fontSize: 12, color, transition: 'color 0.5s' }}
      >⬡</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   CRS BARS — compact, mobile-readable
───────────────────────────────────────────────────────────────────── */
function CRSBar({ c, r, s, m }: { c: number; r: number; s: number; m: number }) {
  const total  = (c + r + s) || 1;
  const mColor = m < 0.08 ? '#ef4444' : m < 0.15 ? G.S : G.R;
  return (
    <div className="space-y-[5px] pt-2.5 mt-2.5" style={{ borderTop: `1px solid ${G.border}` }}>
      {([['C', c, G.C], ['R', r, G.R], ['S', s, G.S]] as [string, number, string][]).map(([k, v, col]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-bold w-3.5" style={{ color: col }}>{k}</span>
          <div className="flex-1 h-[2px] rounded-full" style={{ background: G.border }}>
            <div className="h-[2px] rounded-full transition-all duration-700"
              style={{ width: `${(v / total) * 100}%`, background: col }} />
          </div>
          <span className="text-[10px] font-mono tabular-nums w-8 text-right" style={{ color: G.textSub }}>{v.toFixed(2)}</span>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono font-bold w-3.5" style={{ color: G.gold }}>M</span>
        <div className="flex-1 h-[3px] rounded-full" style={{ background: G.border }}>
          <div className="h-[3px] rounded-full transition-all duration-700"
            style={{ width: `${Math.min(m, 1) * 100}%`, background: mColor }} />
        </div>
        <span className="text-[10px] font-mono tabular-nums font-bold w-10 text-right" style={{ color: G.gold }}>{m.toFixed(3)}</span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   CRS DELTA — before → after governance
───────────────────────────────────────────────────────────────────── */
function mColorOf(m: number): string {
  return m < 0.08 ? '#ef4444' : m < 0.15 ? G.S : G.R;
}

function CRSDelta({ before, after }: {
  before: { c: number; r: number; s: number; m: number };
  after:  { c: number; r: number; s: number; m: number };
}) {
  const pillars: [string, number, number, string][] = [
    ['C', before.c, after.c, G.C],
    ['R', before.r, after.r, G.R],
    ['S', before.s, after.s, G.S],
  ];
  const dM    = after.m - before.m;
  const dCol  = (d: number) => Math.abs(d) < 0.005 ? G.textSub : d > 0 ? G.R : '#ef4444';
  const moved = Math.abs(dM) >= 0.005
    || pillars.some(([, b, a]) => Math.abs(a - b) >= 0.005);

  return (
    <div className="space-y-[6px] pt-2.5 mt-2.5" style={{ borderTop: `1px solid ${G.border}` }}>
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: G.textSub }}>
          before → after
        </span>
        <span className="text-[9px] font-mono uppercase tracking-widest"
          style={{ color: moved ? G.gold : G.textSub }}>
          {moved ? 'governed' : 'pass-through'}
        </span>
      </div>

      {pillars.map(([k, b, a, col]) => {
        const d = a - b;
        return (
          <div key={k} className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono font-bold w-3" style={{ color: col }}>{k}</span>
            <span className="text-[10px] font-mono tabular-nums w-8 text-right" style={{ color: G.textSub }}>{b.toFixed(2)}</span>
            <div className="flex-1 h-[3px] rounded-full relative" style={{ background: G.border }}>
              <div className="absolute top-0 left-0 h-[3px] rounded-full"
                style={{ width: `${Math.min(b, 1) * 100}%`, background: `${col}55` }} />
              <div className="absolute top-0 left-0 h-[3px] rounded-full transition-all duration-700"
                style={{ width: `${Math.min(a, 1) * 100}%`, background: col }} />
            </div>
            <span className="text-[10px] font-mono tabular-nums font-bold w-8 text-right" style={{ color: col }}>{a.toFixed(2)}</span>
            <span className="text-[9px] font-mono tabular-nums w-10 text-right" style={{ color: dCol(d) }}>
              {d >= 0 ? '+' : ''}{d.toFixed(2)}
            </span>
          </div>
        );
      })}

      <div className="flex items-center gap-1.5 pt-0.5">
        <span className="text-[10px] font-mono font-bold w-3" style={{ color: G.gold }}>M</span>
        <span className="text-[10px] font-mono tabular-nums w-8 text-right" style={{ color: mColorOf(before.m) }}>{before.m.toFixed(2)}</span>
        <div className="flex-1 h-[4px] rounded-full relative" style={{ background: G.border }}>
          <div className="absolute top-0 left-0 h-[4px] rounded-full"
            style={{ width: `${Math.min(before.m, 1) * 100}%`, background: `${mColorOf(before.m)}55` }} />
          <div className="absolute top-0 left-0 h-[4px] rounded-full transition-all duration-700"
            style={{ width: `${Math.min(after.m, 1) * 100}%`, background: mColorOf(after.m) }} />
        </div>
        <span className="text-[10px] font-mono tabular-nums font-bold w-8 text-right" style={{ color: mColorOf(after.m) }}>{after.m.toFixed(2)}</span>
        <span className="text-[9px] font-mono tabular-nums w-10 text-right" style={{ color: dCol(dM) }}>
          {dM >= 0 ? '+' : ''}{dM.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   CODE BLOCK VIEWER
───────────────────────────────────────────────────────────────────── */
const CodeViewer = memo(function CodeViewer({ block, onSave }: {
  block: CodeBlock; onSave?: (b: CodeBlock) => void;
}) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => syntaxHL(block.code, block.lang), [block.code, block.lang]);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(block.code).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }, [block.code]);

  return (
    <div className="mt-3 rounded-xl overflow-hidden" style={{ background: '#050810', border: `1px solid ${G.border}` }}>
      <div className="flex items-center justify-between px-3 py-2"
        style={{ borderBottom: `1px solid ${G.border}`, background: '#070a14' }}>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono" style={{ color: '#38bdf8' }}>{block.lang}</span>
          {block.filename && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
              style={{ color: G.gold, background: `${G.gold}12`, border: `1px solid ${G.gold}20` }}>
              {block.filename}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onSave && (
            <button onClick={() => onSave(block)}
              className="lex-focusable text-[11px] font-mono px-2.5 py-1 rounded-lg active:scale-95 transition-transform"
              style={{ color: G.R, background: `${G.R}12`, border: `1px solid ${G.R}22` }}>
              + save
            </button>
          )}
          <button onClick={copy}
            className="lex-focusable text-[11px] font-mono px-2.5 py-1 rounded-lg active:scale-95 transition-transform min-w-[44px]"
            style={{ color: copied ? G.R : G.textSub, background: copied ? `${G.R}12` : 'transparent' }}>
            {copied ? '✓' : 'copy'}
          </button>
        </div>
      </div>
      <pre className="p-3 text-[12px] leading-relaxed overflow-x-auto font-mono"
        style={{ color: '#7a8fa8', WebkitOverflowScrolling: 'touch' }}
        dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});

/* ─────────────────────────────────────────────────────────────────────
   MESSAGE CONTENT
───────────────────────────────────────────────────────────────────── */
function MessageContent({ text, onSaveBlock }: { text: string; onSaveBlock?: (b: CodeBlock) => void }) {
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
          ? <p key={i} className="lex-prose whitespace-pre-wrap" style={{ color: G.prose }}>{p.content}</p>
          : <CodeViewer key={i} block={p.block!} onSave={onSaveBlock} />
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   GOVERNANCE DETAIL PANEL (bottom-mounted)

   fix (2026-07-11) — CANONICAL RECEIPT LINK: the audit tab now shows the
   receipt id with a working link to its public /audit/[id] page. This
   required a real backend fix first — turn.audit_id was previously
   AuditorAgent's own non-persisted decorative id (format LEX-XXXXXXXX),
   not the canonical id actually stored in praxis_receipts (format
   KRN-XXXXXXXX-XXXX, what /audit/[id] queries by) — see the same-day fix
   in app/api/lex/govern/stream/route.ts. Verified live before wiring this
   up: the corrected id resolves to a real receipt, the old one 404'd.
───────────────────────────────────────────────────────────────────── */
function GovernancePanel({ turn, tab, onClose }: {
  turn: ChatTurn; tab: MsgTab; onClose: () => void;
}) {
  const hcfg = HEALTH[turn.health_band ?? 'OPTIMAL'] ?? HEALTH.OPTIMAL;
  const res  = turn.complete as GovernanceResponse | null;

  return (
    <div className="mt-2 rounded-2xl overflow-hidden font-mono"
      style={{ background: G.surface, border: `1px solid ${G.border}` }}>
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid ${G.border}` }}>
        <span className="text-[11px] tracking-wide" style={{ color: G.textSub }}>
          {tab === 'raw' ? '// bare output' : tab === 'audit' ? '// canonical receipt' : '// state'}
        </span>
        <button onClick={onClose} aria-label="Close" className="lex-focusable w-11 h-11 -mr-2 rounded-lg flex items-center justify-center"
          style={{ color: G.textSub, background: G.surfaceHi }}>✕</button>
      </div>

      <div className="p-4 overflow-y-auto" style={{ maxHeight: '50vh', WebkitOverflowScrolling: 'touch' }}>

        {tab === 'raw' && (
          <p className="whitespace-pre-wrap leading-relaxed text-[12px]" style={{ color: G.textSub }}>
            {turn.raw_output || '// blocked at pre-eval — no bare output'}
          </p>
        )}

        {tab === 'audit' && (
          <div className="space-y-3">
            {/* Canonical receipt — links to the same public, immutable entry
                visible on the /audit trail, not an internal-only id. */}
            {turn.audit_id && (
              <div className="rounded-xl p-3.5" style={{ background: `${G.gold}0a`, border: `1px solid ${G.gold}28` }}>
                <p className="text-[9px] uppercase tracking-widest mb-1.5" style={{ color: G.gold }}>
                  Canonical receipt
                </p>
                <p className="text-[12px] font-bold break-all mb-2.5" style={{ color: G.textOn }}>
                  {turn.audit_id}
                </p>
                <Link
                  href={`/audit/${encodeURIComponent(turn.audit_id)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="lex-focusable inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-all active:scale-95"
                  style={{ color: '#07070d', background: `linear-gradient(135deg,${G.gold},${G.goldL})` }}
                >
                  View on canonical audit log ↗
                </Link>
                <p className="text-[10px] mt-2 leading-relaxed" style={{ color: G.textSub }}>
                  This governed turn is part of the same public, cryptographically-signed
                  audit trail as every other receipt — independently verifiable, not
                  session-only.
                </p>
              </div>
            )}

            <div className="space-y-2">
              {[
                { k: 'health',     v: turn.health_band ?? 'OPTIMAL',       c: hcfg.color },
                { k: 'M',          v: (turn.M ?? 0).toFixed(4),            c: hcfg.color },
                { k: 'intervened', v: turn.intervened ? 'YES' : 'NO',      c: turn.intervened ? '#ef4444' : G.R },
                { k: 'attack',     v: turn.attack_type ?? 'none',          c: (turn.attack_type && turn.attack_type !== 'none') ? G.S : G.textSub },
                { k: 'severity',   v: turn.attack_severity != null ? turn.attack_severity.toFixed(3) : '—',
                  c: (turn.attack_severity ?? 0) >= 0.7 ? '#ef4444' : G.textSub },
                { k: 'memory',     v: turn.memory_injected ? 'injected' : 'none', c: turn.memory_injected ? '#a855f7' : G.textSub },
              ].map(({ k, v, c }) => (
                <div key={k} className="flex gap-3 items-start">
                  <span className="text-[11px] w-20 flex-shrink-0 pt-0.5" style={{ color: G.textSub }}>{k}</span>
                  <span className="text-[12px] font-bold break-all" style={{ color: c }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'analysis' && (
          <div className="space-y-4">
            {turn.C != null && (
              turn.rawC != null ? (
                <CRSDelta
                  before={{ c: turn.rawC, r: turn.rawR ?? 0, s: turn.rawS ?? 0, m: turn.mBefore ?? Math.min(turn.rawC, turn.rawR ?? 0, turn.rawS ?? 0) }}
                  after={{ c: turn.C, r: turn.R ?? 0, s: turn.S ?? 0, m: turn.M ?? 0 }}
                />
              ) : (
                <CRSBar c={turn.C} r={turn.R ?? 0} s={turn.S ?? 0} m={turn.M ?? 0} />
              )
            )}

            {turn.governor && (
              <div className="pt-3 space-y-2" style={{ borderTop: `1px solid ${G.border}` }}>
                <p className="text-[10px] uppercase tracking-widest" style={{ color: G.textSub }}>Governor</p>
                {[
                  { k: 'decision', v: turn.governor.decision, c: turn.governor.decision === 'INTERVENE' ? '#ef4444' : G.R },
                  { k: 'δV',       v: `${turn.governor.dV > 0 ? '+' : ''}${turn.governor.dV?.toFixed(5)}`, c: turn.governor.dV < 0 ? G.R : '#ef4444' },
                  { k: 'stable',   v: turn.governor.lyapunov_stable ? '✓ yes' : '⚠ breach', c: turn.governor.lyapunov_stable ? G.R : '#ef4444' },
                ].map(({ k, v, c }) => (
                  <div key={k} className="flex gap-3">
                    <span className="text-[11px] w-20 flex-shrink-0" style={{ color: G.textSub }}>{k}</span>
                    <span className="text-[12px] font-bold" style={{ color: c }}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            {turn.law && (
              <div className="pt-3" style={{ borderTop: `1px solid ${G.border}` }}>
                <p className="text-[10px] uppercase tracking-widest mb-1.5" style={{ color: G.textSub }}>Law invoked</p>
                <p className="text-[13px] font-bold" style={{ color: G.gold }}>
                  [{turn.law.book}] {turn.law.name}
                </p>
              </div>
            )}

            {turn.C != null && res && (
              <div className="pt-3" style={{ borderTop: `1px solid ${G.border}` }}>
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
   STATUS CHIPS — compact horizontal row
───────────────────────────────────────────────────────────────────── */
function StatusChips({ turn, live }: { turn: ChatTurn; live: boolean }) {
  const hcfg = HEALTH[turn.health_band ?? 'OPTIMAL'] ?? HEALTH.OPTIMAL;
  if (live) return (
    <span className="text-[10px] font-mono lex-pulse" style={{ color: G.gold }}
      role="status" aria-live="polite">● streaming</span>
  );

  const chips: { label: string; color: string; bg: string }[] = [];
  if (turn.health_band && turn.health_band !== 'OPTIMAL')
    chips.push({ label: hcfg.label, color: hcfg.color, bg: hcfg.bg });
  if (turn.intervened)
    chips.push({ label: 'corrected', color: '#ef4444', bg: '#ef444412' });
  if (turn.memory_injected)
    chips.push({ label: '⟳ mem', color: '#a855f7', bg: '#a855f712' });
  if (turn.attack_type && turn.attack_type !== 'none')
    chips.push({ label: `⊗ ${turn.attack_type}`, color: G.S, bg: `${G.S}12` });

  if (!chips.length) return null;
  return (
    <div className="flex gap-1 flex-wrap mt-1">
      {chips.map(c => (
        <span key={c.label} className="text-[10px] font-mono px-1.5 py-px rounded-full"
          style={{ color: c.color, background: c.bg, border: `1px solid ${c.color}20` }}>
          {c.label}
        </span>
      ))}
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

  if (turn.role === 'user') {
    return (
      <div className="flex justify-end px-1">
        <div className="max-w-[85%] px-4 py-3 rounded-2xl rounded-tr-md"
          style={{ background: G.surfaceHi, border: `1px solid ${G.borderHi}`, color: G.textOn, fontSize: 15, lineHeight: 1.65 }}>
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div className="px-1">
      <div className="flex items-center gap-2 mb-2 ml-1">
        <div className="w-[22px] h-[22px] rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0"
          style={{ background: `${G.gold}14`, border: `1px solid ${G.gold}28`, color: G.gold }}>⬡</div>
        <span className="text-[11px] font-mono font-bold tracking-widest" style={{ color: G.gold }}>
          Lex Aureon
        </span>
        {sandboxMode !== 'chat' && (
          <span className="text-[10px] font-mono px-1.5 py-px rounded"
            style={{ color: G.textSub, background: G.surface, border: `1px solid ${G.border}` }}>
            {sandboxMode}
          </span>
        )}
      </div>

      <div className="rounded-2xl rounded-tl-md ml-1"
        style={{
          background: G.surface,
          border: `1px solid ${live ? `${hcfg.color}50` : G.border}`,
          borderLeft: `2px solid ${hcfg.color}`,
          transition: 'border-color 0.35s',
        }}>
        <div className="px-4 py-3.5">
          {live ? (
            <p className="whitespace-pre-wrap leading-[1.75]" style={{ color: G.text, fontSize: 15 }}>
              {partialOutput}
              <span className="lex-cursor inline-block w-[2px] h-[15px] align-text-bottom ml-0.5 rounded-sm"
                style={{ background: G.gold }} />
            </p>
          ) : text ? (
            <MessageContent text={text} onSaveBlock={onSaveBlock} />
          ) : turn.error ? (
            <p style={{ color: '#ef4444', fontSize: 15 }}>{turn.error}</p>
          ) : null}

          <StatusChips turn={turn} live={live} />

          {/* ── Constitutional state: compact by default (2026-07-26) ──────────
              This block used to render the full four-row CRSDelta panel on
              EVERY completed turn, unconditionally. On a phone that is roughly
              ten lines of bars and numbers under a four-line answer — telemetry
              occupying 2-3x the vertical space of the content it describes,
              which is what made the surface read as a diagnostic console rather
              than a conversation.

              Nothing is removed. The full panel moved behind the 'state' tab,
              joining raw/audit/analysis, so the disclosure model is uniform:
              the conversation is primary, every measurement is one tap away.
              What stays always-visible is the one number that carries the
              governance signal — M, with its direction of travel — because a
              reader glancing at a turn wants "did this stay stable", not four
              simplex coordinates. */}
          {!live && turn.C != null && (
            <button
              onClick={() => onOpenTab(openTab === 'state' ? null : 'state')}
              aria-label={openTab === 'state' ? 'Hide constitutional state detail' : 'Show constitutional state detail'}
              aria-expanded={openTab === 'state'}
              className="lex-focusable mt-2 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[10px] font-mono min-h-[44px] active:scale-95 transition-transform"
              style={{ color: G.textSub, background: 'transparent', border: `1px solid ${G.border}` }}>
              <span style={{ color: G.gold }}>M {(turn.M ?? 0).toFixed(3)}</span>
              {turn.mBefore != null && turn.M != null && (
                <span style={{ color: turn.M >= turn.mBefore ? '#10b981' : '#ef4444' }}>
                  {turn.M >= turn.mBefore ? '▲' : '▼'}
                  {Math.abs(turn.M - turn.mBefore).toFixed(2)}
                </span>
              )}
              <span aria-hidden="true">{openTab === 'state' ? '▾' : '▸'}</span>
            </button>
          )}

          {openTab === 'state' && !live && turn.C != null && (
            turn.rawC != null ? (
              <CRSDelta
                before={{ c: turn.rawC, r: turn.rawR ?? 0, s: turn.rawS ?? 0, m: turn.mBefore ?? Math.min(turn.rawC, turn.rawR ?? 0, turn.rawS ?? 0) }}
                after={{ c: turn.C, r: turn.R ?? 0, s: turn.S ?? 0, m: turn.M ?? 0 }}
              />
            ) : (
              <CRSBar c={turn.C} r={turn.R ?? 0} s={turn.S ?? 0} m={turn.M ?? 0} />
            )
          )}
        </div>

        {!live && turn.governed_output && (
          <div className="flex items-center border-t px-3 py-2 gap-1"
            style={{ borderColor: G.border }}>
            {(['raw', 'audit', 'analysis'] as MsgTab[]).map(t => (
              <button key={t} onClick={() => onOpenTab(openTab === t ? null : t)}
                className="lex-focusable px-3 py-2.5 rounded-lg text-[11px] font-mono transition-all active:scale-95 min-h-[44px]"
                style={{
                  color: openTab === t ? G.gold : G.textSub,
                  background: openTab === t ? `${G.gold}12` : 'transparent',
                  border: `1px solid ${openTab === t ? `${G.gold}28` : 'transparent'}`,
                }}>{t}</button>
            ))}
          </div>
        )}
      </div>

      {openTab && openTab !== 'state' && !live && turn.governed_output && (
        <div className="ml-1 mt-2">
          <GovernancePanel turn={turn} tab={openTab} onClose={() => onOpenTab(null)} />
        </div>
      )}
    </div>
  );
});

/* ─────────────────────────────────────────────────────────────────────
   BOTTOM SHEET — generic mobile sheet wrapper
───────────────────────────────────────────────────────────────────── */
function BottomSheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // fix (2026-07-25) — the sheet declared role=dialog + aria-modal but did not
  // ENFORCE modality, which is the worse of the two failure modes: assistive
  // tech was told focus was contained when it was not, so Tab walked silently
  // out of the sheet and into the page behind it while the scrim still blocked
  // every click. Keyboard and screen-reader users got stuck on controls they
  // could reach but not activate. Escape also did nothing, despite the sheet
  // being dismissible by every other means.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = (): HTMLElement[] =>
      Array.from(panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(el => el.offsetParent !== null);

    // Move focus into the sheet on open, otherwise focus stays behind the scrim
    // and the first Tab appears to do nothing.
    focusables()[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last  = items[items.length - 1];
      // Wrap at both ends. Without this the tab order escapes into the inert
      // page rather than cycling within the dialog.
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Restore focus to whatever opened the sheet, so dismissing it does not
      // dump the user back at the top of the document.
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      {/* Sheet max height tracks the visual viewport too, so an open sheet
          with a focused field (the sandbox filename input) is not clipped
          behind the keyboard. Falls back to 85dvh where the API is absent. */}
      <div className="relative rounded-t-3xl overflow-hidden flex flex-col"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          background: G.surface,
          border: `1px solid ${G.border}`,
          maxHeight: 'calc((100dvh - var(--lex-kb, 0px)) * 0.85)',
        }}>
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full" style={{ background: G.border }} />
        </div>
        <div className="flex items-center justify-between px-5 py-3 flex-shrink-0"
          style={{ borderBottom: `1px solid ${G.border}` }}>
          <span className={`${caslon.className} text-[15px] tracking-wide`} style={{ color: G.gold }}>
            {title}
          </span>
          <button onClick={onClose}
            aria-label="Close"
            className="lex-focusable w-11 h-11 -mr-2 rounded-xl flex items-center justify-center text-[14px]"
            style={{ color: G.textSub, background: G.surfaceHi }}>✕</button>
        </div>
        <div className="overflow-y-auto flex-1" style={{ WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SANDBOX SHEET CONTENT
───────────────────────────────────────────────────────────────────── */
function SandboxSheetContent({ files, activeFileId, terminalLog, onSelectFile, onUpdateFile, onNewFile, onDeleteFile }: {
  files: SandboxFile[]; activeFileId: string | null; terminalLog: string[];
  onSelectFile: (id: string) => void; onUpdateFile: (id: string, c: string) => void;
  onNewFile: (name: string) => void; onDeleteFile: (id: string) => void;
}) {
  const [tab, setTab]       = useState<'files' | 'editor' | 'terminal'>('files');
  const [newName, setNewName] = useState('');
  const [showNew, setShowNew] = useState(false);
  const activeFile           = files.find(f => f.id === activeFileId);
  const termRef              = useRef<HTMLDivElement>(null);

  useEffect(() => { if (tab === 'terminal') termRef.current?.scrollTo(0, 9999); }, [terminalLog, tab]);

  const submitNew = () => {
    const n = newName.trim(); if (!n) return;
    onNewFile(n); setNewName(''); setShowNew(false); setTab('editor');
  };

  return (
    <div className="flex flex-col font-mono" style={{ minHeight: '40vh' }}>
      <div className="flex border-b flex-shrink-0" style={{ borderColor: G.border }}>
        {(['files','editor','terminal'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="lex-focusable flex-1 py-3 text-[11px] uppercase tracking-wider transition-colors"
            style={{
              color: tab === t ? G.gold : G.textSub,
              borderBottom: `2px solid ${tab === t ? G.gold : 'transparent'}`,
            }}>{t}</button>
        ))}
        <button onClick={() => setShowNew(s => !s)}
          className="lex-focusable px-4 py-3 text-[11px] flex-shrink-0"
          style={{ color: G.R }}>+ new</button>
      </div>

      {showNew && (
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: G.border }}>
          {/* text-[16px], not text-[13px]: iOS force-zooms the page when a
              field below 16px receives focus. This input was the one真 case
              of genuine text-field auto-zoom on this page — the old
              `textarea { font-size:16px }` rule did not cover <input>. */}
          <input value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitNew(); }}
            placeholder="filename.ts" autoFocus
            className="lex-focusable flex-1 bg-transparent text-[16px] focus:outline-none"
            style={{ color: G.gold, caretColor: G.gold }} />
          <button onClick={submitNew} className="lex-focusable text-[11px] px-3 py-2.5 rounded-xl min-h-[44px]"
            style={{ color: G.R, background: `${G.R}12`, border: `1px solid ${G.R}22` }}>create</button>
        </div>
      )}

      {tab === 'files' && (
        <div className="p-4 space-y-2">
          {files.length === 0 && (
            <div className="text-center py-10">
              <p className="text-[13px]" style={{ color: G.textSub }}>No files yet</p>
              <p className="text-[11px] mt-1" style={{ color: G.textSub }}>Ask Lex to write code, then tap + save</p>
            </div>
          )}
          {files.map(f => (
            <div key={f.id} onClick={() => { onSelectFile(f.id); setTab('editor'); }}
              className="flex items-center gap-3 px-4 py-3.5 rounded-xl"
              style={{ background: f.id === activeFileId ? G.surfaceHi : 'transparent',
                border: `1px solid ${f.id === activeFileId ? G.borderHi : G.border}` }}>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-mono truncate font-medium"
                  style={{ color: f.id === activeFileId ? G.gold : G.textOn }}>{f.name}</p>
                <p className="text-[11px] mt-0.5" style={{ color: G.textSub }}>
                  {f.content.split('\n').length}L · {f.lang}
                </p>
              </div>
              <button onClick={e => { e.stopPropagation(); onDeleteFile(f.id); }}
                className="lex-focusable w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ color: '#ef4444', background: '#ef444410' }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {tab === 'editor' && (
        <div className="flex flex-col" style={{ minHeight: '50vh' }}>
          {activeFile ? (
            <>
              <div className="flex items-center gap-2 px-4 py-2.5 border-b flex-shrink-0"
                style={{ borderColor: G.border }}>
                <span className="text-[12px] font-mono" style={{ color: G.gold }}>{activeFile.name}</span>
                <span className="text-[11px]" style={{ color: G.textSub }}>{activeFile.lang}</span>
                <span className="text-[11px] ml-auto" style={{ color: G.textSub }}>{activeFile.content.split('\n').length}L</span>
              </div>
              {/* .lex-code-editor: 16px on touch (zoom-safe), 13px only under
                  (pointer: fine). Previously an inline fontSize:13 that the
                  global `textarea { font-size:16px !important }` silently
                  overrode — so this editor never actually rendered at 13px
                  anywhere. Now it does, on pointer devices only. */}
              <textarea value={activeFile.content}
                onChange={e => onUpdateFile(activeFile.id, e.target.value)}
                className="lex-focusable lex-code-editor flex-1 w-full resize-none focus:outline-none p-4 leading-relaxed"
                style={{ background: 'transparent', color: '#8fa0b4', caretColor: G.gold,
                  fontFamily: 'inherit', minHeight: '45vh' }}
                spellCheck={false} />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <p className="text-[13px]" style={{ color: G.textSub }}>Select a file from the Files tab</p>
            </div>
          )}
        </div>
      )}

      {tab === 'terminal' && (
        <div ref={termRef} className="p-4 text-[12px] leading-relaxed space-y-1" style={{ minHeight: '40vh' }}>
          {terminalLog.length === 0 && <p style={{ color: G.textSub }}>{'// ready'}</p>}
          {terminalLog.map((line, i) => (
            <p key={i} style={{
              color: line.startsWith('>>') ? G.gold : line.startsWith('✓') ? G.R
                   : line.startsWith('✗') ? '#ef4444' : G.textSub,
            }}>{line}</p>
          ))}
          <div className="flex items-center gap-1 pt-2">
            <span style={{ color: G.gold }}>lex@sovereign:~$</span>
            <span className="lex-cursor inline-block w-2 h-[13px] ml-0.5 rounded-sm"
              style={{ background: G.gold }} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   TOOLS SHEET — consolidates self-test + session stats + sandbox entry.
───────────────────────────────────────────────────────────────────── */
function ToolsSheet({
  apiCalls, callsLeft, sandboxFileCount, onOpenSandbox, onSelfTest, selfTestLoading, onUpgrade, onClose,
}: {
  apiCalls: number; callsLeft: number; sandboxFileCount: number;
  onOpenSandbox: () => void; onSelfTest: () => void; selfTestLoading: boolean;
  onUpgrade: () => void; onClose: () => void;
}) {
  return (
    <div className="p-4 space-y-2">
      <button onClick={() => { onSelfTest(); }} disabled={selfTestLoading}
        className="lex-focusable w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-left transition-all active:scale-[0.98] disabled:opacity-40"
        style={{ background: G.surfaceHi, border: `1px solid ${G.border}` }}>
        <span className="text-lg w-7 text-center flex-shrink-0" style={{ color: G.R }}>{selfTestLoading ? '…' : '⊕'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold font-mono" style={{ color: G.textOn }}>Run self-test</p>
          <p className="text-[11px] mt-0.5" style={{ color: G.textSub }}>Verify kernel integrity end to end</p>
        </div>
      </button>

      <button onClick={() => { onOpenSandbox(); onClose(); }}
        className="lex-focusable w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-left transition-all active:scale-[0.98]"
        style={{ background: G.surfaceHi, border: `1px solid ${G.border}` }}>
        <span className="text-lg w-7 text-center flex-shrink-0" style={{ color: '#38bdf8' }}>{'</>'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold font-mono" style={{ color: G.textOn }}>Sandbox</p>
          <p className="text-[11px] mt-0.5" style={{ color: G.textSub }}>
            {sandboxFileCount > 0 ? `${sandboxFileCount} saved file${sandboxFileCount > 1 ? 's' : ''}` : 'No files saved yet'}
          </p>
        </div>
      </button>

      <div className="w-full flex items-center gap-4 px-4 py-4 rounded-2xl"
        style={{ background: G.surfaceHi, border: `1px solid ${G.border}` }}>
        <span className="text-lg w-7 text-center flex-shrink-0" style={{ color: G.gold }}>◈</span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold font-mono" style={{ color: G.textOn }}>{callsLeft} of {callsLeft + apiCalls} calls left</p>
          <p className="text-[11px] mt-0.5" style={{ color: G.textSub }}>This session</p>
        </div>
      </div>

      <Link
        href="/audit" target="_blank" rel="noopener noreferrer"
        className="lex-focusable w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-left transition-all active:scale-[0.98]"
        style={{ background: G.surfaceHi, border: `1px solid ${G.border}` }}
      >
        <span className="text-lg w-7 text-center flex-shrink-0" style={{ color: G.gold }}>▤</span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold font-mono" style={{ color: G.textOn }}>Canonical audit log ↗</p>
          <p className="text-[11px] mt-0.5" style={{ color: G.textSub }}>Every receipt, publicly verifiable</p>
        </div>
      </Link>

      <button onClick={() => { onUpgrade(); onClose(); }}
        className="lex-focusable w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-left transition-all active:scale-[0.98]"
        style={{ background: `${G.gold}0e`, border: `1px solid ${G.gold}28` }}>
        <span className="text-lg w-7 text-center flex-shrink-0" style={{ color: G.gold }}>↑</span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold font-mono" style={{ color: G.gold }}>Upgrade</p>
          <p className="text-[11px] mt-0.5" style={{ color: G.textSub }}>Raise the call limit</p>
        </div>
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   MODE PICKER SHEET
───────────────────────────────────────────────────────────────────── */
function ModeSheet({ current, onSelect, onClose }: {
  current: SandboxMode; onSelect: (m: SandboxMode) => void; onClose: () => void;
}) {
  return (
    <div className="p-4 space-y-2">
      {MODES.map(m => (
        <button key={m.key} onClick={() => { onSelect(m.key); onClose(); }}
          className="lex-focusable w-full flex items-center gap-4 px-4 py-4 rounded-2xl text-left transition-all active:scale-[0.98]"
          style={{
            background: current === m.key ? `${G.gold}0e` : G.surfaceHi,
            border: `1px solid ${current === m.key ? `${G.gold}30` : G.border}`,
          }}>
          <span className="text-xl w-7 text-center flex-shrink-0" style={{ color: current === m.key ? G.gold : G.textSub }}>
            {m.icon}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold font-mono" style={{ color: current === m.key ? G.gold : G.textOn }}>
              {m.label}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: G.textSub }}>{m.desc}</p>
          </div>
          {current === m.key && (
            <span className="text-[12px] flex-shrink-0" style={{ color: G.gold }}>✓</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SUGGESTIONS SHEET
───────────────────────────────────────────────────────────────────── */
function SuggestionsSheet({ turns, activeCategory, onCategoryChange, onSelect, onClose, disabled }: {
  turns: ChatTurn[]; activeCategory: SuggestionCategory;
  onCategoryChange: (c: SuggestionCategory) => void;
  onSelect: (p: string) => void; onClose: () => void; disabled: boolean;
}) {
  const suggestions = useMemo(
    () => activeCategory === 'all'
      ? getDynamicSuggestions(turns, 'all', 6)
      : getPromptsByCategory(activeCategory).slice(0, 8),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [turns.length, activeCategory],
  );

  const dotColor: Record<string, string> = {
    jailbreak: '#ef4444', sycophancy: G.R, identity: G.C,
    'slow-drip': G.S, probe: '#a855f7', attack: '#e0761f', baseline: G.textSub,
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
        {SUGGESTION_CATEGORIES.map(cat => (
          <button key={cat.key} onClick={() => onCategoryChange(cat.key)}
            className="lex-focusable flex-shrink-0 px-3 py-2.5 rounded-full text-[11px] font-mono min-h-[44px]"
            style={{
              color: activeCategory === cat.key ? G.gold : G.textSub,
              background: activeCategory === cat.key ? `${G.gold}12` : G.surfaceHi,
              border: `1px solid ${activeCategory === cat.key ? `${G.gold}28` : G.border}`,
            }}>{cat.label}</button>
        ))}
      </div>
      <div className="space-y-2">
        {suggestions.map((s, i) => (
          <button key={i} disabled={disabled}
            onClick={() => { if (!disabled) { onSelect(s.prompt); onClose(); } }}
            className="lex-focusable w-full flex items-start gap-3 px-4 py-3.5 rounded-xl text-left transition-all active:scale-[0.98] disabled:opacity-30"
            style={{ background: G.surfaceHi, border: `1px solid ${G.border}` }}>
            <span className="mt-1.5 flex-shrink-0" style={{ color: dotColor[s.category] ?? G.textSub, fontSize: 8 }}>●</span>
            <span className="text-[13px] leading-relaxed" style={{ color: G.text }}>{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   EMPTY STATE
───────────────────────────────────────────────────────────────────── */
function EmptyState({ mode, onSuggestion }: { mode: SandboxMode; onSuggestion: () => void }) {
  const cfg = {
    chat:     { icon: '◈',   title: 'Sovereign Workspace',   sub: 'Constitutional AI governance, live' },
    code:     { icon: '</>',  title: 'Code Mode',             sub: 'Write and save code to sandbox' },
    research: { icon: '∇',   title: 'Research Mode',          sub: 'Rigorous constitutional analysis' },
    redteam:  { icon: '⊗',   title: 'Constitutional Probe',   sub: 'Stress-test the governor' },
  }[mode];

  return (
    <div className="flex flex-col items-center justify-center h-full gap-8 px-6 py-12 text-center">
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl"
          style={{ background: `${G.gold}0e`, border: `1px solid ${G.gold}22` }}>
          {cfg.icon}
        </div>
        <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full lex-pulse"
          style={{ background: G.R }} />
      </div>

      <div className="space-y-1.5">
        <p className={`${caslon.className} text-[22px] tracking-wide`} style={{ color: G.gold }}>
          {cfg.title}
        </p>
        <p className="text-[12px] font-mono" style={{ color: G.textSub }}>{cfg.sub}</p>
      </div>

      <div className="w-full max-w-xs space-y-2 text-left">
        {[
          'C·R·S constitutional pillars — before vs after every turn',
          'Lyapunov stability — mathematically guaranteed',
          'SHA-256 cryptographic receipt every response',
        ].map((l, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3 rounded-xl"
            style={{ background: G.surface, border: `1px solid ${G.border}` }}>
            <span className="text-[10px] mt-0.5 flex-shrink-0" style={{ color: G.gold }}>—</span>
            <p className="text-[12px] leading-relaxed font-mono" style={{ color: G.text }}>{l}</p>
          </div>
        ))}
      </div>

      <button onClick={onSuggestion}
        className="lex-focusable px-6 py-3.5 rounded-2xl text-[13px] font-mono font-bold transition-all active:scale-95"
        style={{ background: `${G.gold}12`, border: `1px solid ${G.gold}28`, color: G.gold }}>
        Browse suggestions →
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   SELF-TEST BANNER
───────────────────────────────────────────────────────────────────── */
function SelfTestBanner({ result, onClose }: { result: string; onClose: () => void }) {
  return (
    <div className="mx-4 mt-3 rounded-2xl overflow-hidden flex-shrink-0"
      style={{ background: G.surface, border: `1px solid ${G.R}22` }}>
      <div className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid ${G.border}` }}>
        <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: G.R }}>⊕ Self-Test</span>
        <button onClick={onClose} aria-label="Close" className="lex-focusable w-11 h-11 -mr-2 rounded-lg flex items-center justify-center"
          style={{ color: G.textSub, background: G.surfaceHi }}>✕</button>
      </div>
      <pre className="p-4 whitespace-pre-wrap text-[12px] leading-relaxed font-mono max-h-40 overflow-y-auto"
        style={{ color: '#86efac', WebkitOverflowScrolling: 'touch' }}>
        {result}
      </pre>
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
  const [sandboxFiles, setSandboxFiles] = useState<SandboxFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [terminalLog, setTerminalLog]   = useState<string[]>([]);
  const [sheet, setSheet]               = useState<SheetView | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const toast     = useToast();
  const { state: stream, run: runStream, cancel } = useLexStream();

  // Mobile viewport correctness — see the hook definitions near the top of
  // this file for the full diagnosis. Both are required: the CSS var drives
  // the shell height (iOS), the scroll lock stops the document itself from
  // scrolling the header away.
  useKeyboardAwareViewport();
  useDocumentScrollLock();

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
  // Retry any lead a previous visit failed to deliver (see lib/lead_retry.ts).
  useEffect(() => { void flushPendingLead(); }, []);
  useEffect(() => { localStorage.setItem('lex_api_calls', String(apiCalls)); }, [apiCalls]);
  useEffect(() => { localStorage.setItem('lex_sandbox_files', JSON.stringify(sandboxFiles)); }, [sandboxFiles]);

  /* Autoscroll — fix (2026-07-25). Previously fired
     scrollIntoView({behavior:'smooth'}) on EVERY streamed token, which
     (a) competes with the browser's own keyboard-driven scrolling on iOS
     and (b) yanked the view back down if the user had deliberately
     scrolled up to re-read an earlier turn mid-stream. Now: only follow
     when the user is already within 120px of the bottom, and use instant
     positioning rather than animating once per token. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) { bottomRef.current?.scrollIntoView({ block: 'end' }); return; }
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
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
    const stateRec = kx.state as Record<string, number> | undefined;
    const C = Number(stateRec?.C ?? res.metrics?.c ?? 0);
    const R = Number(stateRec?.R ?? res.metrics?.r ?? 0);
    const S = Number(stateRec?.S ?? res.metrics?.s ?? 0);
    const rawRec  = kx.raw_state as Record<string, number> | undefined;
    const rawC    = rawRec ? Number(rawRec.C) : undefined;
    const rawR    = rawRec ? Number(rawRec.R) : undefined;
    const rawS    = rawRec ? Number(rawRec.S) : undefined;
    const mBefore = kx.m_before != null
      ? Number(kx.m_before)
      : (rawC != null && rawR != null && rawS != null ? Math.min(rawC, rawR, rawS) : undefined);
    const sig = (kx.semantic_signal as { attack_type?: string; severity?: number }) ?? {};

    setTurns(prev => prev.map(t => t.id !== currentLexId ? t : {
      ...t, streaming: false,
      governed_output: res.governed_output, raw_output: res.raw_output, audit_id: res.audit_id,
      M, health_band: health, C, R, S,
      rawC, rawR, rawS, mBefore,
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
    // 2026-07-20: gate moved from BEFORE the first run to before the second —
    // the live demo is the best sales asset; let a visitor see one real
    // governed result before asking for their email. They still get the
    // same 10 free runs total after activating.
    if (typeof window !== 'undefined' && !localStorage.getItem('lex_email_captured') && apiCalls === 1) {
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
    setActiveFileId(f.id);
    setTerminalLog(prev => [...prev, `✓ saved ${name}`]);
    toast.push(`Saved ${name}`, 'success');
  }, [toast]);

  const createNewFile = useCallback((name: string) => {
    const n = name.trim() || `untitled_${Date.now()}.ts`;
    const f: SandboxFile = { id: `f_${Date.now()}`, name: n, lang: langFromName(n), content: `// ${n}\n`, createdAt: Date.now(), modifiedAt: Date.now() };
    setSandboxFiles(prev => [...prev, f]); setActiveFileId(f.id);
  }, []);

  const updateFile = useCallback((id: string, content: string) => {
    setSandboxFiles(prev => prev.map(f => f.id === id ? { ...f, content, modifiedAt: Date.now() } : f));
  }, []);

  const deleteFile = useCallback((id: string) => {
    setSandboxFiles(prev => { const n = prev.filter(f => f.id !== id); setActiveFileId(n[n.length - 1]?.id ?? null); return n; });
  }, []);

  const hcfg       = HEALTH[liveHealth] ?? HEALTH.OPTIMAL;
  const isStreaming = stream.loading;
  const arc        = useMemo(() => buildSessionArc(turns), [turns]);
  const callsLeft  = MAX_CALLS - apiCalls;
  const curMode    = MODES.find(m => m.key === sandboxMode)!;

  return (
    <>
      <style>{`
        @keyframes lex-blink   { 0%,100%{opacity:1}  50%{opacity:0}   }
        @keyframes lex-breathe { 0%,100%{opacity:.4}  50%{opacity:1}  }
        .lex-cursor { animation: lex-blink   0.9s step-end  infinite; }
        .lex-pulse  { animation: lex-breathe 2.4s ease-in-out infinite; }
        ::-webkit-scrollbar { display: none; }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }

        /* fix (2026-07-25) — iOS force-zooms the page whenever a focused
           field is under 16px. The old rule covered ONLY textarea, so the
           sandbox filename <input> (13px) still triggered it. Covers all
           three field types now. No !important: it must NOT override
           .lex-code-editor below. */
        textarea, input, select { font-size: 16px; }
        textarea, input { -webkit-user-select: text; user-select: text; }

        /* MESSAGE PROSE (2026-07-27).
           The whole surface inherited the monospace stack, including the body
           of every reply. Monospace is the right call for numeric state — it
           is the wrong call for paragraphs: ~15% wider per glyph, no optical
           rhythm, and it is the single strongest cue that made this read as a
           console rather than a conversation. Monospace is retained
           everywhere it carries meaning (C/R/S values, receipt ids, code,
           the terminal). Prose only moves to the UI sans stack. */
        .lex-prose {
          font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI',
                       system-ui, sans-serif;
          font-size: 16px;
          line-height: 1.6;
          letter-spacing: -0.004em;
          /* Long unbroken tokens (urls, hashes) in a reply must not force the
             whole column to scroll sideways on a 390px screen. */
          overflow-wrap: anywhere;
        }

        /* Reading column. Without a max the conversation stretched the full
           width of a laptop, which is what made the page look like a phone
           app scaled up. 46rem is ~85 characters at 16px. */
        .lex-col { width: 100%; max-width: 46rem; margin-inline: auto; }

        /* Code editor stays zoom-safe at 16px on touch and only tightens to
           13px where auto-zoom does not exist. Previously an inline
           fontSize:13 that the old !important rule silently overrode. */
        .lex-code-editor { font-size: 16px; }
        @media (pointer: fine) { .lex-code-editor { font-size: 13px; } }

        /* fix (2026-07-11) — production accessibility pass */
        @media (prefers-reduced-motion: reduce) {
          .lex-cursor, .lex-pulse { animation: none !important; opacity: 1 !important; }
          * { transition-duration: 0.01ms !important; }
        }
        .lex-focusable:focus-visible {
          outline: 2px solid ${G.gold};
          outline-offset: 2px;
          border-radius: 8px;
        }
        a.lex-focusable:focus-visible { outline-offset: 3px; }
      `}</style>

      <div
        className="flex flex-col overflow-hidden select-none"
        style={{
          // Shell = full dynamic viewport MINUS the measured keyboard inset.
          // Deriving it this way (rather than assigning vv.height directly)
          // means the height is stable under pinch-zoom and under address-bar
          // collapse — only a real keyboard changes it. --lex-kb is 0px
          // whenever there is no keyboard, on SSR, and on browsers without
          // the visualViewport API, so this degrades to plain 100dvh.
          height: 'calc(100dvh - var(--lex-kb, 0px))',
          background: G.bg,
          fontFamily: "'SF Mono','JetBrains Mono',ui-monospace,monospace",
          color: G.text,
          overscrollBehaviorY: 'contain',
        }}
      >

        {/* ══════════════════════ HEADER — explicitly static ══════════════════════
            fix (2026-07-11): the flex layout already prevented header scroll,
            but position:sticky is added as defense-in-depth against iOS
            Safari's rubber-band overscroll visually shifting fixed chrome —
            combined with overscroll-behavior-y:contain on the outer container
            above, the header now genuinely cannot move once mounted. */}
        <header
          className="flex-shrink-0 z-30"
          style={{ position: 'sticky', top: 0, background: G.bg, borderBottom: `1px solid ${G.border}` }}
        >
          <div className="flex items-center h-14 px-4 gap-3">

            <Link href="/"
              className="lex-focusable flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
              style={{ color: G.textSub, background: G.surface, border: `1px solid ${G.border}` }}>
              <svg width="9" height="14" viewBox="0 0 9 14" fill="none">
                <path d="M7 1L1 7L7 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>

            <Seal m={liveM} health={liveHealth} active={isStreaming} />

            <div className="flex-1 min-w-0">
              <p className={`${caslon.className} text-[17px] tracking-wide leading-none truncate`} style={{ color: G.textOn }}>
                Sovereign Workspace
              </p>
              <p className="text-[10px] font-mono leading-none mt-1" style={{ color: hcfg.color }}>
                {curMode.icon} {curMode.label} · {liveM !== null ? `M ${liveM.toFixed(3)}` : hcfg.label}
              </p>
            </div>

            <button onClick={() => setSheet(sheet === 'tools' ? null : 'tools')}
              className="lex-focusable flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center active:scale-90 transition-transform"
              style={{
                color: sheet === 'tools' ? G.gold : G.textSub,
                background: G.surface, border: `1px solid ${sheet === 'tools' ? `${G.gold}28` : G.border}`,
              }}
              title="Tools">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="3" r="1.3" fill="currentColor"/>
                <circle cx="8" cy="8" r="1.3" fill="currentColor"/>
                <circle cx="8" cy="13" r="1.3" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </header>

        {/* ══════════════════════════ MAIN ══════════════════════════ */}
        <main ref={scrollRef} className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>

          {selfTestResult && (
            <SelfTestBanner result={selfTestResult} onClose={() => setSelfTestResult(null)} />
          )}

          <div className="py-4 space-y-5 pb-2">
            {!turns.length
              ? <EmptyState mode={sandboxMode} onSuggestion={() => setSheet('suggestions')} />
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
          </div>
        </main>

        {/* ══════════════════════════ FOOTER ══════════════════════════ */}
        <footer className="flex-shrink-0 z-20"
          style={{
            background: G.bg,
            borderTop: `1px solid ${G.border}`,
            paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
          }}>

          {arc.interventionCount > 0 && (
            <div className="px-4 pt-2">
              <p className="text-[10px] font-mono text-center" style={{ color: G.S }}>
                ⚡ {arc.interventionCount} correction{arc.interventionCount > 1 ? 's' : ''} this session
              </p>
            </div>
          )}

          <div className="flex items-end gap-2 px-3 pt-2.5 pb-2">

            <button onClick={() => setSheet(sheet === 'mode' ? null : 'mode')}
              className="lex-focusable flex-shrink-0 w-11 h-11 self-end rounded-xl flex items-center justify-center active:scale-90 transition-transform"
              style={{
                color: sheet === 'mode' ? G.gold : G.textSub,
                background: G.surface, border: `1px solid ${sheet === 'mode' ? `${G.gold}28` : G.border}`,
              }}
              title="Switch mode">
              <span className="text-[13px]">{curMode.icon}</span>
            </button>

            <div className="flex-1 rounded-2xl transition-all duration-200"
              style={{
                background: G.surface,
                border: `1px solid ${inputFocused ? `${G.gold}40` : G.border}`,
                boxShadow: inputFocused ? `0 0 0 3px ${G.gold}08` : 'none',
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
                  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
                }}
                placeholder={
                  sandboxMode === 'code'     ? 'Ask Lex to write code…'
                  : sandboxMode === 'research' ? 'Pose a research question…'
                  : sandboxMode === 'redteam'  ? 'Launch a constitutional probe…'
                  :                              'Message Lex Aureon…'
                }
                rows={1} disabled={isStreaming}
                className="lex-focusable w-full bg-transparent px-4 py-3 resize-none focus:outline-none leading-relaxed disabled:opacity-40"
                style={{ color: G.textOn, caretColor: G.gold, fontFamily: 'inherit', maxHeight: '140px' }} />
            </div>

            <button onClick={() => setSheet(sheet === 'suggestions' ? null : 'suggestions')}
              className="lex-focusable flex-shrink-0 w-11 h-11 self-end rounded-xl flex items-center justify-center active:scale-90 transition-transform"
              style={{
                color: sheet === 'suggestions' ? G.gold : G.textSub,
                background: G.surface, border: `1px solid ${sheet === 'suggestions' ? `${G.gold}28` : G.border}`,
              }}
              title="Suggestions">
              <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
                <path d="M1 1.5h12M1 5.5h8M1 9.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </button>

            {isStreaming ? (
              <button onClick={cancel}
                aria-label="Stop generating"
                className="lex-focusable flex-shrink-0 w-11 h-11 self-end rounded-xl flex items-center justify-center active:scale-90 transition-transform"
                style={{ background: '#1e0808', border: '1px solid #4a1010', color: '#f87171' }}>
                <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor">
                  <rect width="11" height="11" rx="2.5"/>
                </svg>
              </button>
            ) : (
              <button onClick={() => sendMessage()} disabled={!input.trim() || apiCalls >= MAX_CALLS}
                aria-label="Send message"
                className="lex-focusable flex-shrink-0 w-11 h-11 self-end rounded-xl flex items-center justify-center active:scale-95 transition-all disabled:opacity-20"
                style={{
                  background: input.trim() ? `linear-gradient(135deg,${G.gold},${G.goldL})` : G.surface,
                  border: `1px solid ${input.trim() ? G.gold : G.border}`,
                  color: input.trim() ? '#07070d' : G.textSub,
                }}>
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path d="M7.5 13V2M3 6.5L7.5 2L12 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        </footer>
      </div>

      {/* ══════════════════════ BOTTOM SHEETS ══════════════════════ */}

      <BottomSheet open={sheet === 'tools'} onClose={() => setSheet(null)} title="Tools">
        <ToolsSheet
          apiCalls={apiCalls} callsLeft={callsLeft} sandboxFileCount={sandboxFiles.length}
          onOpenSandbox={() => setSheet('sandbox')}
          onSelfTest={() => { void runSelfTest(); setSheet(null); }}
          selfTestLoading={selfTestLoading}
          onUpgrade={() => setShowUpgrade(true)}
          onClose={() => setSheet(null)}
        />
      </BottomSheet>

      <BottomSheet open={sheet === 'sandbox'} onClose={() => setSheet(null)} title="Sandbox">
        <SandboxSheetContent
          files={sandboxFiles} activeFileId={activeFileId} terminalLog={terminalLog}
          onSelectFile={setActiveFileId} onUpdateFile={updateFile}
          onNewFile={createNewFile} onDeleteFile={deleteFile}
        />
      </BottomSheet>

      <BottomSheet open={sheet === 'mode'} onClose={() => setSheet(null)} title="Mode">
        <ModeSheet current={sandboxMode} onSelect={setSandboxMode} onClose={() => setSheet(null)} />
      </BottomSheet>

      <BottomSheet open={sheet === 'suggestions'} onClose={() => setSheet(null)} title="Suggestions">
        <SuggestionsSheet
          turns={turns} activeCategory={suggCat}
          onCategoryChange={setSuggCat}
          onSelect={p => { setInput(p); inputRef.current?.focus(); }}
          onClose={() => setSheet(null)}
          disabled={isStreaming}
        />
      </BottomSheet>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} callsUsed={apiCalls} />}
      {showEmail   && <EmailCapture onComplete={() => { setShowEmail(false); setTimeout(() => sendMessage(), 100); }} />}
    </>
  );
}

const MAX_CALLS = 10;
