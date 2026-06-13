'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import SignalPillBar from '@/components/SignalPillBar';
import UpgradeModal from '@/components/UpgradeModal';
import DynamicSimplex from '@/components/DynamicSimplex';
import EmailCapture from '@/components/EmailCapture';
import CountUp from '@/components/CountUp';
import { useToast } from '@/components/Toast';
import { useLexStream } from '@/lib/use_lex_stream';
import { EXAMPLE_PROMPTS } from '@/lib/example_prompts';
import { GovernanceResponse } from '@/types/governance-types';
import { isRefusal } from '@/lib/refusals';
import { ConstitutionalState, SemanticSignal } from '@/types';

const MAX_CALLS = 10;
type Tab = 'governed' | 'raw' | 'analysis' | 'audit';

/* ── Health band config ──────────────────────────────────────── */
const HEALTH_CFG: Record<string, { color: string; glow: string; label: string }> = {
  OPTIMAL:  { color: '#10b981', glow: '#10b98160', label: 'OPTIMAL'  },
  ALERT:    { color: '#f59e0b', glow: '#f59e0b60', label: 'ALERT'    },
  STRESSED: { color: '#f97316', glow: '#f9731660', label: 'STRESSED' },
  CRITICAL: { color: '#ef4444', glow: '#ef444460', label: 'CRITICAL' },
};

/* ── M Timeline ──────────────────────────────────────────────── */
function MTimeline({ history }: { history: Array<{ M: number; health: string; deltaV: number }> }) {
  if (!history.length) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-xs font-mono text-slate-700 mr-1">M:</span>
      {history.map((h, i) => {
        const cfg = HEALTH_CFG[h.health] ?? HEALTH_CFG.OPTIMAL;
        return (
          <div key={i} title={`Turn ${i + 1}: M=${h.M.toFixed(3)} ${h.health} δV=${h.deltaV > 0 ? '+' : ''}${h.deltaV.toFixed(3)}`}
            className="w-6 h-6 sm:w-5 sm:h-5 rounded flex items-center justify-center text-xs font-mono font-black transition-all hover:scale-110"
            style={{ background: `${cfg.color}18`, border: `1px solid ${cfg.color}40`, color: cfg.color, fontSize: 8 }}>
            {h.M.toFixed(2).slice(1)}
          </div>
        );
      })}
    </div>
  );
}

/* ── Lyapunov Sparkline ──────────────────────────────────────── */
function LyapunovSparkline({ history }: { history: Array<{ V: number; deltaV: number }> }) {
  if (history.length < 2) return null;
  const vals = history.map(h => h.V);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 0.001;
  const W = 200, H = 40;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  const last = history[history.length - 1];
  const trending = last.deltaV < 0;
  return (
    <div className="rounded-lg p-3" style={{ background: '#020408', border: '1px solid #1a2040' }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-slate-600">{'// Lyapunov V(t)'}</span>
        <span className="text-xs font-mono" style={{ color: trending ? '#10b981' : '#ef4444' }}>
          {trending ? '↓ converging' : '↑ diverging'}
        </span>
      </div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        <polyline points={pts} fill="none" stroke={trending ? '#10b981' : '#ef4444'} strokeWidth="1.5" />
        {vals.map((v, i) => {
          const x = (i / (vals.length - 1)) * W;
          const y = H - ((v - min) / range) * (H - 4) - 2;
          return <circle key={i} cx={x} cy={y} r="2" fill={trending ? '#10b981' : '#ef4444'} />;
        })}
      </svg>
      <div className="flex justify-between mt-1 text-xs font-mono text-slate-700">
        <span>V={vals[0].toFixed(4)}</span>
        <span>V={vals[vals.length - 1].toFixed(4)}</span>
      </div>
    </div>
  );
}

/* ── CRS Visualization Bar ────────────────────────────────────── */
function CRSVisualization({ state }: { state?: { C: number; R: number; S: number } }) {
  if (!state) return null;
  const { C, R, S } = state;
  const total = C + R + S || 1;
  const c_pct = (C / total) * 100;
  const r_pct = (R / total) * 100;
  const s_pct = (S / total) * 100;
  return (
    <div className="rounded p-3 space-y-2" style={{ background: '#020408', border: '1px solid #1a2040' }}>
      <div className="text-xs font-mono text-slate-600 mb-2">{'// Constitutional State (C+R+S=1)'}</div>
      <div className="flex gap-1 h-6 rounded overflow-hidden border" style={{ borderColor: '#1a2040' }}>
        <div className="flex items-center justify-center text-xs font-bold text-white" style={{ width: `${c_pct}%`, background: '#3b82f6', minWidth: '20px' }}>
          {c_pct > 15 && `C ${C.toFixed(2)}`}
        </div>
        <div className="flex items-center justify-center text-xs font-bold text-white" style={{ width: `${r_pct}%`, background: '#10b981', minWidth: '20px' }}>
          {r_pct > 15 && `R ${R.toFixed(2)}`}
        </div>
        <div className="flex items-center justify-center text-xs font-bold text-white" style={{ width: `${s_pct}%`, background: '#f59e0b', minWidth: '20px' }}>
          {s_pct > 15 && `S ${S.toFixed(2)}`}
        </div>
      </div>
      <div className="flex justify-between text-xs font-mono text-slate-600 mt-1">
        <span>Continuity: {C.toFixed(4)}</span>
        <span>Reciprocity: {R.toFixed(4)}</span>
        <span>Sovereignty: {S.toFixed(4)}</span>
      </div>
    </div>
  );
}

/* ── Kernel Metrics Panel ────────────────────────────────────── */
function KernelMetricsPanel({ kernel }: { kernel: Record<string, unknown> }) {
  const theta      = Number(kernel.theta        ?? 1.5);
  const effTheta   = Number(kernel.effective_theta ?? theta);
  const temp       = Number(kernel.temperature  ?? 0.5);
  const atkP       = Number(kernel.attack_pressure ?? 0);
  const dV         = Number(kernel.delta_V      ?? 0);
  const stabRatio  = Number(kernel.stability_ratio ?? 0);
  const mem        = Boolean(kernel.memory_injected);
  const sig        = (kernel.semantic_signal as { attack_type?: string; severity?: number }) ?? {};
  const metrics    = (kernel.metrics as { c_measured?: number; r_measured?: number; s_measured?: number }) ?? {};
  const proj       = Boolean(kernel.projection_triggered);
  const hcfg       = HEALTH_CFG[(kernel.health_band as string) ?? 'OPTIMAL'] ?? HEALTH_CFG.OPTIMAL;

  return (
    <div className="rounded-lg p-3 sm:p-4 font-mono text-xs space-y-2 sm:space-y-3"
      style={{ background: '#020408', border: '1px solid #1a2040' }}>
      <div className="text-slate-600 mb-1">{'// System State Overview'}</div>

      {/* Main metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          { label: 'θ', value: theta.toFixed(3), sub: `eff ${effTheta.toFixed(3)}`, color: '#c9a84c' },
          { label: 'Temp', value: temp.toFixed(2), sub: hcfg.label, color: hcfg.color },
          { label: 'atk_p', value: atkP.toFixed(3), sub: atkP > 0.1 ? 'elevated' : 'clear', color: atkP > 0.1 ? '#f97316' : '#334155' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="rounded p-2 text-center" style={{ background: '#0a0d18', border: '1px solid #1a2040' }}>
            <div className="font-black text-base leading-none" style={{ color }}>{value}</div>
            <div className="text-slate-700 mt-0.5" style={{ fontSize: 9 }}>{sub}</div>
            <div className="text-slate-600 uppercase tracking-wider" style={{ fontSize: 9 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* δV + stability */}
      <div className="flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2">
          <span className="text-slate-600">δV:</span>
          <span style={{ color: dV < 0 ? '#10b981' : '#ef4444' }}>
            {dV > 0 ? '+' : ''}{dV.toFixed(5)}
          </span>
          <span style={{ color: dV < 0 ? '#10b981' : '#ef4444', fontSize: 10 }}>
            {dV < -0.001 ? '↓ converging' : dV > 0.001 ? '↑ diverging' : '≈ stable'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-600">stab:</span>
          <span style={{ color: stabRatio > 0.6 ? '#10b981' : '#f59e0b' }}>
            {(stabRatio * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      {/* CCP / IEC / ADV */}
      {(metrics.c_measured !== undefined) && (
        <div className="flex gap-2 flex-wrap">
          <span className="text-slate-600">Research Metrics:</span>
          {[
            { l: 'CCP', v: metrics.c_measured, color: '#3b82f6' },
            { l: 'IEC', v: metrics.r_measured, color: '#10b981' },
            { l: 'ADV', v: metrics.s_measured, color: '#f59e0b' },
          ].map(({ l, v, color }) => (
            <span key={l} className="px-2 py-0.5 rounded" style={{ color, background: `${color}12`, border: `1px solid ${color}20` }}>
              {l}={typeof v === 'number' ? v.toFixed(3) : '?'}
            </span>
          ))}
        </div>
      )}

      {/* Flags */}
      <div className="flex gap-2 flex-wrap">
        {mem && <span className="px-2 py-0.5 rounded" style={{ color: '#a855f7', background: '#a855f712', border: '1px solid #a855f730' }}>Memory Injected</span>}
        {proj && <span className="px-2 py-0.5 rounded" style={{ color: '#ef4444', background: '#ef444412', border: '1px solid #ef444430' }}>Stability Projection</span>}
        {sig.attack_type && sig.attack_type !== 'none' && (
          <span className="px-2 py-0.5 rounded" style={{ color: '#f97316', background: '#f9731612', border: '1px solid #f9731630' }}>
            Attack Detected: {sig.attack_type} (Severity: {sig.severity})
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Terminal progress bar ──────────────────────────────────── */
function TermProgressBar({ value, max = 1, color = '#22c55e', label }: { value: number; max?: number; color?: string; label?: string }) {
  const pct = Math.min(1, value / max);
  const filled = Math.round(pct * 15);
  const empty = 15 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const display = (value * 100).toFixed(1);

  return (
    <span className="font-mono" style={{ color }}>
      [{bar}] {display}% {label}
    </span>
  );
}

/* ── Terminal timestamp ─────────────────────────────────────── */
function TS() {
  return (
    <span className="text-slate-600 font-mono text-xs select-none mr-2">
      [{new Date().toISOString().slice(11, 19)}]
    </span>
  );
}

/* ── Main Console ─────────────────────────────────────────── */
export default function Console() {
  const [prompt, setPrompt] = useState('');
  const [apiCalls, setApiCalls] = useState(0);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [tab, setTab] = useState<Tab>('governed');
  const [pulse, setPulse] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [totalRuns, setTotalRuns] = useState<number | null>(null);
  const [outputLines, setOutputLines] = useState<{ ts: string; text: string; color: string }[]>([]);
  const [sessionId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'console';
    const stored = localStorage.getItem('lex_session_id');
    if (stored) return stored;
    const id = `console_${crypto.randomUUID()}`;
    localStorage.setItem('lex_session_id', id);
    return id;
  });
  const resultsRef = useRef<HTMLDivElement>(null);
  const [sessionHistory, setSessionHistory] = useState<Array<{ M: number; health: string; deltaV: number; V: number }>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { state: stream, run: runStream, cancel } = useLexStream();
  const toast = useToast();

  // Derived view state, kept name-compatible with previous render code below
  const loading = stream.loading;
  const error = stream.error;
  const res = stream.complete as GovernanceResponse | null;

  useEffect(() => {
    fetch('/api/stats').then(r => r.json()).then(d => setTotalRuns(d.runs)).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('dev_reset') === 'true') {
        localStorage.removeItem('lex_api_calls');
        setApiCalls(0);
        window.history.replaceState({}, '', '/console');
        return;
      }
    }
    const s = localStorage.getItem('lex_api_calls');
    if (s) setApiCalls(parseInt(s));
  }, []);

  useEffect(() => {
    localStorage.setItem('lex_api_calls', apiCalls.toString());
  }, [apiCalls]);

  const addLine = useCallback((text: string, color = '#22c55e') => {
    const ts = new Date().toISOString().slice(11, 19);
    setOutputLines(prev => [...prev.slice(-200), { ts, text, color }]);
  }, []);

  const run = useCallback(async (promptOverride?: string) => {
    const p = (promptOverride ?? prompt).trim();
    if (apiCalls >= MAX_CALLS) { setShowUpgrade(true); return; }
    if (typeof window !== 'undefined' && !localStorage.getItem('lex_email_captured') && apiCalls === 0) {
      setShowEmail(true); return;
    }
    if (!p) return;

    setPulse(false);
    setTab('governed');
    addLine('> Starting safety analysis...', '#c9a84c');
    await runStream(p, sessionId);
  }, [apiCalls, prompt, runStream, sessionId, addLine]);

  const loadExample = useCallback((examplePrompt: string) => {
    setPrompt(examplePrompt);
    if (textareaRef.current) textareaRef.current.focus();
  }, []);

  // ── Side effects driven by stream events ──────────────────────
  useEffect(() => {
    if (!stream.preEval) return;
    addLine(`> Initial assessment: ${stream.preEval.label}`, '#3b82f6');
    if (stream.preEval.blocked) {
      addLine('> Request declined', '#ef4444');
      toast.push('Request declined', 'error');
    }
  }, [stream.preEval, addLine, toast]);

  useEffect(() => {
    if (!stream.metrics) return;
    const m = stream.metrics;
    addLine(`> Measuring response alignment...`, '#3b82f6');
    addLine(
      `> Stability: ${m.health === 'SAFE' ? 'Optimal' : m.health}`,
      m.health === 'SAFE' ? '#22c55e' : '#ef4444',
    );
  }, [stream.metrics, addLine]);

  useEffect(() => {
    if (!stream.intervention) return;
    if (stream.intervention.triggered) {
      addLine(`> Intervention triggered: ${stream.intervention.action}`, '#f97316');
      if (stream.intervention.law_invoked) {
        addLine(`> Law invoked: ${stream.intervention.law_invoked.name} (${stream.intervention.law_invoked.book})`, '#f97316');
      }
    }
    if (stream.intervention.triggered) {
      addLine(`> Stability adjustment applied.`, '#f97316');
      toast.push(`Stability adjustment applied.`, 'warning');
    } else {
      addLine(`> No stability adjustment needed.`, '#22c55e');
      toast.push(`No adjustment needed.`, 'success');
    }
  }, [stream.intervention, addLine, toast]);

  // Track M history for timeline + Lyapunov sparkline
  // Log all pipeline stages to terminal
  const streamGovernor = stream.governor;
  useEffect(() => {
    if (!streamGovernor) return;
    const g = streamGovernor;
    addLine(`> Governance status: ${g.decision === 'INTERVENE' ? 'Adjustment required' : 'Verified'}`, g.decision === 'INTERVENE' ? '#ef4444' : '#22c55e');
  }, [streamGovernor, addLine]);

  const streamLaw = stream.law;
  useEffect(() => {
    if (!streamLaw) return;
    addLine(`> Applying principle: ${streamLaw.name}`, '#c9a84c');
  }, [streamLaw, addLine]);

  const streamSR = stream.selfReferential;
  useEffect(() => {
    if (!streamSR) return;
    const color = streamSR.sovereignty_violated ? '#ef4444' : '#22c55e';
    if (streamSR.sovereignty_violated) {
      addLine(`> Self-validation: Sovereignty violation detected. Request declined.`, color);
    } else if (streamSR.fired) {
      addLine(`> Self-validation: Adjustment applied.`, color);
    }
  }, [streamSR, addLine]);

  const streamStageDesc = stream.stageDescription;
  useEffect(() => {
    if (!streamStageDesc) return;
    addLine(`> Stage: ${streamStageDesc}`, '#1e293b');
  }, [streamStageDesc, addLine]);

  useEffect(() => {
    if (!stream.neithra) return;
    const n = stream.neithra;
    if (n.approved) {
      addLine(`> Alignment verified. Law applied: ${n.final_law_id ? n.final_law_id : 'N/A'}`, '#22c55e');
    } else {
      addLine(`> Alignment check failed. Reason: ${n.rationale}`, '#ef4444');
    }
  }, [stream.neithra, addLine]);

  useEffect(() => {
    if (!stream.clauseBank) return;
    const cb = stream.clauseBank;
    if (cb.found) {
      addLine(`> Clause Bank: Guideline found - ${cb.clause_id} (${cb.topic})`, '#3b82f6');
    } else {
      addLine(`> Clause Bank: No guideline found.`, '#ef4444');
    }
  }, [stream.clauseBank, addLine]);

  useEffect(() => {
    if (!stream.vaulturex) return;
    const vx = stream.vaulturex;
    if (vx.compliant) {
      addLine(`> Vaulturex: Compliance check passed. Risk level: ${vx.risk_level}`, '#22c55e');
    } else {
      addLine(`> Vaulturex: Compliance check failed. Risk level: ${vx.risk_level}. Flags: ${vx.flags.join(', ')}`, '#ef4444');
    }
  }, [stream.vaulturex, addLine]);

  useEffect(() => {
    if (!stream.celeste) return;
    const c = stream.celeste;
    addLine(`> Celeste: Output format set to ${c.format}. Template: ${c.template}`, '#3b82f6');
  }, [stream.celeste, addLine]);

  useEffect(() => {
    if (!stream.styleAgent) return;
    const sa = stream.styleAgent;
    addLine(`> Style Agent: Output cleaned. Original length: ${sa.original_length}, Cleaned length: ${sa.cleaned_length}`, '#3b82f6');
  }, [stream.styleAgent, addLine]);

  const streamComplete = stream.complete;
  useEffect(() => {
    if (!streamComplete) return;
    const k = streamComplete as unknown as Record<string, unknown>;
    const M     = Number(k?.M ?? (streamComplete as GovernanceResponse)?.metrics?.m ?? 0);
    const health = String(k?.health_band ?? 'OPTIMAL');
    const deltaV = Number(k?.delta_V ?? 0);
    const V      = Number(k?.lyapunov_V ?? 0);
    setSessionHistory(prev => [...prev.slice(-19), { M, health, deltaV, V }]);
  }, [streamComplete]);

  useEffect(() => {
    if (!stream.auditId) return;
    addLine(`> Audit receipt: ${stream.auditId}`, '#c9a84c');
  }, [stream.auditId, addLine]);

  useEffect(() => {
    if (stream.stage !== 'complete' || !stream.complete) return;
    setApiCalls((c) => c + 1);
    setTotalRuns((t) => (t !== null ? t + 1 : null));
    setPulse(true);
    const id = setTimeout(() => setPulse(false), 2500);
    addLine('> Run complete.', '#64748b');
    toast.push('Run complete', 'success');
    return () => clearTimeout(id);
  }, [stream.stage, stream.complete, addLine, toast]);

  useEffect(() => {
    if (!stream.error) return;
    addLine(`> ERROR: ${stream.error}`, '#ef4444');
    toast.push(stream.error, 'error');
  }, [stream.error, addLine, toast]);

  // Use stream.metrics (from crs event: c,r,s,m) for pillar display — NOT res.metrics
  // res.metrics uses c_measured/r_measured/s_measured from paper-exact computation
  const m = stream.metrics ?? (res?.metrics as unknown as typeof stream.metrics) ?? null;
  const intervened = res?.intervention?.triggered || res?.intervention?.applied || false;

  // Kernel fields — available from complete event (kernel stream)
  const kx = res;
  const healthBand   = String(kx?.health_band ?? m?.health_band ?? 'OPTIMAL');
  const kHcfg        = HEALTH_CFG[healthBand] ?? HEALTH_CFG.OPTIMAL;
  const isKernel     = String(kx?.version ?? '').includes('SovereignKernel');
  const semanticSig  = (kx?.semantic_signal as { attack_type?: string; severity?: number }) ?? {};
  const isAttack     = semanticSig?.attack_type && semanticSig.attack_type !== 'none';
  const projTriggered = Boolean(kx?.projection_triggered);
  const memInjected  = Boolean(kx?.memory_injected);
  const showRawTab   = isAttack || projTriggered;
  const pct = Math.round((apiCalls / MAX_CALLS) * 100);

  // Was the anchored output materially changed by the governor?
  // - rewritten: intervention replaced the anchored response entirely
  // - unchanged: governor passed; anchored == governed
  // Compare anchored vs governed (NOT raw vs governed — raw is now the bare
  // LLM and would always differ from governed by construction).
  const anchoredText = res?.anchored_output ?? '';
  const isHardRefusal = res ? isRefusal(res.governed_output) : false;
  const outputDiffers = !!res && res.governed_output !== anchoredText;
  const outputMode: 'rewritten' | 'unchanged' =
    (outputDiffers || isHardRefusal) ? 'rewritten' : 'unchanged';

  // Raw tab only shown when attack detected or CBF fired (glass box)
  const allTabs: { id: Tab; icon: string; label: string }[] = [
    { id: 'governed', icon: '✦', label: 'Output' },
    { id: 'raw',      icon: '⊙', label: showRawTab ? 'Raw ⚠' : 'Raw' },
    { id: 'analysis', icon: '⬡', label: 'Analysis' },
    { id: 'audit',    icon: '🔐', label: 'Audit' },
  ];
  const tabs = allTabs;

  return (
    <div
      className="min-h-screen text-white flex flex-col terminal-scanlines"
      style={{ background: '#050810', fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace" }}
    >
      {/* ── Terminal Header Bar ─────────────────────────── */}
      <div
        className="sticky top-0 z-40 flex items-center justify-between px-4 py-2 border-b"
        style={{
          background: '#0a0d18',
          borderColor: '#1a2040',
          boxShadow: '0 1px 20px rgba(0,0,0,0.6)',
        }}
      >
        {/* macOS dots */}
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full" style={{ background: '#ff5f57' }} />
          <span className="w-3 h-3 rounded-full" style={{ background: '#ffbd2e' }} />
          <span className="w-3 h-3 rounded-full" style={{ background: '#28c840' }} />
          <span className="ml-4 text-xs font-mono font-bold" style={{ color: '#c9a84c' }}>
            LEX AUREON · SovereignKernel v2 · CONSTITUTIONAL TERMINAL
          </span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xs font-mono text-slate-600 hover:text-slate-400 transition-colors">
            ← home
          </Link>
          {/* Usage */}
          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <TermProgressBar value={apiCalls} max={MAX_CALLS} color={pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : '#22c55e'} label={`${apiCalls}/${MAX_CALLS}`} />
            </div>
            <span className="sm:hidden text-xs font-mono text-slate-500">{apiCalls}/{MAX_CALLS}</span>
          </div>
          <button
            onClick={() => setShowUpgrade(true)}
            className="text-xs px-3 py-1 rounded border font-mono transition-all hover:opacity-80"
            style={{ borderColor: '#c9a84c40', color: '#c9a84c', background: '#c9a84c0a' }}
          >
            upgrade
          </button>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-36 space-y-4">

          {/* ── Global Runs Counter ─────────────────────── */}
          <div
            className="rounded-lg border px-4 py-3 flex items-center justify-between"
            style={{ background: '#070b14', borderColor: '#1a2040' }}
          >
            <div className="flex items-center gap-3">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: '#22c55e', boxShadow: '0 0 8px #22c55e' }}
              />
              <span className="text-xs font-mono uppercase tracking-widest" style={{ color: '#64748b' }}>
                Total governed runs
              </span>
            </div>
            {totalRuns !== null ? (
              <CountUp
                value={totalRuns}
                className="text-xl sm:text-2xl font-bold font-mono tabular-nums"
                style={{ color: '#c9a84c', textShadow: '0 0 12px rgba(201,168,76,0.35)' }}
              />
            ) : (
              <span
                className="text-xl sm:text-2xl font-bold font-mono tabular-nums"
                style={{ color: '#64748b' }}
                aria-label="Loading total runs"
              >
                ———
              </span>
            )}
          </div>

          {/* ── Terminal Input ──────────────────────────── */}
          <div
            className="rounded-lg border p-4"
            style={{ background: '#070b14', borderColor: '#1a2040' }}
          >
            {/* Input label */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-mono" style={{ color: '#c9a84c' }}>root@lex-praxis:~$</span>
              <span className="text-xs font-mono text-slate-500">governance --prompt</span>
              <span className="ml-auto text-xs font-mono text-slate-700">{MAX_CALLS - apiCalls} runs left</span>
            </div>

            <div className="relative">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={e => setPrompt(e.target.value.slice(0, 5000))}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && prompt.trim() && !loading) run();
                }}
                placeholder="Enter prompt for constitutional governance..."
                rows={4}
                className="w-full rounded p-3 text-sm leading-relaxed resize-none focus:outline-none focus:ring-1"
                style={{
                  background: '#040609',
                  border: '1px solid #1a2040',
                  color: '#22c55e',
                  caretColor: '#22c55e',
                  fontFamily: 'inherit',
                }}
              />
              {/* blinking cursor indicator */}
              {!prompt && (
                <span
                  className="absolute left-3 top-3 pointer-events-none"
                  style={{
                    display: 'inline-block',
                    width: 8, height: 14,
                    background: '#22c55e',
                    animation: 'term-blink 1s step-end infinite',
                    opacity: 0.7,
                  }}
                />
              )}
            </div>

            {/* Signal pills */}
            <SignalPillBar prompt={prompt} />

            {/* Example prompt chips — single-row horizontal scroll, shows only before first run */}
            {!res && !loading && (
              <div
                className="flex items-center gap-1.5 mt-3 -mx-1 px-1 overflow-x-auto"
                style={{ scrollbarWidth: 'none' }}
                aria-label="Example prompts"
              >
                <span className="flex-shrink-0 text-xs font-mono mr-1" style={{ color: '#475569' }}>
                  try ↦
                </span>
                {EXAMPLE_PROMPTS.map((ex) => {
                  const palette = {
                    identity:    { bg: '#07162b15', border: '#1e3a5f', color: '#60a5fa' },
                    bypass:      { bg: '#1a120515', border: '#78350f', color: '#fbbf24' },
                    sycophancy:  { bg: '#051a1015', border: '#065f46', color: '#34d399' },
                    benign:      { bg: '#0a0d1815', border: '#1a2040', color: '#94a3b8' },
                  }[ex.attack_type];
                  return (
                    <button
                      key={ex.id}
                      onClick={() => loadExample(ex.prompt)}
                      type="button"
                      title={ex.expected}
                      aria-label={`Load example: ${ex.label}`}
                      className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-mono whitespace-nowrap transition-all hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
                      style={{ background: palette.bg, border: `1px solid ${palette.border}`, color: palette.color, opacity: 0.85 }}
                    >
                      {ex.label}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between mt-3">
              <span className="text-xs font-mono text-slate-700">{prompt.length}/5000</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-700 hidden sm:block">⌘+Enter to run</span>
                <button
                  onClick={() => run()}
                  disabled={!prompt.trim() || loading || apiCalls >= MAX_CALLS}
                  className="px-5 py-2 rounded text-xs font-bold font-mono transition-all active:scale-95 disabled:opacity-30"
                  style={{
                    background: prompt.trim() && !loading && apiCalls < MAX_CALLS
                      ? 'linear-gradient(90deg, #c9a84c, #e8c96d)'
                      : '#1a2040',
                    color: prompt.trim() && !loading && apiCalls < MAX_CALLS ? '#07070d' : '#475569',
                  }}
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                      executing...
                    </span>
                  ) : apiCalls >= MAX_CALLS ? 'limit reached' : '⚡ run governance'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Terminal Output Log ─────────────────────── */}
          {outputLines.length > 0 && (
            <div
              className="rounded-lg border p-4 font-mono text-xs space-y-1 max-h-48 overflow-y-auto"
              style={{ background: '#040609', borderColor: '#1a2040' }}
              role="log"
              aria-live="polite"
              aria-atomic="false"
              aria-label="Governance pipeline log"
            >
              <div className="text-slate-700 mb-2">{'// system output'}</div>
              {outputLines.map((line, i) => (
                <div key={i} className="flex items-start gap-2">
                  <span className="text-slate-700 flex-shrink-0">[{line.ts}]</span>
                  <span style={{ color: line.color }}>{line.text}</span>
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-700">[{new Date().toISOString().slice(11, 19)}]</span>
                  <span style={{ color: '#c9a84c' }}>
                    {'> '}
                    <span style={{ animation: 'term-blink 0.8s step-end infinite', display: 'inline-block', background: '#c9a84c', width: 6, height: 12, verticalAlign: 'middle' }} />
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Error ──────────────────────────────────── */}
          {error && (
            <div
              className="rounded-lg border p-4 font-mono text-xs"
              style={{ background: '#1a0505', borderColor: '#7f1d1d' }}
            >
              <div className="text-red-400">⚠ ERROR · {new Date().toISOString().slice(11, 19)}</div>
              <div className="text-red-300 mt-1">{error}</div>
            </div>
          )}

          {/* ── Streaming Output (live tokens) ───────────── */}
          {loading && stream.partialOutput && (
            <div
              className="rounded-lg border p-4 font-mono text-sm leading-relaxed"
              style={{ background: '#020408', borderColor: '#1a2040', color: '#86efac' }}
              aria-live="polite"
              aria-label="Streaming governed output"
            >
              <div className="flex items-center justify-between mb-2 text-xs">
                <span style={{ color: '#c9a84c' }}>{'// generating · stage: ' + stream.stage}</span>
                <button
                  onClick={cancel}
                  type="button"
                  className="px-2 py-0.5 rounded text-xs font-mono"
                  style={{ background: '#1a0505', color: '#f87171', border: '1px solid #7f1d1d' }}
                >
                  cancel
                </button>
              </div>
              <div>
                {stream.partialOutput}
                <span
                  className="inline-block w-2 h-4 align-text-bottom ml-0.5"
                  style={{ background: '#22c55e', animation: 'term-blink 0.8s step-end infinite' }}
                />
              </div>
            </div>
          )}

          {/* ── Loading (pre-token) ─────────────────────── */}
          {loading && !stream.partialOutput && (
            <div
              className="rounded-lg border p-6 flex flex-col items-center gap-3"
              style={{ background: '#040609', borderColor: '#1a2040' }}
              aria-live="polite"
            >
              <div className="relative w-12 h-12">
                <div className="absolute inset-0 border-2 border-slate-800 border-t-green-500 rounded-full animate-spin" />
                <div className="absolute inset-1 border border-transparent border-b-amber-500 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.7s' }} />
              </div>
              <div className="text-center font-mono">
                <p className="text-xs text-green-400">
                  {stream.stage === 'pre_eval' ? 'Pre-evaluating constitutional risk...' : 'Initiating constitutional governance pipeline...'}
                </p>
                <p className="text-xs text-slate-600 mt-1">extracting CRS · checking M · evaluating velocity</p>
              </div>
            </div>
          )}

          {/* ── Results ─────────────────────────────────── */}
          {res && !loading && (
            <div ref={resultsRef} className="space-y-4">

              {/* Governor status */}
              {intervened ? (
                <div
                  className="rounded-lg border p-4 font-mono text-xs"
                  style={{ background: '#1a0505', borderColor: '#7f1d1d' }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-red-400 text-sm">⚠</span>
                    <span className="text-red-400 font-bold text-sm">GOVERNOR INTERVENED · mode: {res.intervention?.type ?? 'correction'}</span>
                  </div>
                  <div className="text-red-300/70">{res.intervention?.reason ?? 'Constitutional threshold violated'}</div>
                </div>
              ) : (
                <div
                  className="rounded-lg border p-3 font-mono text-xs flex items-center gap-2"
                  style={{ background: '#050f0a', borderColor: '#14532d' }}
                >
                  <span className="text-green-400">✓</span>
                  <span className="text-green-400">GOVERNOR PASSED · constitutional bounds maintained</span>
                  <span className="ml-auto text-slate-600">M = {((m?.m ?? 0) * 100).toFixed(1)}%</span>
                </div>
              )}

              {/* CRS Visualization */}
              {kx?.state && typeof kx.state === 'object' && 'C' in (kx.state as Record<string, unknown>) && (
                <CRSVisualization state={kx.state as unknown as { C: number; R: number; S: number }} />
              )}

              {/* M score terminal bar */}
              {m && (
                <div
                  className="rounded-lg border p-4 font-mono text-xs space-y-2"
                  style={{ background: '#040609', borderColor: '#1a2040' }}
                >
                  <div className="text-slate-500 mb-3">{'// constitutional state · M score'}</div>
                  {[
                    { key: 'C', val: m.c, label: 'Continuity', color: '#3b82f6' },
                    { key: 'R', val: m.r, label: 'Reciprocity', color: '#10b981' },
                    { key: 'S', val: m.s, label: 'Sovereignty', color: '#f59e0b' },
                    { key: 'M', val: m.m, label: m.m <= 0.05 ? '⚠ BELOW τ' : m.m < 0.08 ? '⚠ STRESSED' : 'SAFE', color: m.m <= 0.05 ? '#ef4444' : m.m < 0.08 ? '#f59e0b' : '#22c55e' },
                  ].map(({ key, val, label, color }) => (
                    <div key={key} className="flex items-center gap-3">
                      <span className="w-4 text-right font-bold" style={{ color }}>{key}</span>
                      <span className="flex-1">
                        <TermProgressBar value={val} color={color} label={label} />
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* M timeline */}
              {sessionHistory.length > 0 && (
                <div className="rounded-lg px-3 py-2 flex items-center gap-2 flex-wrap"
                  style={{ background: '#040609', border: '1px solid #1a2040' }}>
                  <MTimeline history={sessionHistory} />
                </div>
              )}

              {/* Tab bar (terminal style) */}
              <div
                className="rounded-lg border overflow-hidden"
                style={{ background: '#040609', borderColor: '#1a2040' }}
              >
                <div
                  className="flex border-b"
                  style={{ borderColor: '#1a2040' }}
                >
                  {tabs.map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-mono transition-all"
                      style={{
                        color: tab === t.id ? '#c9a84c' : '#475569',
                        background: tab === t.id ? '#0f1929' : 'transparent',
                        borderBottom: tab === t.id ? '1px solid #c9a84c' : '1px solid transparent',
                      }}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>

                <div className="p-4">
                  {/* Output tab */}
                  {tab === 'governed' && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                          <TS />
                          {/* Health band badge */}
                          {isKernel && (
                            <span className="text-xs font-mono px-2 py-0.5 rounded-full font-bold"
                              style={{ color: kHcfg.color, background: `${kHcfg.color}12`, border: `1px solid ${kHcfg.color}40`, boxShadow: `0 0 6px ${kHcfg.color}30` }}>
                              {healthBand}
                            </span>
                          )}
                          {memInjected && (
                            <span className="text-xs font-mono px-2 py-0.5 rounded-full"
                              style={{ color: '#a855f7', background: '#a855f712', border: '1px solid #a855f730' }}>
                              🧠 memory
                            </span>
                          )}
                          {isAttack && (
                            <span className="text-xs font-mono px-2 py-0.5 rounded-full"
                              style={{ color: '#f97316', background: '#f9731612', border: '1px solid #f9731630' }}>
                              🛡️ {semanticSig.attack_type}
                            </span>
                          )}
                          {projTriggered && (
                            <span className="text-xs font-mono px-2 py-0.5 rounded-full"
                              style={{ color: '#ef4444', background: '#ef444412', border: '1px solid #ef444430' }}>
                              ⚡ CBF
                            </span>
                          )}
                          {!isKernel && (
                            <span className="text-xs font-mono" style={{ color: outputMode === 'rewritten' ? '#f59e0b' : '#22c55e' }}>
                              {outputMode === 'rewritten' ? '// governed response' : '// passed review'}
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-mono uppercase tracking-widest px-2 py-0.5 rounded"
                          style={
                            outputMode === 'rewritten' ? { background: '#1c1005', color: '#fb923c', border: '1px solid #7c2d12' }
                            : { background: '#052017', color: '#4ade80', border: '1px solid #14532d' }
                          }>{outputMode === 'rewritten' ? 'governed' : 'safe'}</span>
                      </div>

                      <div
                        className="rounded p-4 max-h-64 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap"
                        style={{
                          background: '#020408',
                          border: `1px solid ${outputMode === 'rewritten' ? '#92400e30' : '#14532d30'}`,
                          color: outputMode === 'rewritten' ? '#fcd34d' : '#86efac',
                          fontFamily: 'inherit',
                        }}
                      >
                        {res.governed_output}
                      </div>
                    </div>
                  )}

                  {/* Raw tab — bare LLM output, no constitutional preamble. The
                      "what would the LLM say without governance" baseline. */}
                  {tab === 'raw' && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <TS />
                        <span className="text-xs font-mono text-slate-500">{'// bare LLM output · no constitutional anchor'}</span>
                      </div>
                      <div
                        className="rounded p-4 max-h-64 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap"
                        style={{ background: '#020408', border: '1px solid #1a2040', color: '#64748b', fontFamily: 'inherit' }}
                      >
                        {res.raw_output || '[empty — governor refused the prompt; no bare generation made]'}
                      </div>
                    </div>
                  )}

                  {/* Analysis tab */}
                  {tab === 'analysis' && m && (
                    <div className="space-y-4">
                      {/* Kernel metrics panel */}
                      {isKernel && kx && <KernelMetricsPanel kernel={kx as unknown as Record<string, unknown>} />}

                      {/* Governor panel */}
                      {stream.governor && (
                        <div className="rounded-lg p-4 font-mono text-xs space-y-2"
                          style={{ background: '#020408', border: '1px solid #1a2040' }}>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-600">{'// Governor — Section 11 replicator dynamics'}</span>
                            <span style={{ color: stream.governor.decision === 'INTERVENE' ? '#ef4444' : '#22c55e' }}>
                              {stream.governor.decision}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { k: 'V_before', v: stream.governor.V_before?.toFixed(5), color: '#94a3b8' },
                              { k: 'V_after',  v: stream.governor.V_after?.toFixed(5),  color: '#94a3b8' },
                              { k: 'dV',       v: stream.governor.dV?.toFixed(5),        color: stream.governor.dV < 0 ? '#22c55e' : '#ef4444' },
                              { k: 'Lyapunov', v: stream.governor.lyapunov_stable ? '✓ stable' : '⚠ breach', color: stream.governor.lyapunov_stable ? '#22c55e' : '#ef4444' },
                            ].map(({ k, v, color }) => (
                              <div key={k} className="flex gap-2">
                                <span className="text-slate-600 w-16">{k}:</span>
                                <span style={{ color }}>{v}</span>
                              </div>
                            ))}
                          </div>
                          {stream.governor.reason && (
                            <div className="text-slate-700 text-xs">{stream.governor.reason}</div>
                          )}
                        </div>
                      )}

                      {/* Law invoked */}
                      {stream.law && (
                        <div className="rounded-lg p-3 font-mono text-xs"
                          style={{ background: '#0a0800', border: '1px solid #c9a84c25' }}>
                          <div className="text-slate-600 mb-1">{'// Vaulturex law invoked'}</div>
                          <div className="font-bold" style={{ color: '#c9a84c' }}>
                            [{stream.law.book}] {stream.law.name}
                          </div>
                          <div className="text-slate-500 mt-1">{stream.law.governor_use}</div>
                        </div>
                      )}

                      {/* Self-referential CRS */}
                      {stream.selfReferential && (
                        <div className="rounded-lg p-3 font-mono text-xs"
                          style={{ background: stream.selfReferential.sovereignty_violated ? '#1a0505' : '#020408', border: `1px solid ${stream.selfReferential.sovereignty_violated ? '#ef444430' : '#1a2040'}` }}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-slate-600">{'// Self-referential CRS'}</span>
                            <span style={{ color: stream.selfReferential.sovereignty_violated ? '#ef4444' : '#22c55e' }}>
                              {stream.selfReferential.sovereignty_violated ? 'Identity drift detected' : 'Identity confirmed'}
                            </span>
                          </div>
                          <div className="flex gap-4 text-xs">
                            <span className="text-slate-600">S_raw: <span style={{ color: stream.selfReferential.sovereignty_raw < 0.15 ? '#ef4444' : '#22c55e' }}>{stream.selfReferential.sovereignty_raw?.toFixed(3)}</span></span>
                            <span className="text-slate-600">Adjustment Applied: <span style={{ color: stream.selfReferential.fired ? '#ef4444' : '#22c55e' }}>{stream.selfReferential.fired ? 'Yes' : 'No'}</span></span>
                          </div>
                        </div>
                      )}

                      {/* Lyapunov sparkline */}
                      {sessionHistory.length >= 2 && (
                        <LyapunovSparkline history={sessionHistory} />
                      )}

                      <DynamicSimplex
                        liveC={m.c} liveR={m.r} liveS={m.s} liveM={m.m}
                        intervention={intervened}
                        healthBand={res.metrics.health_band ?? 'OPTIMAL'}
                        animating={pulse}
                      />

                      {/* z_traj terminal readout */}
                      {res.z_traj && (() => {
                        const z = res.z_traj!;
                        return (
                          <div
                            className="rounded p-4 font-mono text-xs space-y-1"
                            style={{ background: '#020408', border: '1px solid #1a2040' }}
                          >
                            <div className="text-slate-600 mb-2">{'// z_traj state vector'}</div>
                            {[
                              { key: 'velocity', val: z.velocity.toFixed(3), color: z.velocity < 0.1 ? '#22c55e' : z.velocity < 0.3 ? '#f59e0b' : '#ef4444' },
                              { key: 'n_stable', val: String(z.n_stable), color: z.n_stable >= 3 ? '#22c55e' : z.n_stable >= 1 ? '#f59e0b' : '#ef4444' },
                              { key: 'drift_dir', val: z.drift_dir || 'none', color: z.drift_dir && z.drift_dir !== 'none' ? '#f59e0b' : '#22c55e' },
                              { key: 'σ_viol', val: z.sigma_viol.toFixed(3), color: z.sigma_viol < 0.1 ? '#22c55e' : z.sigma_viol < 0.25 ? '#f59e0b' : '#ef4444' },
                            ].map(({ key, val, color }) => (
                              <div key={key} className="flex items-center gap-2">
                                <span className="text-slate-600">{'>'}</span>
                                <span className="text-slate-400 w-20">{key}:</span>
                                <span className="font-bold" style={{ color }}>{val}</span>
                              </div>
                            ))}
                            {z.sigma_viol >= 0.25 && (
                              <div className="mt-2 pt-2 border-t" style={{ borderColor: '#1a2040' }}>
                                <span style={{ color: '#f97316' }}>⚠ slow-drip erosion detected · σ={z.sigma_viol.toFixed(3)}</span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Triggers */}
                      {res.triggers && (
                        <div
                          className="rounded p-3 font-mono text-xs"
                          style={{ background: '#020408', border: '1px solid #1a2040' }}
                        >
                          <div className="text-slate-600 mb-2">{'// trigger analysis'}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {res.triggers.collapse && <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#1a0505', color: '#f87171', border: '1px solid #7f1d1d' }}>M_collapse</span>}
                            {res.triggers.velocity && <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#1c1005', color: '#fb923c', border: '1px solid #7c2d12' }}>‖dx/dt‖&gt;δ</span>}
                            {res.triggers.per_invariant?.C && <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#07162b', color: '#60a5fa', border: '1px solid #1e3a5f' }}>dC/dt&lt;-ε</span>}
                            {res.triggers.per_invariant?.R && <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#051a10', color: '#34d399', border: '1px solid #065f46' }}>dR/dt&lt;-ε</span>}
                            {res.triggers.per_invariant?.S && <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#1a1205', color: '#fbbf24', border: '1px solid #78350f' }}>dS/dt&lt;-ε</span>}
                            {!res.triggers.collapse && !res.triggers.velocity && !res.triggers.per_invariant?.C && !res.triggers.per_invariant?.R && !res.triggers.per_invariant?.S && (
                              <span className="px-2 py-0.5 rounded text-xs" style={{ background: '#052017', color: '#4ade80', border: '1px solid #14532d' }}>✓ no_triggers</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Audit tab */}
                  {tab === 'audit' && (
                    <div className="font-mono text-xs space-y-3">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-slate-500">{'// governance audit trail'}</span>
                        <div className="flex gap-2">
                          {res.audit_id && (
                            <a href={`/audit/${res.audit_id}`} target="_blank" rel="noopener noreferrer"
                              className="px-2.5 py-1 rounded text-xs font-mono transition-all hover:opacity-80"
                              style={{ background: '#c9a84c15', color: '#c9a84c', border: '1px solid #c9a84c30' }}>
                              share ↗
                            </a>
                          )}
                          <button
                            onClick={() => {
                              const blob = new Blob([JSON.stringify({ audit_id: res.audit_id, timestamp: res.timestamp, metrics: res.metrics, intervention: res.intervention }, null, 2)], { type: 'application/json' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url; a.download = `lex-audit-${res.audit_id}.json`;
                              a.click(); URL.revokeObjectURL(url);
                            }}
                            className="px-2.5 py-1 rounded text-xs font-mono transition-all hover:opacity-80"
                            style={{ background: '#1a2040', color: '#64748b', border: '1px solid #1a2040' }}
                          >
                            export ↓
                          </button>
                        </div>
                      </div>
                      {[
                        { label: 'audit_id', value: res.audit_id ?? 'N/A', color: '#c9a84c', href: res.audit_id ? `/audit/${res.audit_id}` : undefined },
                        { label: 'version', value: String(kx?.version ?? 'PRAXIS'), color: '#64748b', href: undefined },
                        { label: 'health_band', value: healthBand, color: kHcfg.color, href: undefined },
                        { label: 'M', value: String(Number(kx?.M ?? m?.m ?? 0).toFixed(4)), color: kHcfg.color, href: undefined },
                        { label: 'timestamp', value: res.timestamp ? new Date(res.timestamp).toISOString() : 'N/A', color: '#94a3b8', href: undefined },
                        { label: 'governor', value: projTriggered ? 'CBF PROJECTION' : intervened ? 'INTERVENED' : 'PASSED', color: projTriggered ? '#ef4444' : intervened ? '#f59e0b' : '#22c55e', href: undefined },
                        { label: 'pre_eval', value: stream.preEval?.label ?? 'N/A', color: stream.preEval?.label === 'HIGH' ? '#ef4444' : '#22c55e', href: undefined },
                        { label: 'law', value: stream.law ? `${stream.law.book} — ${stream.law.name}` : 'none', color: stream.law ? '#c9a84c' : '#334155', href: undefined },
                      ].map(({ label, value, color, href }) => (
                        <div key={label}
                          className="rounded p-3"
                          style={{ background: '#020408', border: '1px solid #1a2040' }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-slate-600">{'>'}</span>
                            <span className="text-slate-500 w-24">{label}:</span>
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="break-all underline underline-offset-2 hover:opacity-80 transition-opacity"
                                style={{ color }}
                              >
                                {value}
                              </a>
                            ) : (
                              <span className="break-all" style={{ color }}>{value}</span>
                            )}
                          </div>
                        </div>
                      ))}
                      <div className="rounded p-3 max-h-40 overflow-y-auto"
                        style={{ background: '#020408', border: '1px solid #1a2040' }}>
                        <div className="text-slate-600 mb-1">{'>'} metrics:</div>
                        <pre className="text-xs" style={{ color: '#22c55e' }}>
                          {JSON.stringify({ c: m?.c, r: m?.r, s: m?.s, m: m?.m, intervention: intervened }, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick re-run */}
              <div className="flex items-center gap-2 p-3 rounded font-mono text-xs"
                style={{ background: '#040609', border: '1px solid #1a2040' }}>
                <span className="text-slate-600 flex-1">{'>'} run complete — edit prompt or re-run</span>
                <button onClick={() => run()} disabled={!prompt.trim() || loading || apiCalls >= MAX_CALLS}
                  className="px-3 py-1 rounded text-xs font-mono transition-all disabled:opacity-30"
                  style={{ background: '#c9a84c15', color: '#c9a84c', border: '1px solid #c9a84c30' }}>
                  {apiCalls >= MAX_CALLS ? 'upgrade ↗' : '↺ re-run'}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Sticky Bottom Bar ─────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 border-t safe-area-pb"
        style={{ background: '#050810e6', borderColor: '#1a2040', backdropFilter: 'blur(12px)' }}
      >
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          {res && (
            <div className="flex gap-1 flex-1">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className="flex-1 py-2.5 rounded text-xs font-mono transition-all"
                  style={{
                    background: tab === t.id ? '#c9a84c' : '#0a0d18',
                    color: tab === t.id ? '#07070d' : '#475569',
                    border: `1px solid ${tab === t.id ? '#c9a84c' : '#1a2040'}`,
                  }}>
                  {t.icon}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => run()}
            disabled={!prompt.trim() || loading || apiCalls >= MAX_CALLS}
            className={`${res ? 'flex-shrink-0 px-5' : 'w-full'} py-3 rounded text-xs font-bold font-mono transition-all active:scale-95 disabled:opacity-30`}
            style={{
              background: prompt.trim() && !loading && apiCalls < MAX_CALLS
                ? 'linear-gradient(90deg, #c9a84c, #e8c96d)'
                : '#0a0d18',
              color: prompt.trim() && !loading && apiCalls < MAX_CALLS ? '#07070d' : '#475569',
              border: '1px solid #1a2040',
            }}
          >
            {loading ? '...' : apiCalls >= MAX_CALLS ? 'upgrade ↗' : res ? '↺ re-run' : '⚡ run governance'}
          </button>
        </div>
      </div>

      {showUpgrade && <UpgradeModal onClose={() => setShowUpgrade(false)} callsUsed={apiCalls} />}
      {showEmail && (
        <EmailCapture onComplete={() => {
          setShowEmail(false);
          setTimeout(() => run(), 100);
        }} />
      )}
    </div>
  );
}
