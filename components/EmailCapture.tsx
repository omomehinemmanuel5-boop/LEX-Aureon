'use client';

import { useState } from 'react';
import Image from 'next/image';
import { postLead, stashPendingLead } from '@/lib/lead_retry';

interface EmailCaptureProps {
  onComplete: (email: string) => void;
}

export default function EmailCapture({ onComplete }: EmailCaptureProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!email.includes('@')) { setError('Enter a valid email'); return; }
    setLoading(true);
    // Fail-open, but no longer fail-forgetful (2026-07-20): the visitor is
    // always let through, and if the backend didn't accept the lead (network
    // error OR non-2xx response — the old code never checked res.ok, so 500s
    // passed as success), it's stashed and retried on later visits. See
    // lib/lead_retry.ts.
    const accepted = await postLead(email, 'console_gate');
    if (!accepted) stashPendingLead(email, 'console_gate');
    localStorage.setItem('lex_email', email);
    localStorage.setItem('lex_email_captured', 'true');
    setLoading(false);
    onComplete(email);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(7,7,13,0.95)', backdropFilter: 'blur(12px)' }}>
      <div className="w-full max-w-sm rounded-2xl border border-white/10 p-6 relative"
        style={{ background: '#0d0d18' }}>

        {/* Logo */}
        <div className="flex justify-center mb-5">
          <Image src="/logo.png" alt="Lex Aureon" width={64} height={64} className="w-16 h-16 rounded-xl object-cover" />
        </div>

        {/* Gold divider */}
        <div className="h-px mb-5" style={{
          background: 'linear-gradient(90deg, transparent, #c9a84c, transparent)'
        }}/>

        <h2 className="text-lg font-bold text-white text-center mb-1">
          Start governing your AI
        </h2>
        <p className="text-xs text-slate-500 text-center mb-5 leading-relaxed">
          Get 10 free governed runs. Constitutional AI governance — real math, real audit trail.
        </p>

        <input
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="you@company.com"
          className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-700/50 focus:ring-1 focus:ring-amber-700/30 mb-2 transition-all"
          autoFocus
        />

        {error && <p className="text-xs text-red-400 mb-2 font-mono">{error}</p>}

        <button onClick={handleSubmit} disabled={loading}
          className="w-full py-3 rounded-xl text-sm font-bold text-white transition-all active:scale-95 disabled:opacity-50 mb-4"
          style={{
            background: 'linear-gradient(135deg, #c9a84c, #e8c96d, #c9a84c)',
            backgroundSize: '200% auto',
            color: '#0a0a14',
          }}>
          {loading ? 'Activating...' : '⚡ Activate 10 Free Runs'}
        </button>

        <div className="flex items-center justify-center gap-4 text-xs text-slate-600">
          <span>✓ No credit card</span>
          <span>✓ No spam</span>
          <span>✓ Cancel anytime</span>
        </div>

        <div className="mt-4 pt-4 border-t border-white/5 text-center">
          <span className="text-xs text-slate-700 font-mono">
            Lex Aureon · Constitutional AI · lexaureon@gmail.com
          </span>
        </div>
      </div>
    </div>
  );
}
