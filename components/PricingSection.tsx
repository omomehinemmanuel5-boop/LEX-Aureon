'use client';
import React from 'react';
import BitcoinUpgradeModal from '@/components/BitcoinUpgradeModal';

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
        '10 governed runs / day',
        'Live M-score dashboard',
        'Pre-eval attack signals',
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
        'Unlimited governed runs',
        'Async Governor G(x,z) — attractor basin steering',
        'IEC-filtered search sensing — ρ(t) reliability',
        'Full Lyapunov + CBF projection metrics',
        'z-trajectory memory across sessions',
        'SHA-256 audit receipt every turn',
        'Trust receipt exports (JSON)',
        'API access — /api-docs',
        'TruthfulQA + HarmBench benchmark reports',
        'Priority email support',
      ],
    },
    {
      name: 'Constitutional',
      price: 'Custom',
      period: undefined,
      badge: undefined,
      highlight: false,
      cta: 'Talk to Emmanuel →',
      href: 'mailto:lexaureon@gmail.com?subject=Enterprise Inquiry - Lex Aureon',
      features: [
        'Everything in Sovereign',
        'Custom τ, ρ_min + ε parameters',
        'Dedicated SERPER search budget for sensing',
        'White-label governor sensing API',
        'Dedicated kernel instance',
        'SLA + compliance documentation',
        'Direct line to Emmanuel King',
        'White-label option',
      ],
    },
  ];

  return (
    <section id="pricing" className="py-24 px-5" style={{ backgroundColor: '#07070d' }}>
      {showBtcModal && <BitcoinUpgradeModal onClose={() => setShowBtcModal(false)} />}
      <div className="max-w-4xl mx-auto">

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
        <div className="grid sm:grid-cols-3 gap-4">
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
            Sovereign raised to $29/mo — now includes the Async Governor G(x,z), IEC-filtered
            search sensing, z-trajectory memory, and published TruthfulQA + HarmBench results.
            Anyone who subscribed at $19 keeps that price forever.
          </p>
        </div>

        <div className="mt-4 text-center text-xs text-slate-500 font-mono font-bold uppercase tracking-tighter">
          All plans include cryptographic audit receipts · AI governance always provable
        </div>

      </div>
    </section>
  );
}
