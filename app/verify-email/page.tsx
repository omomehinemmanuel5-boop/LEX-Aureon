'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function VerifyEmailPage() {
  const [token, setToken] = useState('');
  const [continuation, setContinuation] = useState('');
  const [continuationSig, setContinuationSig] = useState('');
  const [status, setStatus] = useState<'ready' | 'loading' | 'done' | 'error'>('ready');
  const [message, setMessage] = useState('Confirm your email address to activate your account.');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token') ?? '');
    setContinuation(params.get('continue') ?? '');
    setContinuationSig(params.get('continue_sig') ?? '');
  }, []);

  const verify = async () => {
    setStatus('loading');
    try {
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, continuation, continuation_sig: continuationSig }),
      });
      const result = await response.json() as { error?: string; continuationUrl?: string | null };
      if (!response.ok) throw new Error(result.error ?? 'Verification failed.');
      setStatus('done');
      const destination = result.continuationUrl || '/approvals';
      setMessage(result.continuationUrl ? 'Your email is verified. Returning to your ChatGPT connection…' : 'Your email is verified. Opening your account workspace…');
      window.setTimeout(() => window.location.assign(destination), 700);
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Verification failed.');
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-5">
      <section className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-7">
        <h1 className="text-2xl font-semibold">Verify your Lex Aureon account</h1>
        <p className="mt-3 text-sm text-slate-300" role={status === 'error' ? 'alert' : 'status'}>{message}</p>
        {status === 'ready' && <button disabled={!token} onClick={verify} className="mt-6 rounded-lg bg-blue-600 px-5 py-3 font-medium text-white disabled:opacity-50">Verify email</button>}
        {status === 'loading' && <p className="mt-6 text-sm text-slate-400">Verifying…</p>}
        {status === 'error' && <Link className="mt-6 inline-block text-sm text-blue-300 underline" href="/">Return to Lex Aureon</Link>}
      </section>
    </main>
  );
}
