'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { postLead, stashPendingLead, flushPendingLead } from '@/lib/lead_retry';

export default function LandingEmailCapture() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone]       = useState(false);
  const [error, setError]     = useState('');
  const router = useRouter();

  // Retry any lead a previous visit failed to deliver (see lib/lead_retry.ts).
  useEffect(() => { void flushPendingLead(); }, []);

  const submit = async () => {
    const trimmed = email.trim();
    if (!trimmed.includes('@') || !trimmed.includes('.')) {
      setError('Enter a valid email');
      return;
    }
    setLoading(true);
    setError('');
    // Fail-open but not fail-forgetful (2026-07-20): still proceed on backend
    // failure, but stash the lead for retry instead of silently dropping it —
    // the old code also never checked res.ok, so 500s counted as success.
    const accepted = await postLead(trimmed, 'landing');
    if (!accepted) stashPendingLead(trimmed, 'landing');
    localStorage.setItem('lex_email', trimmed);
    localStorage.setItem('lex_email_captured', 'true');
    setDone(true);
    setTimeout(() => router.push('/console'), 800);
  };

  if (done) {
    return (
      <div className="flex items-center justify-center gap-2 text-sm font-mono mt-4"
        style={{ color: '#c9a84c' }}>
        <span>✓</span>
        <span>Opening console…</span>
      </div>
    );
  }

  return (
    <div className="mt-5 w-full max-w-sm mx-auto">
      <div className="flex gap-2">
        <input
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(''); }}
          onKeyDown={e => e.key === 'Enter' && submit()}
          placeholder="you@company.com"
          className="flex-1 min-w-0 bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-600 focus:outline-none focus:border-amber-700/50 focus:ring-1 focus:ring-amber-700/30 transition-all font-medium"
        />
        <button
          onClick={submit}
          disabled={loading}
          className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50 shrink-0"
          style={{
            background: 'linear-gradient(135deg, #c9a84c, #e8c96d, #c9a84c)',
            color: '#07070d',
          }}
        >
          {loading ? '…' : '⚡ Start Free'}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-400 mt-1.5 font-mono text-center">{error}</p>
      )}
      <p className="text-xs text-slate-500 dark:text-slate-600 text-center mt-2 font-bold">
        10 free governed runs · No credit card
      </p>
    </div>
  );
}
