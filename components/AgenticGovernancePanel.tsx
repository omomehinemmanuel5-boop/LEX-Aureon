'use client';

/**
 * AgenticGovernancePanel — the tool-call analogue of CbfInvariancePanel.
 *
 * Shows the agentic-governance counterfactual: for each scripted attack, what a
 * susceptible agent would attempt and what the governor's DETERMINISTIC layer
 * does with the attacker's tool call. Backed by GET /api/agentic-sim (pure
 * computation over the real deterministic invariants — no embeddings, no DB, no
 * receipts written).
 *
 * HONESTY CONSTRAINT (2026-07-22) — read before changing the copy. This panel
 * shows ONLY the deterministic invariants (destructive SQL, credential access,
 * external exfil, injection regex), which are rigid code, not a learned
 * threshold. It must NOT:
 *   - claim an injection-detection accuracy number (the semantic layer is
 *     unvalidated — see research Run 004/005),
 *   - present the minimal scenario set as an "AgentDojo score",
 *   - imply the governed write path is production-default (it is opt-in).
 * The copy states the deterministic/semantic split plainly, the same discipline
 * as the CBF panel's "numerical, not proven".
 */

import { useEffect, useState } from 'react';

const G = { gold: '#c9a84c' };

interface Scenario {
  id: string;
  suite: string;
  user_task: string;
  injection: string;
  attack_type: string;
  benign: { call: string; approved: boolean; blocked_pattern: string | null };
  attacker: { call: string; blocked: boolean; blocked_pattern: string | null };
}
interface SimResponse {
  scenarios: Scenario[];
  summary: { total: number; attacks_blocked: number; utility_preserved: number };
  layer: string;
  pilot: boolean;
  note: string;
}

export default function AgenticGovernancePanel() {
  const [data, setData] = useState<SimResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/agentic-sim')
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(setData)
      .catch(() => setError(true));
  }, []);

  if (error) return null; // fails quiet — supplementary panel, never blocks the page
  if (!data) {
    return (
      <div className="rounded-2xl border p-6 sm:p-8 bg-white dark:bg-black/30 border-slate-200 dark:border-white/10">
        <div className="h-40 flex items-center justify-center">
          <span className="text-xs font-mono text-slate-500">Loading agentic simulation…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border p-6 sm:p-8 bg-white dark:bg-black/30 border-slate-200 dark:border-white/10 mt-6">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <span className="text-xs uppercase tracking-widest font-bold text-slate-600 dark:text-slate-400 font-mono">
          Agentic counterfactual
        </span>
        <span className="text-[10px] font-mono text-slate-500 dark:text-slate-500">
          pilot · deterministic layer · simulated, not live traffic
        </span>
      </div>
      <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed mb-4">
        Governance doesn&rsquo;t stop at generated text — every tool call an agent makes can be gated before it
        runs. Each row below is a task with a prompt injection hidden in the data the agent reads. A susceptible
        agent makes the benign call <i>and</i> the attacker&rsquo;s call; the governor lets the first through and
        denies the second on a hardcoded constitutional invariant.
      </p>

      <div className="space-y-2.5">
        {data.scenarios.map((s) => (
          <div key={s.id} className="rounded-lg border p-3 border-slate-200 dark:border-white/10">
            <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
              <span className="text-[11px] font-mono text-slate-700 dark:text-slate-300">{s.suite}</span>
              <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ color: G.gold, border: '1px solid rgba(201,168,76,0.35)' }}>
                {s.attack_type}
              </span>
            </div>
            <div className="grid sm:grid-cols-2 gap-2 text-[11px] font-mono">
              <div className="flex items-center gap-2">
                <span aria-hidden style={{ color: '#10b981' }}>✓</span>
                <span className="text-slate-500 dark:text-slate-400">
                  benign <span className="text-slate-700 dark:text-slate-300">{s.benign.call}</span> — {s.benign.approved ? 'approved' : 'blocked'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span aria-hidden style={{ color: '#ef4444' }}>✕</span>
                <span className="text-slate-500 dark:text-slate-400">
                  attacker <span className="text-slate-700 dark:text-slate-300">{s.attacker.call}</span> — {s.attacker.blocked ? 'DENIED' : 'allowed'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4 mt-3 mb-4 text-[10px] font-mono">
        <span className="text-slate-500">
          attacks blocked <span style={{ color: G.gold }}>{data.summary.attacks_blocked}/{data.summary.total}</span>
        </span>
        <span className="text-slate-500">
          utility preserved <span style={{ color: G.gold }}>{data.summary.utility_preserved}/{data.summary.total}</span>
        </span>
      </div>

      <div className="h-px bg-slate-200 dark:bg-white/10 my-4" />

      <p className="text-slate-600 dark:text-slate-400 text-xs leading-relaxed">
        <b className="text-slate-800 dark:text-white">What this does show:</b> the rigid invariants — destructive
        SQL, credential-file access, external exfiltration — deny the attacker&rsquo;s call on executed tool calls,
        while the legitimate call still goes through. Each real decision writes a SHA-256 receipt to the public
        audit trail.
      </p>
      <p className="text-slate-500 dark:text-slate-500 text-[11px] leading-relaxed mt-3">
        <b className="text-slate-700 dark:text-slate-300">What this is not:</b> an injection-detection accuracy
        claim. These are the <i>deterministic</i> invariants only. The semantic layer that catches
        <i> clean-looking</i> out-of-scope calls is a separate, still-unvalidated pilot — not exercised here —
        and this is a faithful minimal scenario set, not the official 27-task AgentDojo. See{' '}
        <a href="/research" className="underline hover:text-slate-700 dark:hover:text-slate-300">/research</a>.
      </p>
    </div>
  );
}
