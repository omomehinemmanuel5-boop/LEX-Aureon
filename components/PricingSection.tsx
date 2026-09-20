'use client';
import React from 'react';
import BitcoinUpgradeModal from '@/components/BitcoinUpgradeModal';
import {
  FREE_AGENT_TOOL_RUN_LIMIT,
  FREE_TEXT_RUNS_PER_DAY,
  FREE_TOOL_GOVERNANCE_FEATURES,
} from '@/lib/pricing';

const G = {
  gold:  '#c9a84c',
  goldL: '#e8c96d',
  goldD: '#a07830',
};

export default function PricingSection() {
  const [showBtcModal, setShowBtcModal] = React.useState(false);

  const plans = [
    {
      name: 'Explorer',
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
    <section id="pricing" className="py-24 px-5" style={{ backgroundColor: '#07070d' }}>
      {showBtcModal && <BitcoinUpgradeModal onClose={() => setShowBtcModal(false)} />}
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: G.gold }}>
            Pricing
          </div>
          {/*
            fix (2026-07-13) — DARK-ON-DARK: this section's background is
            unconditionally #07070d (see style prop above, no dark: variant,
            no light-mode override anywhere in this component). The text
            below previously used `text-slate-900 dark:text-white` /
            `text-slate-700 dark:text-slate-300` style hybrids — in light
            mode, that resolves to text-slate-900 (near-black) against a
            background that is ALWAYS near-black regardless of theme. Not
            low-contrast — close to invisible. The Hero section (same
            always-dark-background pattern) already established the correct
            approach: use unconditional light colors here, since the
            background never actually goes light. Every text color in this
            component below is now unconditional for that reason, not an
            oversight of the dark: variant.
          */}
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-3">
            Choose your governance tier
          </h2>
          <p className="text-xs text-slate-500 font-mono">
            Early supporter pricing — first 50 customers lock in this rate forever.
          </p>
        </div>

        {/* Plans */}
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {plans.map(plan => (
            <div
              key={plan.name}
              className="rounded-2xl border p-6 flex flex-col relative"
              style={{
                borderColor:  plan.highlight ? G.gold : 'rgba(0,0,0,0.08)',
                background:   plan.highlight ? `${G.gold}08` : 'rgba(0,0,0,0.02)',
                boxShadow:    plan.highlight ? `0 0 48px ${G.gold}18` : 'none',
              }}
            >
              {plan.badge && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap"
                  style={{
                    background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`,
                    color: '#07070d',
                  }}
                >
                  {plan.badge}
                </div>
              )}

              {/* Name + price */}
              <div className="mb-5">
                <div
                  className="text-xs font-mono uppercase tracking-widest mb-2 font-black"
                  style={{ color: plan.highlight ? G.gold : '#64748b' }}
                >
                  {plan.name}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-white">{plan.price}</span>
                  {plan.period && (
                    <span className="text-slate-500 text-sm font-bold">{plan.period}</span>
                  )}
                </div>
              </div>

              {/* Features */}
              <ul className="space-y-2 flex-1 mb-6">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-slate-300 font-medium leading-relaxed">
                    <span
                      className="flex-shrink-0 mt-0.5 font-black"
                      style={{ color: plan.highlight ? G.gold : '#10b981' }}
                    >
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <a
                href={plan.href}
                onClick={
                  plan.href === '#upgrade-sovereign'
                    ? (e) => { e.preventDefault(); setShowBtcModal(true); }
                    : undefined
                }
                className="block text-center py-3 rounded-xl text-sm font-bold transition-all active:scale-95"
                style={
                  plan.highlight
                    ? {
                        background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`,
                        color: '#07070d',
                        boxShadow: `0 4px 20px ${G.gold}30`,
                      }
                    : {
                        border: '1px solid rgba(0,0,0,0.1)',
                        color: '#475569',
                        background: 'rgba(0,0,0,0.02)',
                      }
                }
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>

        {/* What changed banner */}
        <div
          className="mt-8 rounded-2xl border px-5 py-4 text-center"
          style={{ borderColor: `${G.gold}25`, background: `${G.gold}06` }}
        >
          <div className="text-xs font-mono font-bold mb-1" style={{ color: G.gold }}>
            What changed in v2
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Sovereign is now $29/mo — with advanced response governance, live web sensing,
            cross-session memory, cryptographic receipts, and developer API access.
            Anyone who subscribed at $19 keeps that price forever.
          </p>
        </div>

        <div
          className="mt-4 rounded-2xl border px-5 py-4"
          style={{ borderColor: 'rgba(16,185,129,0.25)', background: 'rgba(16,185,129,0.05)' }}
        >
          <div className="text-xs font-mono font-bold mb-1 text-center" style={{ color: '#34d399' }}>
            What Explorer includes for free
          </div>
          <p className="text-xs text-slate-400 leading-relaxed text-center">
            Explorer includes {FREE_TEXT_RUNS_PER_DAY} text-governance runs per day in Console and{' '}
            {FREE_AGENT_TOOL_RUN_LIMIT.toLocaleString('en-US')} agent tool-governance runs through the Free API key.
            Text governance evaluates model responses; agent governance evaluates tool calls before execution.
            Free agent-tool turns still receive prompt-injection detection, constitutional approval or denial, CRS
            health context, and a SHA-256 governance receipt.
          </p>
        </div>

        <div className="mt-4 text-center text-xs text-slate-500 font-mono font-bold uppercase tracking-tighter">
          All plans include cryptographic audit receipts · AI governance always provable
        </div>

      </div>
    </section>
  );
}
