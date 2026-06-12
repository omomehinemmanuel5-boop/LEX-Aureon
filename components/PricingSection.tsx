'use client';
import React from 'react';
import BitcoinUpgradeModal from '@/components/BitcoinUpgradeModal';

const G = {
  gold:    '#c9a84c',
  goldL:   '#e8c96d',
  goldD:   '#a07830',
  silver:  '#d4d4d4',
  navy:    '#07070d',
  navyL:   '#0d0d1a',
  C: '#3b82f6',
  R: '#10b981',
  S: '#f59e0b',
};


/* ── Pricing ────────────────────────────────────────────────── */
export default function PricingSection() {
  const [showBtcModal, setShowBtcModal] = React.useState(false);
  const plans = [
    {
      name: 'Explorer', price: '$0', cta: 'Start Free',
      href: '/console', highlight: false,
      features: ['10 governed runs/day', 'Constitutional dashboard', 'Pre-eval signals', 'Basic audit trail', 'Community access'],
    },
    {
      name: 'Sovereign', price: '$19', period: '/mo', cta: 'Upgrade to Sovereign →',
      href: '#upgrade-sovereign',
      highlight: true, badge: 'Most Popular',
      features: ['Unlimited governed runs', 'Full Lyapunov audit logs', 'CBF projection metrics', 'Trust receipt exports (JSON)', 'API access — /api-docs', 'Priority email support'],
    },
    {
      name: 'Constitutional', price: 'Custom', cta: 'Talk to Emmanuel →',
      href: 'mailto:lexaureon@gmail.com?subject=Enterprise Inquiry - Lex Aureon',
      highlight: false,
      features: ['Everything in Sovereign', 'Dedicated kernel instance', 'Custom τ and ε parameters', 'SLA + compliance docs', 'Direct line to Emmanuel King', 'White-label option'],
    },
  ];

  return (
    <section id="pricing" className="py-24 px-5 bg-white dark:bg-[#07070d]">
      {showBtcModal && <BitcoinUpgradeModal onClose={() => setShowBtcModal(false)} />}
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-4">
          <div className="text-xs font-mono uppercase tracking-widest mb-3 font-bold" style={{ color: G.gold }}>Pricing</div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white mb-3">Choose your governance tier</h2>
          <p className="text-xs text-slate-500 dark:text-slate-600 font-mono">
            Early supporter pricing — first 50 customers lock in this rate forever.
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mt-10">
          {plans.map(plan => (
            <div key={plan.name}
              className="rounded-2xl border p-6 flex flex-col relative bg-black/5 dark:bg-[#0d0d1a] border-black/10 dark:border-white/5"
              style={{
                borderColor: plan.highlight ? G.gold : undefined,
                background: plan.highlight ? `${G.gold}08` : undefined,
                boxShadow: plan.highlight ? `0 0 40px ${G.gold}15` : 'none',
              }}>
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold px-3 py-1 rounded-full"
                  style={{ background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`, color: '#07070d' }}>
                  {plan.badge}
                </div>
              )}
              <div className="mb-5">
                <div className="text-xs font-mono uppercase tracking-widest mb-2 font-bold"
                  style={{ color: plan.highlight ? G.gold : '#64748b' }}>{plan.name}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-black text-slate-900 dark:text-white">{plan.price}</span>
                  {plan.period && <span className="text-slate-500 text-sm">{plan.period}</span>}
                </div>
              </div>
              <ul className="space-y-2 flex-1 mb-6">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                    <span style={{ color: plan.highlight ? G.gold : '#10b981' }} className="flex-shrink-0 mt-0.5 font-bold">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a href={plan.href}
                onClick={plan.href === '#upgrade-sovereign' ? (e) => { e.preventDefault(); setShowBtcModal(true); } : undefined}
                target={plan.href.startsWith('mailto') ? undefined : undefined}
                className="block text-center py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
                style={plan.highlight ? {
                  background: `linear-gradient(135deg, ${G.gold}, ${G.goldL})`,
                  color: '#07070d',
                } : {
                  border: '1px solid rgba(0,0,0,0.1)',
                  color: '#475569',
                }}>
                {plan.cta}
              </a>
            </div>
          ))}
        </div>

        <div className="mt-8 text-center text-xs text-slate-600 font-mono">
          All plans include cryptographic audit receipts. Your AI governance is always provable.
        </div>
      </div>
    </section>
  );
}

