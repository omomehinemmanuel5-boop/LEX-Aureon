'use client';
import { useState, useEffect } from 'react';

const G = {
  gold: '#c9a84c', goldL: '#e8c96d',
  navy: '#07070d', navyL: '#0d0d1a',
};

const DECISION_COLOR: Record<string, string> = {
  APPROVED: '#10b981', APPROVED_MEDIUM: '#10b981', APPROVED_HIGH: '#f59e0b',
  DENIED_INJECTION: '#ef4444', DENIED_BLOCKED: '#ef4444', DENIED_LOCKED: '#f59e0b',
};

interface LiveExample {
  decision: string; tool_name: string; receipt_id: string;
  c: number; r: number; s: number; m: number;
  risk_level: string; sigma_viol: number; reason: string; created_at: string;
}
interface LatestReflection {
  total_calls: number; approved: number; denial_rate_pct: number;
  avg_m: number; period_end: string;
}

/**
 * fix (2026-07-11) — REAL DATA, NOT HARDCODED EXAMPLES: this section
 * previously rendered a static array of 5 example receipts, labeled "Example
 * results from production runs" without actually reading production data.
 * Now fetches from /api/agency/live-examples — one real example per decision
 * category that has actually fired, read straight from tool_receipts. If a
 * category has never fired, it's simply absent — not fabricated. Same
 * honest-empty-state discipline as components/BenchmarkResults.tsx.
 *
 * feat (2026-07-11) — POSITION STATEMENT: added an explicit claim, tested
 * the same night this section's data went live -- the governance layer was
 * run against Claude (the AI collaborator building this system) itself, not
 * just described. Deliberately separated from the open, unproven research
 * question (whether constitutional structure lets smaller models match
 * larger ones agentically) -- that's labeled exploratory, not claimed as a
 * result, matching the rest of this site's standard.
 */
export default function EnterpriseSection() {
  const [examples, setExamples] = useState<LiveExample[]>([]);
  const [reflection, setReflection] = useState<LatestReflection | null>(null);
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/agency/live-examples')
      .then(r => r.json())
      .then(d => {
        setExamples(d.examples ?? []);
        setReflection(d.latest_reflection ?? null);
      })
      .catch(() => { /* honest empty state below handles this */ })
      .finally(() => setLoaded(true));
  }, []);

  const t = examples[active];

  return (
    <section className="py-24 px-5 bg-black/[0.03] dark:bg-[#0d0d1a]">
      <div className="max-w-4xl mx-auto">

        <div className="text-center mb-10">
          <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: '#10b981' }}>
            Agentic Constitutional Governance
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white mb-4">
            Constitutional proxy<br />
            <span className="text-slate-500 dark:text-slate-500 font-light">for AI agent tool calls.</span>
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm max-w-xl mx-auto leading-relaxed font-medium">
            Every tool call your AI agent makes passes through the constitutional governor
            before execution. Injection blocked. Destructive ops denied. Slow-drip attacks
            detected across sessions. SHA-256 receipt on every call.
          </p>
        </div>

        {/* Position statement — the actual claim, and the honest boundary of it */}
        <div className="rounded-2xl border p-6 mb-10" style={{ backgroundColor: '#07070d', borderColor: `${G.gold}28` }}>
          <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: G.gold }}>
            Our position
          </div>
          <p className="text-sm text-slate-300 leading-relaxed mb-4">
            Constitutional governance doesn&rsquo;t stop at generated text. The same C+R+S
            framework that governs a model&rsquo;s responses can score and gate what an
            agent actually <em>does</em> — before a tool call executes, not after. This
            isn&rsquo;t a diagram: the tool-call governor was tested against the AI system
            that builds this codebase, live, in the same session it was built —
            including catching that same AI&rsquo;s own miscalibrated detector on real
            calls before either of them reached anything that mattered.
          </p>
          <div className="h-px bg-white/10 my-4" />
          <p className="text-sm text-slate-400 leading-relaxed">
            <b className="text-slate-200">What we&rsquo;re exploring next, not claiming yet:</b>{' '}
            whether this same constitutional structure lets a smaller model match or
            exceed the agentic capability of much larger ones — not by being smarter,
            but by being verifiably accountable regardless of size. This is an open
            research question. We&rsquo;ll say so plainly if and when it&rsquo;s answered,
            the same way every other number on this site is reported.
          </p>
        </div>

        {/* Threat cards — background hardcoded dark, so text is always-light */}
        <div className="grid sm:grid-cols-3 gap-4 mb-10">
          {[
            { icon: '💉', title: 'Prompt Injection',  desc: 'Poisoned documents redirect your agent. Blocked before execution — including paraphrases a fixed pattern list would miss.' },
            { icon: '💣', title: 'Destructive Ops',   desc: 'DROP TABLE, rm -rf, credential writes. Hardcoded denial. No LLM.' },
            { icon: '🐌', title: 'Slow-Drip Attacks', desc: 'Single HIGH per turn strategy. Session locks on second HIGH in recovery.' },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="rounded-2xl border p-5 card-hover shadow-sm" style={{ backgroundColor: '#07070d', borderColor: 'rgba(255,255,255,0.08)' }}>
              <div className="text-2xl mb-3">{icon}</div>
              <div className="text-sm font-bold text-white mb-1">{title}</div>
              <div className="text-xs text-slate-400 leading-relaxed font-medium">{desc}</div>
            </div>
          ))}
        </div>

        {/* Test results — NOW LIVE, not hardcoded */}
        <div className="rounded-2xl border overflow-hidden mb-8 card-hover shadow-sm" style={{ backgroundColor: '#07070d', borderColor: '#c9a84c20' }}>
          <div className="px-6 py-3 border-b flex items-center gap-2 border-white/5">
            <span className={`w-2 h-2 rounded-full ${examples.length ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            <span className="text-xs font-mono text-slate-500">
              {examples.length ? 'Live receipts · read from tool_receipts' : loaded ? 'No governed tool calls recorded yet' : 'Loading live receipts…'}
            </span>
          </div>

          {examples.length > 0 && t && (
            <>
              <div className="flex border-b border-white/5 overflow-x-auto">
                {examples.map((ex, i) => (
                  <button
                    key={ex.receipt_id}
                    onClick={() => setActive(i)}
                    className="flex-1 py-2 text-xs font-mono transition-all whitespace-nowrap px-2"
                    style={{
                      background: active === i ? `${DECISION_COLOR[ex.decision] ?? G.gold}15` : 'transparent',
                      color: active === i ? (DECISION_COLOR[ex.decision] ?? G.gold) : '#94a3b8',
                      border: 'none',
                      borderBottom: active === i ? `2px solid ${DECISION_COLOR[ex.decision] ?? G.gold}` : '2px solid transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {ex.decision.replace('_', ' ')}
                  </button>
                ))}
              </div>
              <div className="p-6">
                <div className="text-xs font-mono text-slate-500 mb-2 font-bold">TOOL · REASON</div>
                <div className="bg-black/30 rounded-xl px-4 py-3 text-xs font-mono text-slate-300 mb-5 font-medium">
                  <span style={{ color: G.gold }}>{t.tool_name}</span> — {t.reason}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'DECISION', value: t.decision.replace('_', ' '), color: DECISION_COLOR[t.decision] ?? G.gold },
                    { label: 'RECEIPT',  value: t.receipt_id.slice(0, 16),    color: G.gold },
                    { label: 'M SCORE',  value: t.m.toFixed(3),               color: '#94a3b8' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-xl border p-3 text-center border-white/10"
                      style={{ background: `${color}12` }}>
                      <div className="text-[10px] font-mono text-slate-500 mb-1 font-bold">{label}</div>
                      <div className="text-xs font-bold font-mono" style={{ color }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {reflection && (
            <div className="px-6 py-4 border-t border-white/5 text-[11px] font-mono text-slate-500">
              Last self-reflection: {reflection.total_calls} calls, {reflection.approved} approved
              ({(100 - reflection.denial_rate_pct).toFixed(0)}% approval rate), mean M={reflection.avg_m.toFixed(3)}.
              Updated {new Date(reflection.period_end).toLocaleDateString()}.
            </div>
          )}
        </div>

        {/* Integration snippet — background hardcoded dark, so text is always-light */}
        <div className="rounded-2xl border p-6 mb-8 shadow-sm" style={{ backgroundColor: '#07070d', borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="text-xs font-mono uppercase tracking-widest mb-4 font-bold" style={{ color: G.gold }}>
            Integration — One URL Change
          </div>
          <div className="bg-slate-950 rounded-xl p-4 font-mono text-xs border border-white/5">
            <div className="text-slate-500 mb-1">{'// Before: agent calls tools directly'}</div>
            <div className="text-red-400 mb-4">{'target_mcp_url: "https://tools.yourcompany.com/mcp"'}</div>
            <div className="text-slate-500 mb-1">{'// After: route through constitutional proxy'}</div>
            <div className="text-emerald-400">{'target_mcp_url: "https://lexaureon.com/api/tool-proxy"'}</div>
          </div>
          <div className="text-xs text-slate-400 font-mono mt-3 font-bold">
            Every call intercepted · SHA-256 audit receipt · Full audit trail
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <a
            href="mailto:lexaureon@gmail.com?subject=Enterprise%20Agent%20Governance%20Inquiry"
            className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold transition-all active:scale-95 shadow-lg"
            style={{
              background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`,
              color: '#07070d',
              boxShadow: `0 8px 32px ${G.gold}30`,
            }}
          >
            Inquire About Enterprise Access &#8594;
          </a>
          <div className="text-xs text-slate-500 dark:text-slate-500 font-mono mt-3 font-bold">
            lexaureon@gmail.com · Response within 24 hours
          </div>
        </div>

      </div>
    </section>
  );
}
