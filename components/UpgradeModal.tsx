'use client';

import { useState } from 'react';

interface UpgradeModalProps {
  onClose: () => void;
  callsUsed: number;
}

async function startCheckout(plan: 'pro' | 'enterprise'): Promise<string | null> {
  if (plan === 'enterprise') return 'mailto:lexaureon@gmail.com';

  try {
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    if (res.ok) {
      const data = await res.json() as { checkout_url?: string };
      return data.checkout_url ?? null;
    }
  } catch { /* fall through */ }

  return 'mailto:lexaureon@gmail.com?subject=Pro%20Upgrade%20Request';
}

export default function UpgradeModal({ onClose, callsUsed }: UpgradeModalProps) {
  const [loading, setLoading] = useState<'pro' | 'enterprise' | null>(null);

  const handleUpgrade = async (plan: 'pro' | 'enterprise') => {
    setLoading(plan);
    const url = await startCheckout(plan);
    setLoading(null);
    if (url) {
      if (url.startsWith('mailto:')) {
        window.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const plans = [
    {
      id: 'free' as const,
      name: 'Free',
      price: '$0',
      period: 'forever',
      features: ['10 runs / day', 'Constitutional dashboard', 'Pre-eval signals', 'Basic audit trail'],
      cta: null,
      note: 'You are currently on this plan',
      cardStyle: 'border-slate-700 bg-slate-800/40',
      ctaStyle: '',
      dimmed: true,
    },
    {
      id: 'pro' as const,
      name: 'Pro',
      price: '$19',
      period: '/ month',
      features: [
        '2,000 governance runs / month',
        'Full audit ledger',
        'Cryptographic trust receipts',
        'API key access',
        'Governor configuration (τ, ε)',
        'Priority support',
      ],
      cta: 'Upgrade to Pro',
      note: null,
      cardStyle: 'border-blue-700/70 bg-blue-950/30',
      ctaStyle: 'bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white shadow-lg shadow-blue-900/40',
      dimmed: false,
    },
    {
      id: 'enterprise' as const,
      name: 'Enterprise',
      price: 'Custom',
      period: 'pricing',
      features: [
        'Unlimited runs',
        'Dedicated governance kernel',
        'Custom CRS thresholds',
        'Compliance reporting',
        'SSO / SAML',
        'SLA guarantee',
      ],
      cta: 'Contact Sales',
      note: null,
      cardStyle: 'border-purple-800/50 bg-purple-950/20',
      ctaStyle: 'border border-purple-700/60 text-purple-300 hover:border-purple-500 hover:bg-purple-900/20',
      dimmed: false,
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white">Upgrade your plan</h2>
              <p className="text-sm text-slate-400 mt-1">
                You&apos;ve used <span className="text-blue-400 font-semibold">{callsUsed}</span> free
                governance runs. Upgrade to continue.
              </p>
            </div>
            <button onClick={onClose}
              className="text-slate-500 hover:text-slate-300 transition-colors text-xl leading-none mt-0.5 flex-shrink-0">
              ✕
            </button>
          </div>
        </div>

        {/* Plans */}
        <div className="p-4 grid sm:grid-cols-3 gap-3">
          {plans.map((plan) => (
            <div key={plan.id}
              className={`rounded-xl border p-4 flex flex-col ${plan.cardStyle} ${plan.dimmed ? 'opacity-60' : ''}`}>
              <div className="mb-3">
                <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">{plan.name}</div>
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-black text-white">{plan.price}</span>
                  <span className="text-xs text-slate-500">{plan.period}</span>
                </div>
              </div>

              <ul className="space-y-1.5 mb-4 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-slate-300">
                    <span className="text-emerald-400 flex-shrink-0 mt-0.5">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {plan.cta ? (
                <button
                  onClick={() => handleUpgrade(plan.id as 'pro' | 'enterprise')}
                  disabled={loading === plan.id}
                  className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all active:scale-95 disabled:opacity-60 ${plan.ctaStyle}`}>
                  {loading === plan.id ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      Loading...
                    </span>
                  ) : plan.cta}
                </button>
              ) : (
                <div className="text-xs text-slate-500 text-center py-2">{plan.note ?? ''}</div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-2 flex items-center justify-between gap-4">
          <p className="text-xs text-slate-600">
            <a href="https://doi.org/10.5281/zenodo.18944242"
              target="_blank" rel="noopener noreferrer"
              className="text-slate-500 hover:text-slate-300 transition-colors">
              Powered by the Aureonics framework ↗
            </a>
          </p>
          <button onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors">
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
