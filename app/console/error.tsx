'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // surface to whatever monitoring is wired (Vercel logs picks console.error)
      console.error('[console] runtime error:', error);
    }
  }, [error]);

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: '#050810', fontFamily: "'JetBrains Mono', monospace" }}
    >
      <div
        className="max-w-md w-full rounded-lg border p-6"
        style={{ background: '#0a0d18', borderColor: '#7f1d1d' }}
      >
        <div className="text-red-400 font-bold mb-2">⚠ CONSOLE FAULT</div>
        <p className="text-sm text-red-300 mb-1">The constitutional terminal crashed.</p>
        <p className="text-xs text-slate-500 mb-4 break-all">{error.message}</p>
        {error.digest && (
          <p className="text-xs text-slate-700 mb-4 font-mono">digest: {error.digest}</p>
        )}
        <div className="flex gap-2">
          <button
            onClick={reset}
            className="flex-1 px-4 py-2 rounded text-xs font-mono font-bold"
            style={{ background: '#c9a84c', color: '#07070d' }}
          >
            ↺ retry
          </button>
          <Link
            href="/"
            className="flex-1 text-center px-4 py-2 rounded text-xs font-mono"
            style={{ border: '1px solid #1a2040', color: '#94a3b8' }}
          >
            ← home
          </Link>
        </div>
      </div>
    </div>
  );
}
