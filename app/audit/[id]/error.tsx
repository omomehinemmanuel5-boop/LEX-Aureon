'use client';

import Link from 'next/link';

export default function AuditError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#07070d' }}>
      <div
        className="max-w-md w-full rounded-2xl p-8 text-center"
        style={{ background: '#f5f0e8', color: '#1a1209', boxShadow: '0 0 0 1px rgba(201,168,76,0.3), 0 40px 80px rgba(0,0,0,0.6)' }}
      >
        <div className="text-4xl mb-3">⚠️</div>
        <h1 className="text-xl font-black mb-2" style={{ fontFamily: 'Georgia, serif' }}>
          Could not render receipt
        </h1>
        <p className="text-sm mb-1" style={{ color: '#8b6914' }}>{error.message}</p>
        {error.digest && (
          <p className="text-xs font-mono mb-4" style={{ color: '#a07830' }}>digest: {error.digest}</p>
        )}
        <div className="flex gap-2 justify-center mt-4">
          <button onClick={reset} className="px-4 py-2 rounded-lg text-sm font-mono" style={{ background: '#c9a84c', color: '#07070d' }}>
            retry
          </button>
          <Link href="/console" className="px-4 py-2 rounded-lg text-sm font-mono" style={{ border: '1px solid #d4b896', color: '#8b6914' }}>
            run new
          </Link>
        </div>
      </div>
    </div>
  );
}
