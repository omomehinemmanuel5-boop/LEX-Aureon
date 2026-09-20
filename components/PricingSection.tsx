'use client';
import React from 'react';
import BitcoinUpgradeModal from '@/components/BitcoinUpgradeModal';
import {
  FREE_AGENT_TOOL_RUN_LIMIT,
  FREE_TEXT_RUNS_PER_DAY,
  FREE_TOOL_GOVERNANCE_FEATURES,
} from '@/lib/pricing';

const G = {
  gold: '#c9a84c',
  goldL: '#e8c96d',
  goldD: '#a07830',
  ink: '#07070d',
  panel: '#0d0d1a',
};

export default function PricingSection() {
  const [showBtcModal, setShowBtcModal] = React.useState(false);

  const plans = [
    {
      name: 'Explorer',
      kicker: 'Start with the essentials',
      bestFor: 'Best for evaluating the control layer',
      price: '$0',
      period: undefined,
      badge: undefined,
      highlight: false,
      cta: 'Start Free →',
      href: '/console',
      features: [
        `${FREE_TEXT_RUNS_PER_DAY} free text-governance runs / day in Console`,
        `${FREE_AGENT_TOOL_RUN_LIMIT.toLocaleString('en-US')} agent tool-governance runs included`,
        'Live M-score dashboard',
        FREE_TOOL_GOVERNANCE_FEATURES[0],
        FREE_TOOL_GOVERNANCE_FEATURES[1],
        FREE_TOOL_GOVERNANCE_FEATURES[2],
        FREE_TOOL_GOVERNANCE_FEATURES[3],
        'Basic audit trail',
        'Constitutional simplex visualiser',
        'Community access',
      ],
    },
    {
      name: 'Sovereign',
      kicker: 'For serious builders',
      bestFor: 'Best for individual builders shipping to production',
      price: '$29',
      period: '/mo',
      badge: 'Most Popular',
      highlight: true,
      cta: 'Upgrade to Sovereign →',
      href: '#upgrade-sovereign',
      features: [
        '10,000 governed API runs for text and agent workflows',
        'Advanced text-response governance with Async Governor controls',
        'Live web sensing with reliability filtering',
        'Full safety metrics with Lyapunov + CBF checks',
        'Conversation and agent memory across sessions',
        'Cryptographic receipt for every governed run',
        'Exportable audit receipts (JSON)',
        'Developer API access and integration docs',
        'Evaluation and safety benchmark reports',
        'Priority email support',
      ],
    },
    {
      name: 'Team / Agency',
      kicker: 'Scale governed work',
      bestFor: 'Best for shared projects and multi-agent teams',
      price: '$99',
      period: '/mo',
      badge: 'For teams',
      highlight: false,
      cta: 'Start Team / Agency →',
      href: 'mailto:lexaureon@gmail.com?subject=Team%20%2F%20Agency%20Plan%20-%20%2499%2Fmo',
      features: [
        'Everything in Sovereign',
        'Shared team workspace for governed projects',
        'Shared API keys with team-level ownership',
        'Agent tool governance across your team',
        'Shared tool policies, allowlists + risk controls',
        'Centralized audit receipts and usage visibility',
        'Multi-agent session and trajectory oversight',
        'Priority implementation support',
      ],
    },
    {
      name: 'Enterprise / Custom',
      kicker: 'Governance for organizations',
      bestFor: 'Best for bespoke controls, deployment, and compliance',
      price: 'Custom',
      period: undefined,
      badge: 'For organizations',
      highlight: false,
      cta: 'Contact sales →',
      href: 'mailto:lexaureon@gmail.com?subject=Enterprise%20%2F%20Custom%20Plan%20Inquiry%20-%20Lex%20Aureon',
      features: [
        'Everything in Team / Agency',
        'Custom governance policies for your organization',
        'Custom thresholds, risk rules, and tool permissions',
        'Dedicated deployment or isolated kernel instance',
        'White-label governance API and customer-facing controls',
        'Security, compliance, and SLA documentation',
        'Implementation support and architecture guidance',
        'Custom usage, retention, and integration terms',
      ],
    },
  ];

  return (
    <section id="pricing" className="pricing-section scroll-mt-20 py-24 px-5" style={{ backgroundColor: G.ink }}>
      {showBtcModal && <BitcoinUpgradeModal onClose={() => setShowBtcModal(false)} />}
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] font-bold" style={{ borderColor: `${G.gold}55`, background: `${G.gold}0d`, color: G.goldL }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: G.goldL }} />
            Governance tiers
          </div>
          <h2 className="mt-5 text-3xl sm:text-5xl font-black text-white mb-3">Choose your governance tier</h2>
          <p className="text-sm text-slate-400 font-mono max-w-xl mx-auto leading-relaxed">
            Start free, then scale the same constitutional control layer from one console session to organization-wide oversight.
          </p>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#c9a84c]/20 bg-[#c9a84c]/15 sm:grid-cols-4">
          {[
            ['PROVABLE', 'Cryptographic receipts'],
            ['DROP-IN', 'No model retraining'],
            ['MODEL-AGNOSTIC', 'Works above any LLM'],
            ['LAGOS-BUILT', 'Independent engineering'],
          ].map(([label, detail]) => (
            <div key={label} className="bg-[#0d0d1a]/90 px-3 py-3.5 text-center sm:px-4">
              <div className="text-[10px] font-mono font-bold tracking-[0.15em]" style={{ color: G.goldL }}>{label}</div>
              <div className="mt-1 text-[11px] text-slate-400">{detail}</div>
            </div>
          ))}
        </div>

        <div className="pricing-grid grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {plans.map(plan => (
            <div
              key={plan.name}
              className={`pricing-card rounded-2xl border p-6 flex flex-col relative ${plan.highlight ? 'pricing-card-featured' : ''}`}
              style={{
                borderColor: plan.highlight ? G.gold : `${G.gold}35`,
                background: plan.highlight ? `linear-gradient(180deg, ${G.gold}16 0%, rgba(255,255,255,.035) 42%, rgba(255,255,255,.02) 100%)` : 'linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.018))',
                boxShadow: plan.highlight ? `0 0 0 1px ${G.gold}30, 0 0 56px ${G.gold}18` : `0 18px 50px rgba(0,0,0,.18)`,
              }}
            >
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full whitespace-nowrap" style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: G.ink }}>
                  {plan.badge}
                </div>
              )}

              <div className="mb-6">
                <div className="text-[10px] font-mono uppercase tracking-[0.16em] mb-2 font-bold" style={{ color: plan.highlight ? G.goldL : G.gold }}>
                  {plan.kicker}
                </div>
                <h3 className="text-xl font-black text-white mb-4">{plan.name}</h3>
                <p className="min-h-10 text-xs leading-relaxed text-slate-400">{plan.bestFor}</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-white">{plan.price}</span>
                  {plan.period && <span className="text-slate-400 text-sm font-bold">{plan.period}</span>}
                </div>
              </div>

              <div className="h-px mb-6" style={{ background: `linear-gradient(90deg, ${G.gold}80, transparent)` }} />

              <ul className="space-y-2.5 flex-1 mb-7">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-200 font-medium leading-relaxed">
                    <span className="flex-shrink-0 mt-0.5 font-black" style={{ color: G.goldL }}>✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <a
                href={plan.href}
                onClick={plan.href === '#upgrade-sovereign' ? (e) => { e.preventDefault(); setShowBtcModal(true); } : undefined}
                className="block text-center py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
                style={plan.highlight ? { background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: G.ink, boxShadow: `0 4px 20px ${G.gold}30` } : { border: `1px solid ${G.gold}55`, color: G.goldL, background: `${G.gold}0a` }}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border px-5 py-4 text-center" style={{ borderColor: `${G.gold}25`, background: `${G.gold}06` }}>
          <div className="text-xs font-mono font-bold mb-1" style={{ color: G.goldL }}>Early supporter pricing</div>
          <p className="text-sm text-slate-400 leading-relaxed">First 50 customers lock in this rate forever. Sovereign is now $29/mo; anyone who subscribed at $19 keeps that price forever.</p>
        </div>

        <div className="mt-4 rounded-2xl border px-5 py-4" style={{ borderColor: 'rgba(16,185,129,0.25)', background: 'rgba(16,185,129,0.05)' }}>
          <div className="text-xs font-mono font-bold mb-1 text-center text-emerald-300">What Explorer includes for free</div>
          <p className="text-sm text-slate-300 leading-relaxed text-center">
            Explorer includes {FREE_TEXT_RUNS_PER_DAY} text-governance runs per day in Console and {FREE_AGENT_TOOL_RUN_LIMIT.toLocaleString('en-US')} agent tool-governance runs through the Free API key. Text governance evaluates model responses; agent governance evaluates tool calls before execution.
          </p>
        </div>

        <div className="mt-5 text-center text-[10px] text-slate-500 font-mono font-bold uppercase tracking-[0.16em]">All plans include cryptographic audit receipts · AI governance always provable</div>
      </div>
    </section>
  );
}
