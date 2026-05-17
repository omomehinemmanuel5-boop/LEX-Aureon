'use client';

import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-slate-950 text-slate-100 font-mono">
      <div className="max-w-md w-full rounded-lg border border-red-900/40 bg-slate-900/70 p-6">
        <div className="text-red-400 text-sm font-bold mb-2">⚠ Unexpected error</div>
        <p className="text-xs text-red-300/80 mb-4 break-all">{error.message}</p>
        {error.digest && (
          <p className="text-xs text-slate-600 mb-4">digest: {error.digest}</p>
        )}
        <div className="flex gap-2">
          <button onClick={reset} className="flex-1 px-4 py-2 rounded text-xs bg-amber-500 text-slate-950 font-bold">
            retry
          </button>
          <Link href="/" className="flex-1 text-center px-4 py-2 rounded text-xs border border-slate-700 text-slate-400">
            home
          </Link>
        </div>
      </div>
    </div>
  );
}
